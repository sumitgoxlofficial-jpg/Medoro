using System.Text.Json;
using Medoro.Agent.Core;

// End-to-end check of the real agent core against a running Medoro server (not a fake):
//   dotnet run --project agent/tests/Medoro.Agent.E2E -- <server url> <enrolment code>
// It enrols, follows the server's recording rules, samples a fake desktop for five simulated minutes ending now, keeps the
// spans in an encrypted offline queue, uploads them, and prints what happened as JSON. The caller checks the database.

if (args.Length < 2) { Console.Error.WriteLine("usage: <server url> <enrolment code>"); return 2; }
var client = new AgentClient(args[0], null);
var enrolled = await client.EnrolAsync(args[1], "E2E-HARNESS", "1.0.0");
var status = await client.StatusAsync();
var dir = Directory.CreateTempSubdirectory().FullName;
var queue = new OfflineQueue(Path.Combine(dir, "queue.bin"), new Fake());
var apps = new[] { "EXCEL", "EXCEL", "chrome", "OUTLOOK" };
var i = 0;
var engine = new AgentEngine(client, queue, new Sampler(now => new Sample(now, apps[i++ / 8 % apps.Length], TimeSpan.Zero, false)));
var end = DateTimeOffset.UtcNow.AddSeconds(-30);
for (var t = end.AddMinutes(-5); t <= end; t = t.AddSeconds(10)) await engine.TickAsync(t);
engine.Stop(end);
var queuedBeforeUpload = queue.Count;
await engine.TickAsync(end.AddMinutes(2));
Console.WriteLine(JsonSerializer.Serialize(new { enrolled.Employee, status.Recording, status.Reason, queuedBeforeUpload, queuedAfterUpload = queue.Count, engine.State.Headline }));
return queue.Count == 0 && status.Recording ? 0 : 1;

sealed class Fake : ISecretProtector { public byte[] Protect(byte[] p) => p.Select(b => (byte)~b).ToArray(); public byte[] Unprotect(byte[] s) => s.Select(b => (byte)~b).ToArray(); }
sealed class Sampler(Func<DateTimeOffset, Sample> f) : ISampler { public Sample Take(DateTimeOffset now) => f(now); }
