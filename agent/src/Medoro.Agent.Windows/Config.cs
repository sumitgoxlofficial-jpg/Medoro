using System.Text.Json;
using System.Text.Json.Serialization;

namespace Medoro.Agent.Windows;

/// <summary>Per-user state in %LOCALAPPDATA%\Medoro\Agent. The device token is stored only DPAPI-sealed.</summary>
internal sealed class AgentConfig
{
    [JsonPropertyName("serverUrl")] public string ServerUrl { get; set; } = "";
    [JsonPropertyName("updatePublicKey")] public string UpdatePublicKey { get; set; } = "";
    [JsonPropertyName("tokenSealed")] public string? TokenSealed { get; set; }
    [JsonPropertyName("deviceId")] public string? DeviceId { get; set; }
    [JsonPropertyName("employee")] public string? Employee { get; set; }

    public static string Folder => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Medoro", "Agent");
    private static string FilePath => Path.Combine(Folder, "config.json");

    /// <summary>The user's saved state, or the defaults the installer placed next to the program (server and update key).</summary>
    public static AgentConfig Load()
    {
        if (File.Exists(FilePath)) return JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(FilePath)) ?? new AgentConfig();
        var shipped = Path.Combine(AppContext.BaseDirectory, "agent.settings.json");
        return File.Exists(shipped) ? JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(shipped)) ?? new AgentConfig() : new AgentConfig();
    }

    public void Save()
    {
        Directory.CreateDirectory(Folder);
        var tmp = FilePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, FilePath, overwrite: true);
    }

    public string? Token(DpapiProtector p) => TokenSealed is null ? null : System.Text.Encoding.UTF8.GetString(p.Unprotect(Convert.FromBase64String(TokenSealed)));
    public void SetToken(DpapiProtector p, string? token) => TokenSealed = token is null ? null : Convert.ToBase64String(p.Protect(System.Text.Encoding.UTF8.GetBytes(token)));
}
