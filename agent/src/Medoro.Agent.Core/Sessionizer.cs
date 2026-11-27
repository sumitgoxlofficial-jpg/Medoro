using System.Text.RegularExpressions;

namespace Medoro.Agent.Core;

/// <summary>
/// Turns samples into spans. Consecutive samples with the same state (active in the same program, idle, or locked)
/// extend one span; a change, a gap longer than <c>maxGap</c> (sleep, the agent paused) or a span reaching
/// <c>maxSpan</c> closes it. Idle and locked spans never carry a program name.
/// </summary>
public sealed partial class Sessionizer
{
    private readonly TimeSpan _idleAfter, _maxGap, _maxSpan;
    private string? _kind, _app;
    private DateTimeOffset _start, _last;

    public Sessionizer(TimeSpan idleAfter, TimeSpan? maxGap = null, TimeSpan? maxSpan = null)
    {
        if (idleAfter <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(idleAfter));
        _idleAfter = idleAfter;
        _maxGap = maxGap ?? TimeSpan.FromSeconds(90);
        _maxSpan = maxSpan ?? TimeSpan.FromMinutes(15);
    }

    [GeneratedRegex(@"[^\w.\- ]")]
    private static partial Regex Unsafe();

    /// <summary>A process name as the server accepts it: letters, digits, dot, dash, space; at most 80 characters.
    /// Strips any path or extension so a full path can never leak.</summary>
    public static string? CleanApp(string? processName)
    {
        if (string.IsNullOrWhiteSpace(processName)) return null;
        var name = processName.Replace('\\', '/');
        name = name[(name.LastIndexOf('/') + 1)..];
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        name = Unsafe().Replace(name, "").Trim();
        if (name.Length == 0) return null;
        return name.Length > 80 ? name[..80] : name;
    }

    /// <summary>Adds a sample; returns any span it closed.</summary>
    public IReadOnlyList<WorkEvent> Add(Sample s)
    {
        var closed = new List<WorkEvent>(2);
        var kind = s.Locked ? "locked" : s.SinceLastInput >= _idleAfter ? "idle" : "active";
        var app = kind == "active" ? CleanApp(s.ProcessName) : null;
        if (_kind is not null)
        {
            var gap = s.At - _last;
            if (gap < TimeSpan.Zero || gap > _maxGap) { Close(closed, _last); }
            else if (kind != _kind || app != _app || s.At - _start >= _maxSpan) { Close(closed, s.At); }
        }
        if (_kind is null) { _kind = kind; _app = app; _start = s.At; }
        _last = s.At;
        return closed;
    }

    /// <summary>Closes the open span (check-out, pause, shutdown). It ends at <paramref name="at"/> when that is within
    /// the allowed gap after the last sample (so the last few seconds are kept), otherwise at the last sample.</summary>
    public IReadOnlyList<WorkEvent> Flush(DateTimeOffset? at = null)
    {
        var closed = new List<WorkEvent>(1);
        if (_kind is null) return closed;
        var end = at is { } t && t >= _last && t - _last <= _maxGap ? t : _last;
        Close(closed, end);
        return closed;
    }

    private void Close(List<WorkEvent> into, DateTimeOffset end)
    {
        if (end > _start) into.Add(new WorkEvent(Guid.NewGuid().ToString("N"), _kind!, _app, _start, end));
        _kind = null; _app = null;
    }
}
