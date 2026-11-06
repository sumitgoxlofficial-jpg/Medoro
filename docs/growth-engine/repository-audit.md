# Open-source repository audit

Audited on 6 Nov 2026 from shallow clones of each default branch. Every repository was read as data (README, LICENSE,
manifests, key source files); none was executed. **No code, dependency or data file from these repositories is included
in Medoro.** Growth Intelligence is a native implementation; the repositories informed concepts only. Because nothing was
imported, Medoro's dependency tree and supply-chain exposure are unchanged by this module (no new npm packages).

| # | Repository | Commit (HEAD) | Last commit | Licence | Stack / dependencies | Decision |
|---|---|---|---|---|---|---|
| 1 | [Kappaemme-git/codex-first-customer-finder-skill](https://github.com/Kappaemme-git/codex-first-customer-finder-skill) | `d3f6964bd989745ac183edbd545c588a68451146` | 2026-09-19 | MIT | Node installer, Python 3.9 stdlib helpers, a Codex skill | **Concepts adopted** |
| 2 | [Mahanaicoach/google-maps-scraper-kit](https://github.com/Mahanaicoach/google-maps-scraper-kit) | `15dd80b584dfeab550271ba383b540af8f44d1d2` | 2026-11-02 | MIT | Python stdlib, Chrome; optional Playwright; sponsored proxy/SERP links | **Rejected** (audit only) |
| 3 | [kiryano/Scout](https://github.com/kiryano/Scout) | `183868d4fe4b9800d649d814ad8685750cc5637d` | 2026-09-05 | MIT | Python: requests, httpx, dnspython, free-proxy, rich | **Rejected** |
| 4 | [adityajha2005/yc-outreach](https://github.com/adityajha2005/yc-outreach) | `2e0f26ec1b0812b6031a39d236e911649ce6b67f` | 2026-10-21 | MIT | Python stdlib, single HTML page; optional Apify | **Concept adopted** (template personalisation, reliability labels) |
| 5 | [gooseworks-ai/goose-skills](https://github.com/gooseworks-ai/goose-skills) | `1add09bd8e0d057e91e25c96b9282498e2fcb2a2` | 2026-10-25 | MIT | Markdown skills, Node build scripts | **Reviewed**; no content copied |
| 6 | [GetBrew/growth-engineer](https://github.com/GetBrew/growth-engineer) | `d8a0e45417ebe2f047a7bbe2b44a176b5f31718d` | 2026-11-02 | MIT | Next.js site + MCP server, Markdown catalogue | **Reviewed**; concept of "ask before sending or spending" adopted |
| 7 | [growthenginenowoslawski/coldoutboundskills](https://github.com/growthenginenowoslawski/coldoutboundskills) | `25c5d85fbb5dd3efec97b0ca457cbbc286547476` | 2026-10-05 | MIT | Markdown skills; bundled CSVs incl. a 12M-row Google Maps scrape | **Playbook ideas only**; bundled data **not used** |
| 8 | [warmbly/warmbly](https://github.com/warmbly/warmbly) | `838afc124eb85e3fc6ae1c9b9143881fd0875c87` | 2026-11-05 | **Apache-2.0** | Go control plane + workers, Postgres, Redis, Rust tracker, Next.js apps | **Concepts adopted** (suppression, bounce handling, per-sender caps); not deployed |
| 9 | [oneshot-agent/oneshot-gtm](https://github.com/oneshot-agent/oneshot-gtm) | `eb8273840ca9891c0f49983583a5f9d751c626be` | 2026-11-05 | MIT | Bun + Turbo monorepo, `bun:sqlite`, paid OneShot actions | **Concepts adopted** (approval queue, caps, reply stops cadence) |
| 10 | [melgarafael/DeskcommCRM](https://github.com/melgarafael/DeskcommCRM) | `fcbe56a3ede3fbb07e41f9b04d5dd247ace54427` | 2026-11-06 | MIT | Next.js/TS CRM, Docker, WAHA (WhatsApp Web) + Meta Cloud API, Asterisk | **CRM workflow concepts adopted**; WAHA path **rejected** |

All nine MIT licences are the standard 21-line text with no added clauses (no Commons Clause or non-commercial terms);
Warmbly is unmodified Apache-2.0. Commercial use is permitted by all ten. Since no code was copied, no attribution or
NOTICE obligations arise in Medoro. If code is ever copied later, keep the MIT copyright line (or Apache NOTICE) with it.

## Per repository

**1. First Customer Finder.** A Codex skill that finds prospects with a *public reason* to care, labels each claim as
observed or inferred, verifies a public contact route, keeps stable prospect IDs, excludes duplicates and records outcomes;
it never sends outreach. Its README states that "public route verification means Codex inspected the page, not that the
recipient consented". *Adopted:* fact provenance labels (verified / told to us / from source / AI-inferred / unknown),
weighted score where missing data lowers its own dimension, stable lead codes, duplicate exclusion, "never fill a quota with
weak matches". *Limitation:* designed for one founder's research sessions, not a team CRM.

**2. Google Maps Scraper Kit.** Scrapes Google Maps without an API key. Its own FAQ says scraping Google Maps "is against
Google's Terms of Service" and that phones and emails are personal data. Sponsored by proxy and SERP vendors.
*Decision:* not used; Medoro does no Google Maps collection. OpenStreetMap (ODbL, Overpass API) is used instead for map
discovery.

**3. Scout.** Scrapes Instagram, TikTok, LinkedIn (with a session cookie), YouTube etc., guesses emails and checks them
with SMTP probing; ships a `proxies.example.txt` and depends on `free-proxy`. *Decision:* rejected: platform-terms
violations, proxy rotation to evade limits, SMTP probing, and personal-profile data unrelated to pharmacy businesses.
*Idea kept:* a 0-100 lead score, implemented differently (evidence only).

**4. YC Outreach.** Pulls YC's public directory and fills founder emails labelled `verified`, `unverified`, `on site` or
`guess`. *Adopted:* the honest reliability label idea and "write once, personalise from a template". *Rejected:* guessed
email addresses (Medoro never invents contact details).

**5. Goose Skills** and **6. Growth Engineer.** Catalogues of marketing playbooks and GTM tool references as Markdown.
Reviewed for structure (one motion per playbook, inputs/outputs, "ask before sending or spending money"). Nothing copied;
Medoro's call scripts, objection answers and message templates were written for Indian pharmacies and Medoro's own
product facts.

**7. Cold Outbound Skills.** Claude skills for cold email infrastructure (domain buying, warm-up, Smartlead), list building
and copy; bundles large CSVs including a "Google Maps Scrape – 12M US Businesses". *Ideas kept:* list-quality checks
before upload, deliverability hygiene. *Not used:* the bundled data (provenance and US-only), inbox-farm tactics.

**8. Warmbly.** Apache-2.0 Go platform for cold email with warm-up pools, unified inbox, CRM and suppression. *Adopted
concepts:* suppression list fed by bounces/complaints/unsubscribes, per-sender daily caps, unified inbox. *Not deployed:*
it needs Redis, Go workers and its own Postgres; Medoro's email goes through its existing provider adapter
(`MAIL_PROVIDER`). Warm-up pools are not used (they exist to send cold email at volume, which Medoro's consent rule avoids).

**9. OneShot GTM.** Founder outbound: finders, an ICP gate, an approval queue where "approval sends nothing", daily send
caps that ramp, and "a reply on any channel stops the cadence". *Adopted:* human approval before campaigns, daily caps,
reply marks the recipient `replied`. *Not used:* Bun runtime, paid per-call actions.

**10. DeskcommCRM.** Portuguese open-source WhatsApp CRM with AI agents, pipelines and a WhatsApp connection through WAHA
(WhatsApp Web automation via QR) or the official Cloud API. *Adopted:* pipeline stages, lost-reason tracking, unified
inbox layout ideas. *Rejected:* WAHA / QR-code WhatsApp Web automation (against WhatsApp's terms; risks bans) and its
"anti-ban" throttling. Medoro uses the official Cloud API only.

## Security advisories

No repository code runs in Medoro, so their advisories do not affect it. The audit did not run each project's own
dependency scanners; anyone adopting code from them later should run `npm audit`/`pip-audit`/`govulncheck` on that
project at the pinned commit above. Noted risks in the projects themselves: proxy lists and scraping (2, 3), SMTP probing
(3), WhatsApp Web automation (10).
