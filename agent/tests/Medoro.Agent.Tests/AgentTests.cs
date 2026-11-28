using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Medoro.Agent.Core;
using Xunit;

namespace Medoro.Agent.Tests;

/// <summary>Reversible stand-in for DPAPI that still proves the file is not plain text.</summary>
sealed class XorProtector : ISecretProtector
{
    public byte[] Protect(byte[] p) => p.Select(b => (byte)(b ^ 0x5A)).Prepend((byte)1).ToArray();
    public byte[] Unprotect(byte[] s) => s[0] == 1 ? s.Skip(1).Select(b => (byte)(b ^ 0x5A)).ToArray() : throw new CryptographicException("not ours");
}

/// <summary>A fake Medoro server: answers the agent API from a script and records what it was sent.</summary>
sealed class FakeServer : HttpMessageHandler
{
    public AgentStatus Status = new(true, "ok", "", "Esha Employee", 1, 300, 10, "https://hr.test/staff/hrms/myactivity");
    public bool Revoked, Down;
    public string? UploadReason;
    public readonly List<WorkEvent> Received = [];
    public readonly HashSet<string> Seen = [];
    public readonly List<string?> Auth = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
    {
        if (Down) throw new HttpRequestException("down");
        Auth.Add(r.Headers.Authorization?.Parameter);
        var path = r.RequestUri!.AbsolutePath;
        if (path == "/api/agent/enrol")
        {
            var body = JsonDocument.Parse(await r.Content!.ReadAsStringAsync(ct)).RootElement;
            return body.GetProperty("code").GetString() == "GOOD-CODE"
                ? Json(new { deviceId = "d1", token = "tok-1", employee = "Esha Employee" })
                : Json(new { error = "That code is wrong or has expired." }, HttpStatusCode.BadRequest);
        }
        if (Revoked) return new HttpResponseMessage(HttpStatusCode.Unauthorized);
        if (path == "/api/agent/status") return Json(Status);
        if (path == "/api/agent/events")
        {
            if (UploadReason is not null) return Json(new { accepted = 0, duplicates = 0, outside = 0, reason = UploadReason }, HttpStatusCode.Forbidden);
            var events = JsonDocument.Parse(await r.Content!.ReadAsStringAsync(ct)).RootElement.GetProperty("events").Deserialize<List<WorkEvent>>()!;
            int acc = 0, dup = 0;
            foreach (var e in events) { if (Seen.Add(e.ClientId)) { Received.Add(e); acc++; } else dup++; }
            return Json(new { accepted = acc, duplicates = dup, outside = 0, reason = (string?)null });
        }
        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }
    static HttpResponseMessage Json(object o, HttpStatusCode c = HttpStatusCode.OK) => new(c) { Content = new StringContent(JsonSerializer.Serialize(o), Encoding.UTF8, "application/json") };
}

sealed class ScriptSampler(Func<DateTimeOffset, Sample> f) : ISampler { public Sample Take(DateTimeOffset now) => f(now); }

public class SessionizerTests
{
    static readonly DateTimeOffset T0 = new(2026, 11, 27, 4, 0, 0, TimeSpan.Zero);
    static Sample S(int sec, string? app, int idle = 0, bool locked = false) => new(T0.AddSeconds(sec), app, TimeSpan.FromSeconds(idle), locked);

    [Fact]
    public void Merges_same_program_and_splits_on_change_idle_and_lock()
    {
        var z = new Sessionizer(TimeSpan.FromMinutes(5));
        var all = new List<WorkEvent>();
        all.AddRange(z.Add(S(0, "EXCEL.EXE"))); all.AddRange(z.Add(S(10, "excel.exe".ToUpper()))); all.AddRange(z.Add(S(20, "chrome")));
        all.AddRange(z.Add(S(30, "chrome", idle: 400))); all.AddRange(z.Add(S(40, "chrome", locked: true))); all.AddRange(z.Flush(T0.AddSeconds(50)));
        Assert.Equal(["active", "active", "idle", "locked"], all.Select(e => e.Kind));
        Assert.Equal(["EXCEL", "chrome", null, null], all.Select(e => e.App));
        Assert.Equal(TimeSpan.FromSeconds(20), all[0].EndedAt - all[0].StartedAt);
    }

