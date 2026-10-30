# Medoro brand and marketing site

Decisions behind the public site (`/`, `/start`, `/legal`). The app under `/app` keeps its own UI tokens (`src/app/globals.css` `@theme`); the site's tokens are scoped to `.site-root` so nothing leaks into the product.

## Reference and pattern

- Product type (ui-ux-pro-max): *Pharmacy / B2B healthcare SaaS* → style **Flat + Accessible & Ethical**, secondary **Minimalism / Swiss**; landing pattern **Trust & Authority + Conversion** combined with **Product Demo + Features**.
- Section order: hero with the real product → standards strip and "works with" → problem/outcome → keyboard demo → feature tabs with real screens → facts → comparison → switching → security and data ownership → pricing → FAQ → final CTA → footer.
- Motion references (MotionSites): scroll-linked product reveal, staggered reveals, a paused-on-hover marquee, count-ups and sticky feature tabs. Used with restraint: one or two moving things per view.

## Colour

| Token | Value | Use |
|---|---|---|
| `--s-brand` | `#0B5E5B` | The one brand colour (deep teal from the logo's green, darkened for 7.4:1 on white). Buttons, links, highlights. |
| `--s-brand-ink` | `#084744` | Hover/pressed brand. |
| `--s-brand-tint` | `#E7F2F0` | Selected tab, badges. |
| `--s-ink` / `--s-ink-2` / `--s-muted` | `#0E1614` / `#36403E` / `#556260` | Text. Muted is still 6.4:1 on white. |
| `--s-line` / `--s-soft` | `#E2E6E5` / `#F5F7F6` | Rules and alternate section background. |
| `--s-dark` | `#0A1D1C` | Two dark bands (keyboard demo, security) for rhythm. |

No accent colour. WhatsApp green (`#146C43`, darkened for contrast) appears only on WhatsApp actions. The logo's navy and green stay in the wordmark only. No gradients, blobs or glass.

## Type

- **IBM Plex Sans Condensed 700** (`.site-display`) for H1/H2 and big figures, sentence case, tight tracking, `text-wrap: balance`.
- **IBM Plex Sans** for body: 16–19 px, line-height 1.55–1.6, measure ≤ 680 px.
- **IBM Plex Mono** (`.site-num`) for data that is literally typed or printed: keys, batch and invoice numbers, step numbers.
- **IBM Plex Sans Devanagari** carries the हिंदी hero.
- All fonts are local (`@fontsource`); no external requests.

## Layout

12-column grid, content max-width 1200 px, 24 px gutters (16 px under 640 px). Sections breathe at `clamp(72px, 10vw, 128px)`. Rules instead of boxes wherever a list will do; cards only for pricing and the security diagram.

## Imagery

Real screens only, captured from the running app with demo data for a Pune pharmacy (`e2e/screenshots.capture.ts`, run with `CAPTURE=1 … wsl-e2e.sh web --project=capture`). Hero: dashboard in a plain browser frame plus the owner's phone view. Feature tabs: the app's main area cropped without the sidebar so text stays legible. WebP, 2000 px (hero) and 1600 px (features), served through `next/image`; only the hero image is `priority`.

No stock photos, no avatars, no customer logos, no testimonials and no metrics we cannot prove. The facts strip states product facts (trial length, price, data on Medoro's servers, languages).

## Copy

Plain, specific, Indian-pharmacy-native: brands (Dolo 650, Pan-D, Azithral 500), Schedule H/H1, FEFO, GSTR-1/3B, distributors, the CA. Claims match what the app does today; when in doubt, the FAQ answers conservatively. Competitors are never named; the comparison is with "typical desktop billing software".

## Motion

- CSS scroll-driven animations (`animation-timeline: view()`) for section reveals, the hero product tilt-to-flat and the phone's parallax. Browsers without support get an IntersectionObserver fallback for reveals (`SiteMotion`), and a static hero.
- One-shot keyboard demo (F2 → Enter → F9) and count-ups start when scrolled into view.
- Marquee pauses on hover, focus and with its pause button.
- Only `transform` and `opacity` are animated. `prefers-reduced-motion: reduce` turns all of it off and shows the final state.

## Accessibility

Semantic landmarks and one H1, skip link, visible 3 px focus rings, ARIA tabs with arrow/Home/End keys, native `<details>` FAQ, 44 px touch targets on mobile, descriptive alt text on every screen, AA contrast or better throughout.
