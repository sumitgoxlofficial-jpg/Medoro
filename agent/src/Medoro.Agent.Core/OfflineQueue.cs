using System.Text.Json;

namespace Medoro.Agent.Core;

/// <summary>Encrypts data at rest. On Windows this is DPAPI for the current user (see the Windows host); tests use a fake.</summary>
public interface ISecretProtector
{
    byte[] Protect(byte[] plain);
    byte[] Unprotect(byte[] sealedBytes);
}

/// <summary>
/// Spans waiting to be uploaded while the server can't be reached. Kept encrypted in one file, written atomically
/// (temporary file, then replace). Spans older than <see cref="MaxAge"/> are dropped (the server refuses them anyway),
/// and at most <see cref="MaxItems"/> are kept, oldest dropped first.
/// </summary>
public sealed class OfflineQueue
{
    public static readonly TimeSpan MaxAge = TimeSpan.FromDays(7);
    public const int MaxItems = 20_000;
    private readonly string _path;
    private readonly ISecretProtector _protector;
    private readonly Func<DateTimeOffset> _now;
    private readonly object _gate = new();
    private List<WorkEvent> _items;

    public int Dropped { get; private set; }
    public int Count { get { lock (_gate) return _items.Count; } }

    public OfflineQueue(string path, ISecretProtector protector, Func<DateTimeOffset>? now = null)
    {
        _path = path; _protector = protector; _now = now ?? (() => DateTimeOffset.UtcNow);
        _items = Load();
    }

    private List<WorkEvent> Load()
    {
        if (!File.Exists(_path)) return [];
        try
        {
            var json = _protector.Unprotect(File.ReadAllBytes(_path));
            return JsonSerializer.Deserialize<List<WorkEvent>>(json) ?? [];
        }
        catch (Exception e) when (e is JsonException or System.Security.Cryptography.CryptographicException or IOException)
        {
            // Unreadable (another Windows user, or damaged): start empty rather than crash; keep the file for support.
            try { File.Move(_path, _path + ".unreadable", overwrite: true); } catch (IOException) { }
            return [];
        }
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_path))!);
        var tmp = _path + ".tmp";
        File.WriteAllBytes(tmp, _protector.Protect(JsonSerializer.SerializeToUtf8Bytes(_items)));
        File.Move(tmp, _path, overwrite: true);
    }

    private void Trim()
    {
        var cutoff = _now() - MaxAge;
        var before = _items.Count;
        _items.RemoveAll(e => e.EndedAt < cutoff);
        if (_items.Count > MaxItems) _items.RemoveRange(0, _items.Count - MaxItems);
        Dropped += before - _items.Count;
    }

    public void Enqueue(IEnumerable<WorkEvent> events)
    {
        lock (_gate)
        {
            var added = false;
            foreach (var e in events) { _items.Add(e); added = true; }
            if (!added) return;
            Trim();
            Save();
        }
    }

    /// <summary>The oldest spans, for the next upload (they stay queued until <see cref="Remove"/>).</summary>
    public IReadOnlyList<WorkEvent> Peek(int max)
    {
        lock (_gate) { Trim(); return _items.Take(max).ToList(); }
    }

    public void Remove(IEnumerable<string> clientIds)
    {
        lock (_gate)
        {
            var ids = clientIds.ToHashSet();
            if (_items.RemoveAll(e => ids.Contains(e.ClientId)) > 0) Save();
        }
    }

    /// <summary>Removes everything (the device was revoked: nothing more may be sent).</summary>
    public void Clear()
    {
        lock (_gate) { _items.Clear(); if (File.Exists(_path)) File.Delete(_path); }
    }
}
