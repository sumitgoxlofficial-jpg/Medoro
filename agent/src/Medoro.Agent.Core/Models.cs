using System.Text.Json.Serialization;

namespace Medoro.Agent.Core;

/// <summary>What the agent may record. Nothing else exists in the protocol: no window titles, URLs, keystrokes,
/// screenshots, clipboard, files, microphone or camera. The server rejects any extra field.</summary>
public enum ActivityKind { Active, Idle, Locked }

/// <summary>One span of time: the foreground program's process name (only while active) and whether the person was
/// active, idle or had the screen locked. <see cref="ClientId"/> makes uploads idempotent.</summary>
public sealed record WorkEvent(
    [property: JsonPropertyName("clientId")] string ClientId,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("app")] string? App,
    [property: JsonPropertyName("startedAt")] DateTimeOffset StartedAt,
    [property: JsonPropertyName("endedAt")] DateTimeOffset EndedAt);

/// <summary>One observation taken every few seconds by the host (Windows) sampler.</summary>
public readonly record struct Sample(DateTimeOffset At, string? ProcessName, TimeSpan SinceLastInput, bool Locked);

/// <summary>The server's answer to "may I record now?". The agent records only when <see cref="Recording"/> is true.</summary>
public sealed record AgentStatus(
    [property: JsonPropertyName("recording")] bool Recording,
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("employee")] string Employee,
    [property: JsonPropertyName("policyVersion")] int PolicyVersion,
    [property: JsonPropertyName("idleSeconds")] int IdleSeconds,
    [property: JsonPropertyName("sampleSeconds")] int SampleSeconds,
    [property: JsonPropertyName("activityUrl")] string ActivityUrl);

public sealed record EnrolResult(
    [property: JsonPropertyName("deviceId")] string DeviceId,
    [property: JsonPropertyName("token")] string Token,
    [property: JsonPropertyName("employee")] string Employee);

public sealed record UploadResult(
    [property: JsonPropertyName("accepted")] int Accepted,
    [property: JsonPropertyName("duplicates")] int Duplicates,
    [property: JsonPropertyName("outside")] int Outside,
    [property: JsonPropertyName("reason")] string? Reason);

/// <summary>A signed description of a newer agent build (see <see cref="UpdateVerifier"/>).</summary>
public sealed record UpdateManifest(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("sha256")] string Sha256,
    [property: JsonPropertyName("signature")] string Signature);
