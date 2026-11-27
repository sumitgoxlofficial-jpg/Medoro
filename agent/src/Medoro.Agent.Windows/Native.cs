using System.Diagnostics;
using System.Runtime.InteropServices;
using Medoro.Agent.Core;

namespace Medoro.Agent.Windows;

/// <summary>
/// The only things read from Windows: the process name of the foreground window (never its title or contents), the time
/// since the last keyboard or mouse input (a single number Windows keeps; no keys are seen), and whether the session is
/// locked. No hooks are installed, so the agent never sees what is typed or clicked.
/// </summary>
internal sealed partial class WindowsSampler : ISampler, IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [LibraryImport("user32.dll")] private static partial IntPtr GetForegroundWindow();
    [LibraryImport("user32.dll")] private static partial uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool GetLastInputInfo(ref LASTINPUTINFO plii);

    private volatile bool _locked;

    public WindowsSampler()
    {
        Microsoft.Win32.SystemEvents.SessionSwitch += OnSessionSwitch;
    }

    private void OnSessionSwitch(object? sender, Microsoft.Win32.SessionSwitchEventArgs e)
    {
        if (e.Reason is Microsoft.Win32.SessionSwitchReason.SessionLock or Microsoft.Win32.SessionSwitchReason.ConsoleDisconnect or Microsoft.Win32.SessionSwitchReason.RemoteDisconnect) _locked = true;
        else if (e.Reason is Microsoft.Win32.SessionSwitchReason.SessionUnlock or Microsoft.Win32.SessionSwitchReason.ConsoleConnect or Microsoft.Win32.SessionSwitchReason.RemoteConnect) _locked = false;
    }

    public Sample Take(DateTimeOffset now)
    {
        string? process = null;
        try
        {
            var h = GetForegroundWindow();
            if (h != IntPtr.Zero && GetWindowThreadProcessId(h, out var pid) != 0 && pid != 0)
            {
                using var p = Process.GetProcessById((int)pid);
                process = p.ProcessName; // e.g. "EXCEL"; no path, title or arguments
            }
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        var idle = GetLastInputInfo(ref info) ? TimeSpan.FromMilliseconds(unchecked((uint)Environment.TickCount - info.dwTime)) : TimeSpan.Zero;
        return new Sample(now, process, idle, _locked);
    }

    public void Dispose() => Microsoft.Win32.SystemEvents.SessionSwitch -= OnSessionSwitch;
}

/// <summary>DPAPI for the current Windows user: the token and the offline queue can't be read by other users or on another PC.</summary>
internal sealed class DpapiProtector : ISecretProtector
{
    private static readonly byte[] Entropy = "Medoro.Agent.v1"u8.ToArray();
    public byte[] Protect(byte[] plain) => System.Security.Cryptography.ProtectedData.Protect(plain, Entropy, System.Security.Cryptography.DataProtectionScope.CurrentUser);
    public byte[] Unprotect(byte[] s) => System.Security.Cryptography.ProtectedData.Unprotect(s, Entropy, System.Security.Cryptography.DataProtectionScope.CurrentUser);
}
