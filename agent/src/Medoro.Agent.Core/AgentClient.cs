using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Medoro.Agent.Core;

/// <summary>The device was revoked (or its token is wrong): the agent must stop and forget its token.</summary>
public sealed class DeviceRevokedException() : Exception("This device was removed from Medoro. Ask HR for a new enrolment code.");

/// <summary>Talks to the Medoro HRMS agent API over HTTPS. One instance per enrolled device.</summary>
public sealed class AgentClient
{
    private readonly HttpClient _http;
    private readonly Uri _base;
    private string? _token;

    /// <summary>The server address must be HTTPS (plain HTTP only for localhost while developing).</summary>
    public static Uri CheckServer(string url)
    {
        if (!Uri.TryCreate(url?.Trim().TrimEnd('/') + "/", UriKind.Absolute, out var u)) throw new ArgumentException("Enter the Medoro address, for example https://medoro.in");
        var local = u.IsLoopback;
        if (u.Scheme != Uri.UriSchemeHttps && !(local && u.Scheme == Uri.UriSchemeHttp)) throw new ArgumentException("The Medoro address must start with https://");
        if (!string.IsNullOrEmpty(u.UserInfo) || !string.IsNullOrEmpty(u.Query)) throw new ArgumentException("Enter only the Medoro address.");
        return u;
    }

    public AgentClient(string serverUrl, string? token, HttpMessageHandler? handler = null)
    {
        _base = CheckServer(serverUrl);
        _token = token;
        _http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(30) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("MedoroAgent/" + typeof(AgentClient).Assembly.GetName().Version);
    }

    public bool Enrolled => _token is not null;

    private HttpRequestMessage Req(HttpMethod m, string path, object? body = null)
    {
        var r = new HttpRequestMessage(m, new Uri(_base, path));
        if (_token is not null) r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        if (body is not null) r.Content = JsonContent.Create(body);
        return r;
    }

    private static async Task<string> ErrorOf(HttpResponseMessage res, CancellationToken ct)
    {
        try { using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct)); return doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() ?? "" : ""; }
        catch (JsonException) { return ""; }
    }

    /// <summary>Exchanges a one-time enrolment code from HR for this device's token.</summary>
    public async Task<EnrolResult> EnrolAsync(string code, string deviceName, string agentVersion, CancellationToken ct = default)
    {
        using var res = await _http.SendAsync(Req(HttpMethod.Post, "api/agent/enrol", new { code = code.Trim(), name = deviceName, platform = "windows", agentVersion }), ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(await ErrorOf(res, ct) is { Length: > 0 } m ? m : $"Enrolment failed ({(int)res.StatusCode}).");
        var r = (await res.Content.ReadFromJsonAsync<EnrolResult>(ct))!;
        _token = r.Token;
        return r;
    }

    public async Task<AgentStatus> StatusAsync(CancellationToken ct = default)
    {
        using var res = await _http.SendAsync(Req(HttpMethod.Get, "api/agent/status"), ct);
        if (res.StatusCode == HttpStatusCode.Unauthorized) { _token = null; throw new DeviceRevokedException(); }
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<AgentStatus>(ct))!;
    }

    /// <summary>Uploads up to 500 spans. The server answers which it kept; duplicates (already sent) count as done.</summary>
    public async Task<UploadResult> UploadAsync(IReadOnlyList<WorkEvent> events, CancellationToken ct = default)
    {
        using var res = await _http.SendAsync(Req(HttpMethod.Post, "api/agent/events", new { events }), ct);
        if (res.StatusCode == HttpStatusCode.Unauthorized) { _token = null; throw new DeviceRevokedException(); }
        if (res.StatusCode == HttpStatusCode.Forbidden || res.StatusCode == HttpStatusCode.Conflict) return (await res.Content.ReadFromJsonAsync<UploadResult>(ct))!;
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<UploadResult>(ct))!;
    }

    public async Task<UpdateManifest?> UpdateAsync(CancellationToken ct = default)
    {
        using var res = await _http.SendAsync(Req(HttpMethod.Get, "api/agent/update"), ct);
        if (res.StatusCode == HttpStatusCode.NoContent) return null;
        if (res.StatusCode == HttpStatusCode.Unauthorized) { _token = null; throw new DeviceRevokedException(); }
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<UpdateManifest>(ct);
    }

    public Task<byte[]> DownloadAsync(string url, CancellationToken ct = default) => _http.GetByteArrayAsync(CheckServer(url).ToString().TrimEnd('/'), ct);
}