    [Fact]
    public void A_gap_closes_the_span_at_the_last_sample_so_sleep_is_not_counted()
    {
        var z = new Sessionizer(TimeSpan.FromMinutes(5));
        z.Add(S(0, "code")); z.Add(S(10, "code"));
        var closed = z.Add(S(3600, "code")); // the PC slept for an hour
        Assert.Single(closed);
        Assert.Equal(T0.AddSeconds(10), closed[0].EndedAt);
    }

    [Fact]
    public void Long_spans_are_cut_so_one_bad_sample_cant_cover_hours()
    {
        var z = new Sessionizer(TimeSpan.FromMinutes(5), maxSpan: TimeSpan.FromMinutes(15));
        var all = new List<WorkEvent>();
        for (var s = 0; s <= 3600; s += 10) all.AddRange(z.Add(S(s, "code")));
        Assert.All(all, e => Assert.True(e.EndedAt - e.StartedAt <= TimeSpan.FromMinutes(15)));
        Assert.Equal(4, all.Count); // 0–15, 15–30, 30–45 and 45–60 minutes
    }

    [Theory]
    [InlineData(@"C:\Users\esha\AppData\Secret Folder\tool.exe", "tool")]
    [InlineData("WINWORD.EXE", "WINWORD")]
    [InlineData("bad<script>name", "badscriptname")]
    [InlineData("   ", null)]
    public void App_names_are_process_names_only(string raw, string? expected) => Assert.Equal(expected, Sessionizer.CleanApp(raw));
}

public class QueueTests
{
    [Fact]
    public void Survives_restart_encrypted_and_drops_old_spans()
    {
        var dir = Directory.CreateTempSubdirectory().FullName; var path = Path.Combine(dir, "q.bin");
        var now = DateTimeOffset.UtcNow;
        var q = new OfflineQueue(path, new XorProtector(), () => now);
        q.Enqueue([new WorkEvent("a", "active", "code", now.AddMinutes(-2), now.AddMinutes(-1)), new WorkEvent("old", "active", "code", now.AddDays(-9), now.AddDays(-9).AddMinutes(1))]);
        Assert.Equal(1, q.Count);
        Assert.DoesNotContain("code", Encoding.UTF8.GetString(File.ReadAllBytes(path))); // not plain text on disk
        var again = new OfflineQueue(path, new XorProtector(), () => now);
        Assert.Equal("a", again.Peek(10).Single().ClientId);
        again.Remove(["a"]);
        Assert.Equal(0, new OfflineQueue(path, new XorProtector(), () => now).Count);
    }

    [Fact]
    public void An_unreadable_file_is_set_aside_not_fatal()
    {
        var path = Path.Combine(Directory.CreateTempSubdirectory().FullName, "q.bin");
        File.WriteAllBytes(path, [9, 9, 9]);
        Assert.Equal(0, new OfflineQueue(path, new XorProtector()).Count);
        Assert.True(File.Exists(path + ".unreadable"));
    }
}

public class ClientAndEngineTests
{
    static readonly DateTimeOffset T0 = new(2026, 11, 27, 4, 0, 0, TimeSpan.Zero);
    static (AgentEngine, FakeServer, OfflineQueue, AgentClient) Make(string? token = "tok-1")
    {
        var srv = new FakeServer();
        var client = new AgentClient("https://hr.test", token, srv);
        var q = new OfflineQueue(Path.Combine(Directory.CreateTempSubdirectory().FullName, "q.bin"), new XorProtector(), () => T0.AddHours(1));
        var app = "code";
        var eng = new AgentEngine(client, q, new ScriptSampler(now => new Sample(now, app, TimeSpan.Zero, false)));
        return (eng, srv, q, client);
    }

