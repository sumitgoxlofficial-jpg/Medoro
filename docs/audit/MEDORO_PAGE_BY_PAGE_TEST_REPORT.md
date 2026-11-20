# Medoro: page-by-page test report

Live site `https://medoro.in`, crawled 20 November 2026 (Vercel, `bom1`) with Playwright/Chromium from a cloud sandbox (requests go through a proxy, so absolute load times include that hop).

**Method.** Start from `sitemap.xml` (63 URLs) plus the sign-in/sign-up entry points, then follow every internal link found on each page. Each page was loaded at **desktop 1366×800** and **phone 375×740**. Recorded per load: HTTP status, console errors and page errors, failed requests (4xx/5xx on medoro.in), broken images, horizontal overflow (document wider than the viewport, and which element causes it), `<title>`, meta description, H1 count, canonical, images without `alt`, buttons without an accessible name, inputs without a label. Every link found (85) was then requested on its own.

**Summary.** 80 pages discovered and tested, 160 page loads. 76 pages PASS on both viewports with no console errors, no broken images and no horizontal overflow. Defects: 2 broken internal links (fixed), CSP console noise on the embedded tour (open, LOW). The in-app screens (`/app`, `/dist`, `/staff`, `/print`) need a signed-in session and are covered by the e2e suite (feature report), including spec 15, which opens every screen in the owner's navigation and checks its links.

## Pages from your checklist

| Checklist page | URL tested | Result |
|---|---|---|
| Homepage | `/` | PASS (2.8 s desktop full load, LCP 2.0 s) |
| Product pages (Billing & POS, Inventory & Expiry, Purchases & GRN, GST & Accounts, WhatsApp & Refills, Offline & Branches, Security & Data) | `/features/*`, `/pharmacy-billing-software`, `/pharmacy-inventory-software`, `/pharmacy-accounting-software`, `/medical-store-stock-management-software`, `/gst-billing-software-for-pharmacy` and homepage sections | PASS |
| Pricing | `/#pharmacy-pricing`, `/#distribution-pricing` | PASS: ₹999 / ₹2,499 / ₹4,499 / AI ₹499 match `src/staff/constants.ts`; extras ₹1,999 setup, ₹2,999+ migration, ₹799 extra branch |
| FAQ | homepage FAQ section (also JSON-LD FAQPage) | PASS |
| Switching to Medoro | `/compare`, `/compare/*` | PASS |
| Become a Partner | `/partners` | PASS |
| About Medoro | `/about-medoro`, `/legal#about` | PASS |
| Contact, Help & Setup, Backup & Recovery, Privacy Policy, Terms, Cancellation & Refund, Cookie Policy, DPDP Rights, Grievance Officer | `/legal#contact`, `#help`, `#backup`, `#privacy`, `#terms`, `#refund`, `#cookies`, `#dpdp`, `#grievance` (one page with sections) | PASS; note `/legal/terms` and `/legal/privacy` do not exist (see BUG-01) |
| Login | `/signin` | PASS (no H1 on the sign-in card, see SEO notes) |
| Pharmacy Staff Login | `/signin?view=employee` (footer link) | PASS |
| Free Trial Registration | `/trial`, `/signup`, `/start`, `/distributor-signup` | PASS (page); the email-code flow is tested end to end in e2e spec 33 |
| WhatsApp demo CTA | `https://wa.me/917320001062?...` | NOT TESTED: `wa.me` is not reachable from this sandbox's network policy; the link format is correct |

## CTAs
"Start 7-day free trial" (header, hero, pricing, footer) → `/trial` (200); Distribution trial → `/distributor-signup` (200); "Log in" → `/signin` (200); "Pharmacy staff login" → `/signin?view=employee` (200); "Medoro employee login" → `/staff/employee` (200); pricing anchors resolve on the homepage. WhatsApp CTAs: see above.

## All pages

