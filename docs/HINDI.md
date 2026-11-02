# Hindi (हिंदी) in Medoro

Every screen a pharmacy uses works in English and Hindi. The language is the `medoro_lang` cookie (the EN / हिं
switch in the header); the root layout reads it and puts `<LangProvider>` around every page.

## How text is translated

The code keeps the English text; Hindi lines are looked up by that exact English text.

| Where | Use |
|---|---|
| Client component (`"use client"`) | `const t = useT();` (from `@/lib/i18n-client`) then `t("Save")`, `placeholder={t("Search medicine")}` |
| Server component / server action | `const t = await getT();` (from `@/server/lang`), or `tFor(ctx.lang)` (from `@/lib/tr`) when you have `ctx` |
| Text inside JSX where a hook can't be used | `<T>Save</T>` (from `@/lib/i18n-client`; works inside server components too) |
| Numbers or names inside a line | `t("Only {n} in this batch.", { n: have })`. One Hindi line covers every value |
| Dates | `toLocaleDateString(localeOf(lang), …)` (`localeOf` from `@/lib/tr`, `useLang()` on the client) |

Plain-text props of the shared pieces are translated for you: `Button`, `Badge`, `Field` (label, hint, error),
`Checkbox` label, `CardHead` (title, sub), `Empty` (title, body), `PageHead` (title, sub), `Modal` (title, sub),
`Segmented` option labels, and every toast (`useToast`, `useActionToast`, so server-action errors too). For these you
only add the Hindi line; no `t()` needed.

**Messages built in code that reach a toast** (errors thrown by `src/domain/*` and `src/drivedb/*`, e.g.
`` `Only ${have} in this batch.` ``) need no code change: add a Hindi line with placeholders,
`"Only {n} in this batch.": "इस बैच में केवल {n} बचे हैं।"`, and the toast matches it. The same matching works for any
`t(dynamicText)`.

## Hindi lines

`src/lib/hi/<area>.ts`, one file per area, merged in `src/lib/hi/index.ts`. Key = English exactly as in the code
(same punctuation, curly apostrophes ’ and ellipsis … included). Placeholders `{name}` must appear in both.
`src/lib/i18n-coverage.test.ts` fails if a `t("…")` / `<T>…</T>` has no Hindi line.

Style: simple everyday Hindi a pharmacy counter uses, in Devanagari. Keep common English trade words people say
anyway in Devanagari or as is: बिल, स्टॉक, बैच, ब्रांच, सप्लायर, GST, UPI, MRP, PIN, OTP, WhatsApp/व्हाट्सऐप, Google
Drive, PDF, CSV, Excel. Keep product names (Medoro, Razorpay, Tally) and codes (GSTIN, HSN, IRN) unchanged. Short
labels stay short. Polite imperative for actions: "सेव करें", "जोड़ें".

## What stays English

Printed GST tax invoices, credit notes and other legal documents (they are shared with customers, suppliers and the
GST portal), legal pages under `/legal`, the Medoro staff console (`/staff`), file formats (CSV/JSON column names),
and log/audit codes.