    [Theory]
    [InlineData("http://medoro.in")]
    [InlineData("ftp://medoro.in")]
    [InlineData("https://user:pw@medoro.in")]
    [InlineData("not a url")]
    public void Refuses_servers_that_are_not_plain_https(string url) => Assert.Throws<ArgumentException>(() => AgentClient.CheckServer(url));

    [Fact]
    public void Allows_http_only_for_localhost() => Assert.Equal("http://localhost:3000/", AgentClient.CheckServer("http://localhost:3000").ToString());

    [Fact]
    public async Task Enrols_with_a_one_time_code()
    {
        var srv = new FakeServer();
        var c = new AgentClient("https://hr.test", null, srv);
        await Assert.ThrowsAsync<InvalidOperationException>(() => c.EnrolAsync("WRONG", "PC-1", "1.0.0"));
        Assert.False(c.Enrolled);
        var r = await c.EnrolAsync("GOOD-CODE", "PC-1", "1.0.0");
        Assert.Equal("tok-1", r.Token);
        Assert.True(c.Enrolled);
    }

    [Fact]
    public async Task Records_only_when_the_server_allows_and_uploads_once()
    {
        var (eng, srv, q, _) = Make();
        for (var s = 0; s <= 120; s += 10) await eng.TickAsync(T0.AddSeconds(s));
        Assert.True(eng.State.Recording);
        Assert.Contains("No screenshots, keystrokes", eng.State.Detail);
        eng.Stop(T0.AddSeconds(125));
        await eng.TickAsync(T0.AddSeconds(200));
        Assert.NotEmpty(srv.Received);
        Assert.Equal(0, q.Count);
        Assert.All(srv.Auth, a => Assert.Equal("tok-1", a));
        // Recording off (checked out): nothing new is sampled, and the tray says so.
        srv.Status = srv.Status with { Recording = false, Reason = "checked-out", Message = "You are checked out. Nothing is recorded." };
        var before = srv.Received.Count;
        for (var s = 600; s <= 900; s += 10) await eng.TickAsync(T0.AddSeconds(s));
        await eng.TickAsync(T0.AddSeconds(1000));
        Assert.False(eng.State.Recording);
        Assert.Equal("You are checked out. Nothing is recorded.", eng.State.Detail);
        Assert.Equal(before, srv.Received.Count);
    }

    [Fact]
    public async Task Keeps_spans_offline_then_syncs_without_duplicates()
    {
        var (eng, srv, q, _) = Make();
        await eng.TickAsync(T0);
        srv.Down = true;
        for (var s = 10; s <= 300; s += 10) await eng.TickAsync(T0.AddSeconds(s));
        eng.Stop();
        Assert.True(q.Count > 0);
        srv.Down = false;
        await eng.TickAsync(T0.AddSeconds(400));
        var n = srv.Received.Count;
        Assert.True(n > 0);
        Assert.Equal(0, q.Count);
        Assert.Equal(n, srv.Received.Select(e => e.ClientId).Distinct().Count());
    }

    [Fact]
    public async Task Stops_recording_when_the_server_is_unreachable_for_too_long()
    {
        var (eng, srv, _, _) = Make();
        await eng.TickAsync(T0);
        Assert.True(eng.State.Recording);
        srv.Down = true;
        await eng.TickAsync(T0.AddMinutes(31));
        await eng.TickAsync(T0.AddMinutes(36));
        Assert.False(eng.State.Recording);
    }

    [Fact]
    public async Task A_revoked_device_stops_and_forgets_everything()
    {
        var (eng, srv, q, client) = Make();
        for (var s = 0; s <= 60; s += 10) await eng.TickAsync(T0.AddSeconds(s));
        eng.Stop();
        srv.Revoked = true;
        await eng.TickAsync(T0.AddMinutes(6));
        Assert.True(eng.Revoked);
        Assert.False(client.Enrolled);
        Assert.Equal(0, q.Count);
        Assert.Equal("Removed from Medoro", eng.State.Headline);
    }