| # | Page | HTTP | Desktop load (ms) | Phone load (ms) | Phone width (scroll/viewport) | SEO | Defects | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | `/` | 200 | 2758 | 2161 | 375/375 | ok | none | PASS |
| 2 | `/about-medoro` | 200 | 1234 | 1106 | 375/375 | ok | none | PASS |
| 3 | `/blog` | 200 | 1005 | 1333 | 375/375 | ok | none | PASS |
| 4 | `/blog/choose-pharmacy-billing-software` | 200 | 1129 | 1054 | 375/375 | ok | none | PASS |
| 5 | `/blog/fefo-vs-fifo-pharmacy` | 200 | 1034 | 1067 | 375/375 | ok | none | PASS |
| 6 | `/blog/gst-on-medicines-india` | 200 | 1420 | 1077 | 375/375 | ok | none | PASS |
| 7 | `/blog/gst-returns-for-pharmacy` | 200 | 1190 | 1004 | 375/375 | ok | none | PASS |
| 8 | `/blog/how-to-calculate-ptr-pts-from-mrp` | 200 | 1565 | 1067 | 375/375 | ok | none | PASS |
| 9 | `/blog/how-to-start-a-medical-store-in-india` | 200 | 1123 | 1056 | 375/375 | ok | none | PASS |
| 10 | `/blog/reduce-expiry-loss-medical-store` | 200 | 1097 | 989 | 375/375 | ok | none | PASS |
| 11 | `/blog/rss.xml` | 200 | 803 | 537 | 375/375 | no title, no description, 0 h1, no canonical | none | PASS |
| 12 | `/blog/schedule-h-h1-x-rules-pharmacy` | 200 | 1166 | 1092 | 375/375 | ok | none | PASS |
| 13 | `/careers` | 200 | 1215 | 1161 | 375/375 | ok | none | PASS |
| 14 | `/careers/marketing-manager` | 200 | 1142 | 1150 | 375/375 | ok | none | PASS |
| 15 | `/careers/marketing-manager-bokaro-cd4b3f` | 200 | 909 | 898 | 375/375 | ok | none | PASS |
| 16 | `/compare` | 200 | 1052 | 1031 | 375/375 | ok | none | PASS |
| 17 | `/compare/logic-erp-alternative` | 200 | 1126 | 1185 | 375/375 | ok | none | PASS |
| 18 | `/compare/marg-erp-alternative` | 200 | 1164 | 1301 | 375/375 | ok | none | PASS |
| 19 | `/compare/redbook-alternative` | 200 | 1164 | 1069 | 375/375 | ok | none | PASS |
| 20 | `/compare/vyapar-alternative-for-pharmacy` | 200 | 1241 | 898 | 375/375 | ok | none | PASS |
| 21 | `/distributor-signup` | 200 | 961 | 931 | 375/375 | no canonical | none | PASS |
| 22 | `/features` | 200 | 1145 | 1235 | 375/375 | ok | none | PASS |
| 23 | `/features/ai-invoice-scanner` | 200 | 1196 | 1002 | 375/375 | ok | none | PASS |
| 24 | `/features/expiry-management` | 200 | 1088 | 1158 | 375/375 | ok | none | PASS |
| 25 | `/features/gst-billing` | 200 | 1232 | 1399 | 375/375 | ok | none | PASS |
| 26 | `/features/inventory-management` | 200 | 1218 | 1626 | 375/375 | ok | none | PASS |
| 27 | `/features/schedule-h1-compliance` | 200 | 1249 | 1702 | 375/375 | ok | none | PASS |
| 28 | `/gst-billing-software-for-pharmacy` | 200 | 1178 | 1177 | 375/375 | ok | none | PASS |
| 29 | `/legal` | 200 | 1025 | 980 | 375/375 | no canonical | none | PASS |
| 30 | `/legal/privacy` | 404 | 826 | 824 | 375/375 | no canonical | HTTP 404; 2 console errors (Failed to load resource: the server responded with a status ) | n/a (link target) |
| 31 | `/legal/terms` | 404 | 838 | 821 | 375/375 | no canonical | HTTP 404; 2 console errors (Failed to load resource: the server responded with a status ) | n/a (link target) |
| 32 | `/medical-billing-saas` | 200 | 1426 | 1129 | 375/375 | ok | none | PASS |
| 33 | `/medical-store-software` | 200 | 1215 | 1160 | 375/375 | ok | none | PASS |
| 34 | `/medical-store-stock-management-software` | 200 | 1036 | 1833 | 375/375 | ok | none | PASS |
| 35 | `/offline` | 200 | 808 | 840 | 375/375 | 0 h1, no canonical | none | PASS |
| 36 | `/partners` | 200 | 1860 | 1605 | 375/375 | no canonical | none | PASS |
| 37 | `/pay` | 200 | 976 | 910 | 375/375 | no canonical | none | PASS |
| 38 | `/pharmacy-accounting-software` | 200 | 1164 | 1347 | 375/375 | ok | none | PASS |
| 39 | `/pharmacy-billing-software` | 200 | 1298 | 1445 | 375/375 | ok | none | PASS |
| 40 | `/pharmacy-inventory-software` | 200 | 1130 | 1198 | 375/375 | ok | none | PASS |
| 41 | `/pharmacy-software-in-ahmedabad` | 200 | 979 | 1061 | 375/375 | ok | none | PASS |
| 42 | `/pharmacy-software-in-bangalore` | 200 | 1133 | 1170 | 375/375 | ok | none | PASS |
| 43 | `/pharmacy-software-in-bihar` | 200 | 1199 | 1072 | 375/375 | ok | none | PASS |
| 44 | `/pharmacy-software-in-bokaro` | 200 | 1142 | 1143 | 375/375 | ok | none | PASS |
| 45 | `/pharmacy-software-in-chennai` | 200 | 1098 | 1306 | 375/375 | ok | none | PASS |
| 46 | `/pharmacy-software-in-delhi` | 200 | 1261 | 1090 | 375/375 | ok | none | PASS |
| 47 | `/pharmacy-software-in-dhanbad` | 200 | 1182 | 950 | 375/375 | ok | none | PASS |
| 48 | `/pharmacy-software-in-gujarat` | 200 | 1492 | 1070 | 375/375 | ok | none | PASS |
| 49 | `/pharmacy-software-in-hyderabad` | 200 | 1190 | 1090 | 375/375 | ok | none | PASS |
| 50 | `/pharmacy-software-in-india` | 200 | 1204 | 1123 | 375/375 | ok | none | PASS |
| 51 | `/pharmacy-software-in-jaipur` | 200 | 990 | 1053 | 375/375 | ok | none | PASS |
| 52 | `/pharmacy-software-in-jamshedpur` | 200 | 1092 | 1269 | 375/375 | ok | none | PASS |
| 53 | `/pharmacy-software-in-jharkhand` | 200 | 1211 | 1188 | 375/375 | ok | none | PASS |
| 54 | `/pharmacy-software-in-karnataka` | 200 | 1251 | 1095 | 375/375 | ok | none | PASS |
| 55 | `/pharmacy-software-in-kolkata` | 200 | 1285 | 904 | 375/375 | ok | none | PASS |
| 56 | `/pharmacy-software-in-lucknow` | 200 | 1226 | 1088 | 375/375 | ok | none | PASS |
| 57 | `/pharmacy-software-in-maharashtra` | 200 | 1122 | 1168 | 375/375 | ok | none | PASS |
| 58 | `/pharmacy-software-in-mumbai` | 200 | 1232 | 1150 | 375/375 | ok | none | PASS |
| 59 | `/pharmacy-software-in-patna` | 200 | 1186 | 1073 | 375/375 | ok | none | PASS |
| 60 | `/pharmacy-software-in-pune` | 200 | 1023 | 1092 | 375/375 | ok | none | PASS |
| 61 | `/pharmacy-software-in-ranchi` | 200 | 1131 | 1084 | 375/375 | ok | none | PASS |
| 62 | `/pharmacy-software-in-uttar-pradesh` | 200 | 1175 | 1091 | 375/375 | ok | none | PASS |
| 63 | `/portal/register` | 200 | 1015 | 948 | 375/375 | no canonical | 2 console errors (Failed to load resource: the server responded with a status ); failed subresources: 404 https://medoro.in/legal/terms?_rsc=2N-YSXS7Zb3O3w2l, 404 https://medoro.in/legal/priva | FAIL → fixed |
| 64 | `/portal/signin` | 200 | 1198 | 1265 | 375/375 | no canonical | none | PASS |
| 65 | `/signin` | 200 | 1126 | 1026 | 375/375 | 0 h1, no canonical | none | PASS |
| 66 | `/signup` | 200 | 1278 | 1062 | 375/375 | no canonical | none | PASS |
| 67 | `/solutions` | 200 | 1035 | 1188 | 375/375 | ok | none | PASS |
| 68 | `/solutions/ayurvedic-stores` | 200 | 1276 | 1084 | 375/375 | ok | none | PASS |
| 69 | `/solutions/hospital-pharmacy` | 200 | 1148 | 1137 | 375/375 | ok | none | PASS |
| 70 | `/solutions/pharmacy-chains` | 200 | 1216 | 1100 | 375/375 | ok | none | PASS |
| 71 | `/solutions/retail-pharmacy` | 200 | 1176 | 1057 | 375/375 | ok | none | PASS |
| 72 | `/staff/employee` | 200 | 935 | 978 | 375/375 | no canonical | none | PASS |
| 73 | `/staff/login` | 200 | 1129 | 980 | 375/375 | no canonical | none | PASS |
| 74 | `/start` | 200 | 957 | 893 | 375/375 | no canonical | none | PASS |
| 75 | `/tools` | 200 | 1250 | 1037 | 375/375 | ok | none | PASS |
| 76 | `/tools/free-pharmacy-invoice-generator` | 200 | 1276 | 1220 | 375/375 | ok | none | PASS |
| 77 | `/tools/medicine-hsn-code-finder` | 200 | 1120 | 1514 | 375/375 | ok | none | PASS |
| 78 | `/tools/pharma-margin-calculator` | 200 | 1179 | 1200 | 375/375 | ok | none | PASS |
| 79 | `/tour/index.html` | 200 | 1230 | 1246 | 375/375 | no description, no canonical | 788 console errors (Executing inline event handler violates the following Conten) | PARTIAL |
| 80 | `/trial` | 200 | 1609 | 1277 | 375/375 | no canonical | none | PASS |

