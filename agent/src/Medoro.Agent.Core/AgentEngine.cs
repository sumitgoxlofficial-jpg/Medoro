namespace Medoro.Agent.Core;

/// <summary>What the host (the Windows tray app) provides: one observation of the desktop.</summary>
public interface ISampler
{
    Sample Take(DateTimeOffset now);
}

/// <summary>What the tray shows. The employee always sees whether anything is being recorded, and why.</summary>
public sealed record EngineState(bool Recording, string Headline, string Detail, int Queued, DateTimeOffset? LastSync, string ActivityUrl);

/// <summary>
/// The agent's loop, kept free of Windows so it can be tested. Every tick it may: ask the server whether recording is
/// allowed now (every <see cref="StatusEvery"/>), take one sample when it is, and upload queued spans (every
/// <see cref="UploadEvery"/>). Recording stops the moment the server says so (tracking off, policy not acknowledged,
/// checked out, outside working hours) and on any doubt: no answer from the server means no new recording after
/// <see cref="OfflineGrace"/>, though spans already queued are still sent later.
/// </summary>
public sealed class AgentEngine
{
    public static readonly TimeSpan StatusEvery = TimeSpan.FromMinutes(5), UploadEvery = TimeSpan.FromMinutes(1), OfflineGrace = TimeSpan.FromMinutes(30);
    private readonly AgentClient _client;
    private readonly OfflineQueue _queue;
    private readonly ISampler _sampler;
    private Sessionizer? _sessions;
    private AgentStatus? _status;
    private DateTimeOffset _statusAt = DateTimeOffset.MinValue, _uploadAt = DateTimeOffset.MinValue, _lastSampleAt = DateTimeOffset.MinValue, _confirmedAt = DateTimeOffset.MinValue;
    private DateTimeOffset? _lastSync;
    private string _problem = "";

    public bool Revoked { get; private set; }
    public EngineState State { get; private set; } = new(false, "Starting…", "", 0, null, "");

    public AgentEngine(AgentClient client, OfflineQueue queue, ISampler sampler) { _client = client; _queue = queue; _sampler = sampler; }

    private bool MayRecord(DateTimeOffset now) => !Revoked && _status is { Recording: true } && now - _confirmedAt <= OfflineGrace;

    public async Task TickAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        if (Revoked) return;
        try
        {
            if (now - _statusAt >= StatusEvery || _status is null)
            {
                _statusAt = now;
                try
                {
                    var s = await _client.StatusAsync(ct);
                    if (_status is not null && (s.IdleSeconds != _status.IdleSeconds)) { _queue.Enqueue(_sessions?.Flush(now) ?? []); _sessions = null; }
                    _status = s; _confirmedAt = now; _problem = "";
                }
                catch (HttpRequestException) { _problem = "Medoro can’t be reached. Recording pauses after 30 minutes without contact."; }
                catch (TaskCanceledException) when (!ct.IsCancellationRequested) { _problem = "Medoro didn’t answer in time."; }
            }
            if (MayRecord(now))
            {
                var sampleEvery = TimeSpan.FromSeconds(Math.Clamp(_status!.SampleSeconds, 5, 60));
                if (now - _lastSampleAt >= sampleEvery)
                {
                    _lastSampleAt = now;
                    _sessions ??= new Sessionizer(TimeSpan.FromSeconds(Math.Clamp(_status.IdleSeconds, 60, 1800)));
                    _queue.Enqueue(_sessions.Add(_sampler.Take(now)));
                }
            }
            else if (_sessions is not null) { _queue.Enqueue(_sessions.Flush(now)); _sessions = null; }

            if (now - _uploadAt >= UploadEvery && _queue.Count > 0)
            {
                _uploadAt = now;
                try { await UploadAllAsync(ct); _lastSync = now; }
                catch (HttpRequestException) { _problem = "Medoro can’t be reached. Activity is kept on this PC (encrypted) and sent later."; }
                catch (TaskCanceledException) when (!ct.IsCancellationRequested) { }
            }
        }
        catch (DeviceRevokedException)
        {
            Revoked = true; _sessions = null; _queue.Clear(); _status = null;
        }
        Publish(now);
    }

    private async Task UploadAllAsync(CancellationToken ct)
    {
        for (var round = 0; round < 20; round++)
        {
            var batch = _queue.Peek(500);
            if (batch.Count == 0) return;
            var r = await _client.UploadAsync(batch, ct);
            if (r.Reason is "tracking-off" or "policy" or "device-inactive")
            {
                // The server won't take anything right now: nothing more may be recorded, and what was queued can't be used.
                _queue.Remove(batch.Select(b => b.ClientId)); _status = _status is null ? null : _status with { Recording = false };
                continue;
            }
            _queue.Remove(batch.Select(b => b.ClientId)); // accepted, duplicates and spans outside working time are all done with
        }
    }

    /// <summary>Closes the open span and keeps it (shutdown, sign-out).</summary>
    public void Stop(DateTimeOffset? now = null) { if (_sessions is not null) { _queue.Enqueue(_sessions.Flush(now ?? DateTimeOffset.UtcNow)); _sessions = null; } }

    private void Publish(DateTimeOffset now)
    {
        if (Revoked) { State = new(false, "Removed from Medoro", "This PC no longer sends anything. Ask HR for a new enrolment code to use it again.", 0, _lastSync, ""); return; }
        var recording = MayRecord(now);
        var detail = recording
            ? "Recording which program is in front and whether you are active, idle or locked. No screenshots, keystrokes, window titles, websites, microphone or camera. See and dispute it in My activity."
            : _status?.Message is { Length: > 0 } m ? m : "Nothing is being recorded.";
        if (_problem.Length > 0) detail += " " + _problem;
        State = new(recording, recording ? $"Recording work activity for {_status!.Employee}" : "Not recording", detail, _queue.Count, _lastSync, _status?.ActivityUrl ?? "");
    }
}
