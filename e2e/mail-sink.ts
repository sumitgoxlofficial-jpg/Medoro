import https from "node:https";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

/**
 * A tiny HTTPS endpoint for MAIL_PROVIDER=http (production refuses console mail and plain-http webhooks).
 * wsl-e2e.sh creates the self-signed certificate, points MAIL_HTTP_URL here and makes the server trust it
 * (NODE_EXTRA_CA_CERTS). Start it in the spec that needs email; close it when done.
 */
export type SentMail = { from: string; to: string; subject: string; text: string };

export async function startMailSink() {
  const key = process.env.E2E_SINK_KEY, cert = process.env.E2E_SINK_CERT;
  if (!key || !cert) throw new Error("E2E_SINK_KEY / E2E_SINK_CERT are not set: run the suite through wsl-e2e.sh.");
  const port = Number(process.env.E2E_SINK_PORT ?? 3399);
  const mails: SentMail[] = [];
  const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { mails.push(JSON.parse(body)); } catch { /* not a mail */ }
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(port, resolve));
  return {
    mails,
    /** The newest mail to `to`, waiting up to 15 s for it. */
    async latest(to: string) {
      let m: SentMail | undefined;
      await expect.poll(() => (m = [...mails].reverse().find((x) => x.to === to)), { timeout: 15_000 }).toBeTruthy();
      return m!;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