`/blog/rss.xml` is the RSS feed (XML, no title/H1 expected). `/tour/index.html` is the sandboxed product-tour prototype.

## Defects
| Id | Page | Defect | Status |
|---|---|---|---|
| BUG-01 | `/portal/register` | Links to `/legal/terms` and `/legal/privacy`, which return 404 (the legal page uses `/legal#terms` and `/legal#privacy`) | FIXED; regression test `src/data/internal-links.test.ts` checks every static internal link in the source |
| BUG-09 | `/tour/index.html` (embedded on the homepage) | The prototype runtime's inline event handlers are blocked by the tour's own CSP: 394 console errors per desktop load. The tour still renders and navigates (verified by clicking 6 navigation items) | OPEN, LOW (console noise; vendored prototype runtime) |

## SEO notes (not defects)
- Every marketing page has a title, description and exactly one H1. All have a canonical URL except `/partners` and `/legal` (LOW: worth adding, both are indexable). Titles are unique except `/signup` and `/trial` (the same sign-up page) and two career postings for the same role.
- Auth and app entry pages (`/signin`, `/signup`, `/start`, `/trial`, `/pay`, `/staff/*`, `/portal/*`) have no canonical; `/signin` and `/offline` have no H1. These are excluded in `robots.txt` or are utility pages; adding an `<h1>` to the sign-in card would help screen-reader users more than SEO.
- `robots.txt` disallows `/app`, `/staff`, `/api`, `/print`, `/device`, `/support`, `/offline`, `/trial`, `/pay`, `/setup` and `/pharmacy-software-in/` (the location pages are linked as `/pharmacy-software-in-<state>` instead).

## Responsiveness and accessibility
- No horizontal overflow on any page at 375 px; no broken images; no image without `alt`; no unlabeled buttons or inputs, except the tour prototype (2 icon buttons, 3 inputs).
- Hindi: the language switch is on every page; Hindi rendering of the app is covered by e2e and the i18n unit tests. A full human review of the Hindi copy was not done (NOT TESTED).
- Browsers: Chromium only (desktop and phone emulation). Safari, Firefox, Edge and real devices: NOT TESTED (not available in this environment).
