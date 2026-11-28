using System.Diagnostics;
using Medoro.Agent.Core;

namespace Medoro.Agent.Windows;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        // One agent per Windows user.
        using var single = new Mutex(true, @"Local\MedoroWorkforceAgent", out var first);
        if (!first) return;
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrayApp());
    }
}

/// <summary>
/// The tray icon is always visible while the agent runs, and its tooltip and menu say whether anything is being
/// recorded and why. "What is recorded" opens the employee's own activity page.
/// </summary>
internal sealed class TrayApp : ApplicationContext
{
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _headline = new() { Enabled = false }, _detail = new() { Enabled = false };
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 5000 };
    private readonly DpapiProtector _protector = new();
    private readonly WindowsSampler _sampler = new();
    private AgentConfig _cfg;
    private AgentEngine? _engine;
    private AgentClient? _client;
    private bool _busy;
    private DateTimeOffset _updateCheckedAt = DateTimeOffset.MinValue;

    public TrayApp()
    {
        _cfg = AgentConfig.Load();
        var menu = new ContextMenuStrip();
        menu.Items.Add(_headline);
        menu.Items.Add(_detail);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("My activity (see, correct or dispute)", null, (_, _) => OpenActivity());
        menu.Items.Add("Enrol this PC…", null, (_, _) => Enrol());
        menu.Items.Add("Exit (recording stops)", null, (_, _) => ExitThread());
        _icon = new NotifyIcon { Icon = SystemIcons.Shield, Visible = true, ContextMenuStrip = menu, Text = "Medoro" };
        _icon.DoubleClick += (_, _) => OpenActivity();
        _timer.Tick += async (_, _) => await TickAsync();
        Start();
        _timer.Start();
    }

    private void Start()
    {
        var token = _cfg.Token(_protector);
        if (token is null || string.IsNullOrWhiteSpace(_cfg.ServerUrl)) { Show("Not enrolled", "Nothing is recorded. Ask HR for an enrolment code, then choose Enrol this PC."); return; }
        _client = new AgentClient(_cfg.ServerUrl, token);
        _engine = new AgentEngine(_client, new OfflineQueue(Path.Combine(AgentConfig.Folder, "queue.bin"), _protector), _sampler);
    }

    private async Task TickAsync()
    {
        if (_busy || _engine is null) return;
        _busy = true;
        try
        {
            var now = DateTimeOffset.UtcNow;
            await _engine.TickAsync(now);
            if (_engine.Revoked) { _cfg.SetToken(_protector, null); _cfg.Save(); _engine = null; Show("Removed from Medoro", "This PC no longer records or sends anything."); return; }
            var s = _engine.State;
            Show(s.Headline, s.Detail + (s.Queued > 0 ? $" {s.Queued} item(s) waiting to be sent." : ""));
            if (now - _updateCheckedAt > TimeSpan.FromHours(6)) { _updateCheckedAt = now; await Updater.CheckAsync(_client!, _cfg); }
        }
        catch (Exception e) { Show("Medoro agent problem", e.Message); }
        finally { _busy = false; }
    }

    private void Show(string headline, string detail)
    {
        _headline.Text = headline;
        _detail.Text = detail.Length > 120 ? detail[..117] + "…" : detail;
        _detail.ToolTipText = detail;
        _icon.Text = ("Medoro: " + headline).Length > 63 ? ("Medoro: " + headline)[..63] : "Medoro: " + headline;
    }

    private void OpenActivity()
    {
        var url = _engine?.State.ActivityUrl is { Length: > 0 } u ? u : (_cfg.ServerUrl.TrimEnd('/') + "/staff/hrms/myactivity");
        if (Uri.TryCreate(url, UriKind.Absolute, out var x) && (x.Scheme == Uri.UriSchemeHttps || x.IsLoopback)) Process.Start(new ProcessStartInfo(x.ToString()) { UseShellExecute = true });
    }

    private void Enrol()
    {
        using var f = new EnrolForm(_cfg.ServerUrl);
        if (f.ShowDialog() != DialogResult.OK) return;
        try
        {
            var c = new AgentClient(f.Server, null);
            var r = c.EnrolAsync(f.Code, Environment.MachineName, typeof(Program).Assembly.GetName().Version?.ToString() ?? "1.0.0").GetAwaiter().GetResult();
            _cfg.ServerUrl = f.Server; _cfg.DeviceId = r.DeviceId; _cfg.Employee = r.Employee; _cfg.SetToken(_protector, r.Token); _cfg.Save();
            _engine?.Stop();
            Start();
            MessageBox.Show($"This PC is enrolled for {r.Employee}. The tray icon always shows whether anything is being recorded.", "Medoro", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException or HttpRequestException) { MessageBox.Show(e.Message, "Medoro", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    protected override void ExitThreadCore()
    {
        _timer.Stop();
        _engine?.Stop();
        _icon.Visible = false;
        _icon.Dispose();
        _sampler.Dispose();
        base.ExitThreadCore();
    }
}

internal sealed class EnrolForm : Form
{
    private readonly TextBox _server = new() { Width = 320 }, _code = new() { Width = 320 };
    public string Server => _server.Text.Trim();
    public string Code => _code.Text.Trim();
    public EnrolForm(string server)
    {
        Text = "Enrol this PC with Medoro"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen; AutoSize = true; Padding = new Padding(12);
        _server.Text = server;
        var ok = new Button { Text = "Enrol", DialogResult = DialogResult.OK };
        var panel = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, Dock = DockStyle.Fill };
        panel.Controls.AddRange([
            new Label { Text = "Medoro address", AutoSize = true }, _server,
            new Label { Text = "Enrolment code from HR (works once, for 15 minutes)", AutoSize = true }, _code,
            new Label { Text = "Once enrolled, while you are checked in this PC sends which program is in front and whether you are active, idle or locked. Never screenshots, keystrokes, window titles, websites, files, microphone or camera.", AutoSize = true, MaximumSize = new Size(340, 0) },
            ok,
        ]);
        Controls.Add(panel); AcceptButton = ok;
    }
}

/// <summary>Installs a newer build only when its manifest is signed by Medoro's update key and the file matches it.</summary>
internal static class Updater
{
    public static async Task CheckAsync(AgentClient client, AgentConfig cfg)
    {
        if (string.IsNullOrWhiteSpace(cfg.UpdatePublicKey)) return; // no key shipped: updates are installed by IT
        var m = await client.UpdateAsync();
        var running = typeof(Program).Assembly.GetName().Version ?? new Version(1, 0, 0);
        if (m is null || !UpdateVerifier.ManifestIsTrusted(m, cfg.UpdatePublicKey, running, AgentClient.CheckServer(cfg.ServerUrl))) return;
        var file = await client.DownloadAsync(m.Url);
        if (!UpdateVerifier.FileMatches(m, file)) return;
        var path = Path.Combine(AgentConfig.Folder, $"MedoroAgent-{m.Version}.msi");
        await File.WriteAllBytesAsync(path, file);
        // A per-user MSI: Windows Installer also checks its Authenticode signature when the package is signed.
        Process.Start(new ProcessStartInfo("msiexec.exe") { ArgumentList = { "/i", path, "/qn", "/norestart" }, UseShellExecute = false });
        Application.Exit();
    }
}
