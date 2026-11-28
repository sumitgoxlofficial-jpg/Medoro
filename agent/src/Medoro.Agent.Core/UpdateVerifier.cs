using System.Security.Cryptography;
using System.Text;

namespace Medoro.Agent.Core;

/// <summary>
/// An update is installed only when (1) its manifest is signed by Medoro's update key (ECDSA P-256 / SHA-256, the public
/// key ships with the installer), (2) it is newer than the running version, (3) it is served over HTTPS from the same
/// Medoro server, and (4) the downloaded file's SHA-256 matches the signed manifest. Anything else is ignored.
/// </summary>
public static class UpdateVerifier
{
    /// <summary>The exact bytes the server signs.</summary>
    public static byte[] SignedBytes(UpdateManifest m) => Encoding.UTF8.GetBytes($"medoro-agent-update\n{m.Version}\n{m.Url}\n{m.Sha256.ToLowerInvariant()}");

    public static bool ManifestIsTrusted(UpdateManifest m, string publicKeySpkiBase64, Version running, Uri server)
    {
        if (string.IsNullOrWhiteSpace(publicKeySpkiBase64)) return false;
        if (!Version.TryParse(m.Version, out var v) || v <= running) return false;
        if (!Uri.TryCreate(m.Url, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps || !string.Equals(u.Host, server.Host, StringComparison.OrdinalIgnoreCase)) return false;
        if (m.Sha256.Length != 64 || !m.Sha256.All(Uri.IsHexDigit)) return false;
        try
        {
            using var key = ECDsa.Create();
            key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKeySpkiBase64), out _);
            return key.VerifyData(SignedBytes(m), Convert.FromBase64String(m.Signature), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (Exception e) when (e is FormatException or CryptographicException) { return false; }
    }

    public static bool FileMatches(UpdateManifest m, byte[] file) =>
        CryptographicOperations.FixedTimeEquals(Convert.FromHexString(m.Sha256), SHA256.HashData(file));
}
