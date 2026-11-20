# Audit evidence

| File | What it is |
|---|---|
| `e2e-final-ci-config.txt` | Final Playwright run on the final build, CI configuration (no email): 72 passed, 2 skipped, 1 failed (needs the mail sink) |
| `e2e-final-email-config.txt` | Final Playwright runs with email delivered to the HTTPS mail sink, and spec 33 with public sign-up |
| `vitest-final.txt` | Final Vitest summary: 189 files, 1,189 tests passed |
| `live-crawl.json` | Live crawl of https://medoro.in: 80 pages × desktop/phone (status, load time, console-error count, widths, title, H1, canonical) and the status of all 85 links |
| `live-perf.json` | Live Web Vitals (median of 3) for six pages, desktop and Pixel 7 |
| `live-tour-after-clicks.png` | The homepage's embedded tour after clicking its navigation: renders and responds despite BUG-09's console errors |
| `perf-indexes.sql` | Synthetic volume (400k shifts, 600k WhatsApp messages over 1,000 tenants) and the `EXPLAIN ANALYZE` queries for BUG-06 |
| `explain-before-after.txt` | The plans measured before and after migration `20261215000000_hot_path_indexes` |