    [Fact]
    public async Task Discards_queued_spans_when_tracking_was_switched_off()
    {
        var (eng, srv, q, _) = Make();
        for (var s = 0; s <= 50; s += 10) await eng.TickAsync(T0.AddSeconds(s));
        eng.Stop();
        srv.UploadReason = "tracking-off";
        await eng.TickAsync(T0.AddSeconds(120));
        Assert.Equal(0, q.Count);
        Assert.Empty(srv.Received);
    }
}

public class UpdateTests
{
    static (UpdateManifest m, string pub, byte[] file) Signed(string version = "1.2.0", string url = "https://hr.test/agent/MedoroAgent-1.2.0.msi")
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var file = Encoding.UTF8.GetBytes("installer bytes");
        var m = new UpdateManifest(version, url, Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant(), "");
        var sig = key.SignData(UpdateVerifier.SignedBytes(m), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return (m with { Signature = Convert.ToBase64String(sig) }, Convert.ToBase64String(key.ExportSubjectPublicKeyInfo()), file);
    }
    static readonly Uri Server = new("https://hr.test/");

    [Fact]
    public void Accepts_a_signed_newer_build_from_the_same_server_and_checks_the_file()
    {
        var (m, pub, file) = Signed();
        Assert.True(UpdateVerifier.ManifestIsTrusted(m, pub, new Version(1, 0, 0), Server));
        Assert.True(UpdateVerifier.FileMatches(m, file));
        Assert.False(UpdateVerifier.FileMatches(m, Encoding.UTF8.GetBytes("tampered")));
    }

    /// <summary>Signed by the server's own code (src/staff/hrms/workforce.ts → updateManifest, Node crypto): the formats agree.</summary>
    [Fact]
    public void Verifies_a_manifest_signed_by_the_Medoro_server()
    {
        var m = new UpdateManifest("1.1.0", "https://hr.test/agent/MedoroAgent-1.1.0.msi", "e34210a6de4f653edf588301431c3d69a633638cbf587345cc50a7fed9f38f4c", "sqiCCWZQ1kzLl4qJggNMC9Gc4Hc1G7uN1ED856KxCkk9JJBPYfAaV1wRsiuUXNVKeET+2Tj6eqo2QsGCCKkf7Q==");
        const string pub = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExPv+UydXFdMrPLJ2uVckP6QWFzEIMeDJ3tAsBNqXxmQIrPnMui08i+OYCO+VVmzg9PKqnbhMYiB0+wowETsQgg==";
        Assert.True(UpdateVerifier.ManifestIsTrusted(m, pub, new Version(1, 0, 0), Server));
        Assert.True(UpdateVerifier.FileMatches(m, Encoding.UTF8.GetBytes("installer bytes")));
        Assert.False(UpdateVerifier.ManifestIsTrusted(m with { Url = m.Url + "x" }, pub, new Version(1, 0, 0), Server));
    }

    [Fact]
    public void Refuses_tampered_old_foreign_or_unsigned_manifests()
    {
        var (m, pub, _) = Signed();
        Assert.False(UpdateVerifier.ManifestIsTrusted(m with { Version = "9.9.9" }, pub, new Version(1, 0, 0), Server)); // signature no longer matches
        Assert.False(UpdateVerifier.ManifestIsTrusted(m, pub, new Version(1, 2, 0), Server)); // not newer
        Assert.False(UpdateVerifier.ManifestIsTrusted(m, pub, new Version(1, 0, 0), new Uri("https://other.example/"))); // another host
        Assert.False(UpdateVerifier.ManifestIsTrusted(m, "", new Version(1, 0, 0), Server)); // no key configured
        var (other, otherPub, _) = Signed();
        Assert.False(UpdateVerifier.ManifestIsTrusted(m, otherPub, new Version(1, 0, 0), Server)); // signed by someone else
        var (http, httpPub, _) = Signed(url: "http://hr.test/agent.msi");
        Assert.False(UpdateVerifier.ManifestIsTrusted(http, httpPub, new Version(1, 0, 0), Server));
        _ = other;
    }
}
