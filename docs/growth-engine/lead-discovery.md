# Lead discovery and imports

Geography: India → State → District → City → PIN → leads. All 28 states and 8 union territories are canonical names
(abbreviations such as `MH`, `Orissa`, `New Delhi` are accepted on import). PIN codes must be 6 digits starting 1-9.

## Approved sources (and what is not done)

| Source | How | Licence handling |
|---|---|---|
| OpenStreetMap | Lead discovery screen → Overpass API (`amenity=pharmacy`, `healthcare=pharmacy`) in a state, optionally a district/city boundary and PIN | ODbL: "© OpenStreetMap contributors" kept on the source; every lead links to its OSM object |
| Official directories, official API exports, licensed providers, pharmacy-submitted lists | Import centre (CSV/XLSX) | The importer names the source, its licence/attribution and whether export is allowed, and confirms lawful collection |
| Manual entry | All pharmacy leads → Add lead | Source "Added by Medoro staff" |

Not done, by design: Google Maps scraping (against Google's terms), any scraping with CAPTCHA bypass or proxy rotation,
email guessing, social-profile scraping, patient data.

Discovery runs once inline and otherwise as a background job (retries with backoff when Overpass is busy). One query per
search, descriptive User-Agent; set `OVERPASS_URL` to your own instance for heavy use, `GROWTH_OSM=off` to disable.
Pharmacies on the map without a phone or address are kept (their map position is a location) in *Research pending*.

## Import pipeline

1. Upload `.csv` or `.xlsx` (≤ 10 MB, ≤ 10,000 rows; on Vercel the request limit is ~4.5 MB, split larger files).
2. Columns are mapped automatically from common headers (Pharmacy Name, Mobile No, Pincode, E-mail…); the mapping can be
   changed and re-checked.
3. Preview, with nothing saved: each row is **new**, **possible duplicate** (created and queued for review),
   **duplicate** (skipped), **invalid** (with reasons) or **erased** (the pharmacy asked for erasure).
4. Import: the server re-checks the file (the preview isn't trusted). ≤ 200 rows finish in the request; larger files are
   a resumable job processed in chunks; each row and the progress counter commit together, so a retry never doubles rows.
5. History lists every import; the error report downloads as a formula-safe CSV.

Normalisation: phones → E.164 (`+91` + 10 digits; mobiles and STD landlines; toll-free rejected), emails lower-cased and
validated, websites reduced to a domain, states canonicalised.

## Duplicates

| Match | Rule | Effect |
|---|---|---|
| Same phone (E.164) or same website domain | strong | Not created. On import, the existing lead gets an evidence row "Also listed in import IMP-…" so the source record is kept |
| Same PIN and name similarity ≥ 85 % (noise words like *medical, stores, chemist, general* removed) or address similarity ≥ 90 % | possible | Created, flagged, queued in Lead verification |

Uncertain matches are never merged automatically. **Safe merge** keeps one record, fills only its blank fields, moves
contacts, notes, calls, follow-ups, demos, consents and conversations to it, carries over verifications only for the
same fact, and keeps the other record (with its evidence and timeline) as history marked *Duplicate*.

## Verification and scoring

Statuses: Unverified, Business / Phone / Email / Website verified (one dimension), Partially verified (two or more),
Invalid, Duplicate. A dimension is verified only with an evidence row (method + description ≥ 10 characters):
licence/GST check, field visit, call confirmation (the employee ticks "the person who answered confirmed this number"),
email reply, or the automatic website check (SSRF-safe fetch; verified only if the page names the pharmacy or shows its
phone). Changing a fact withdraws its verification.

Score (max 100), recomputed on every change, breakdown and evidence shown on the lead:

| Dimension | Points |
|---|---|
| Verified business identity | 20 if verified, else 0 |
| Verified public contact | 20 phone confirmed on a call; 15 email verified; 0 if only listed |
| Digital presence | 15 website verified; 5 listed; 0 |
| Verified location | 15 confirmed; 8 full address + PIN + map position from source; 6 without position; 0 |
| Potential software requirement | user-provided only: 15 none/paper; 10 other software, unhappy; 3 satisfied; 0 not asked |
| Positive engagement | 15 demo/converted; 12 interested; 8 asked for follow-up; 5 spoke; 0 |

AI inferences are shown but never scored.
