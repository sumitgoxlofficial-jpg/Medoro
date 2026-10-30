# AI Pharmacy Manager

## Scope
Business questions in English, Hindi (Devanagari) and Hinglish: sales, stock, batches, expiry, reorders, supplier and customer dues, cash reconciliation, seasonal demand, reports and backups. **No clinical advice.** Dosage, interaction and treatment questions are refused and referred to the pharmacist. Voids, deletions and write-offs are refused in chat.

## Architecture
```
User ─▶ server action ─▶ AI on? ─▶ rate limit ─▶ Rules (refusals) ─▶ Planner (rules, local or remote model)
     ─▶ Tool call (JSON) ─▶ Zod validate ─▶ role check ─▶ Domain service ─▶ audit ─▶ structured result
```
- The model never touches the database. It can only call registered tools, and only the tools the user's role may use are sent to it.
- Each tool: Zod input schema → session (`run()`, read-only support sessions refused) → tenant and branch scope → permission → the same domain service the screens use → audit event → structured output (text, rows, basis, link).
- Code: `src/domain/ai/` — `planner.ts` (rules, pure), `llm.ts` (providers, redaction, chat client), `tools.ts` (registry), `service.ts` (turn loop, confirmation), `settings.ts` (on/off, provider choice), `ratelimit.ts`.

## Tool registry
| Tool | Kind | Permission | Notes |
|---|---|---|---|
| get_sales_summary | read | sale or reports | today, yesterday, week, month; current branch |
| search_medicines | read | — | name, generic, barcode |
| get_batch_inventory | read | — | batches with stock for a medicine at the current or a named branch (only branches the user can access): batch, expiry, qty, held qty, status (sellable, quarantined, damaged, recalled, expired), FEFO order |
| get_expiry_report | read | — | window in days |
| get_low_stock_report | read | — | sellable stock only |
| get_supplier_balances | read | payments | |
| get_customer_outstanding | read | payments | |
| get_cash_reconciliation | read | sale | |
| get_backup_status | read | integrations | |
| get_seasonal_forecast | read | — | month 0–11 |
| generate_report | read | reports | link to `/api/reports/<id>?period=&scope=` (the same CSV export as Accounts, which re-checks `reports` and audits the download). Period `month`, `last`, `fy` or `YYYY-MM`; scope `branch` or `all` (pharmacy-wide reports ignore scope) |
| create_draft_purchase_order | **write · confirm** | purchase + aiAct | draft only, never sent. At confirm, every line is re-checked against current stock; if stock arrived and a line now exceeds what is needed, nothing is saved |
| create_draft_expense | **write · confirm** | payments + aiAct | `recordExpense`. Cash expenses are refused if an open shift's expected drawer cash is less than the amount (checked at preview and again at confirm) |
| request_backup | **write · confirm** | integrations + aiAct | `backupNow` (refuses if a backup is already running) |
| request_stock_adjustment | **write · confirm** | adjust + aiAct | `adjustStock` on one batch at the current branch. Reason required. Confirm refuses if the batch quantity changed since the preview or the user switched branch |
| request_refund | **write · confirm** | refund + aiAct | `processReturn` against an invoice at the current branch (full number or its last digits): the whole invoice or `qty` of one medicine. Reason required; condition defaults to damaged (not restocked) unless the user says sealed. Confirm refuses if any line's returnable quantity changed since the preview |

## Phrasings (rule planner)
English, Hinglish and Devanagari Hindi (Devanagari digits are understood), for example:
- “Show batches of Dolo 650”, “dolo ke batch dikhao”, “batches of crocin at Second branch”
- “GST report last month”, “sales register for all branches csv”, “stock valuation report for August”, “पिछले महीने की GST रिपोर्ट”
- “Record expense ₹1,250 electricity by UPI”, “500 ka chai ka kharcha likho”, “₹500 बिजली का खर्च”
- “Take a backup now”, “backup le lo”
- “Adjust Dolo 650 batch DL1 by -2 reason damaged strip”, “dolo batch DL1 ka stock 2 kam karo kyunki toot gaya”
- “Refund invoice INV/MAI/2627/000123, sealed, reason wrong medicine”, “return 2 dolo 650 from invoice 17 by upi reason not needed”, “bill 42 ka refund karo, wajah …”
Missing details (amount, batch, invoice, direction) get a one-line follow-up question instead of a guess.

## Confirmation protocol
1. The tool returns a preview and `confirm: {token, label, expiresAt}`; “AI action proposed” is audited. The token is single-use, expires in 5 minutes and is bound to the user, the tool and a hash of the exact input (including the batch, lines and quantities the preview resolved).
2. The drawer shows the preview with the action button (“Record expense”, “Adjust stock”, …) and Cancel.
3. On confirm: session re-checked, AI still enabled, `aiAct` and the tool's permissions re-checked, input hash verified, token claimed atomically, then **business rules re-validated against current data** (`revalidate`). A failed re-validation is audited as “AI action refused at confirm” and the user must ask again. The domain service then runs with its own checks, and “AI action confirmed” is audited.

## Planner and providers
- Refusals (clinical, voids/deletions) always come from the rules and never reach a model.
- `AI_MODE=rule`: rules only. `AI_MODE=local`: Ollama at `LOCAL_LLM_URL` (`/api/chat`). `AI_MODE=remote`: an OpenAI-compatible chat-completions endpoint (`REMOTE_AI_URL`, e.g. `https://api.example.com/v1`, `REMOTE_AI_KEY` as a bearer token, `REMOTE_AI_MODEL`). Without `AI_MODE`, a configured local model is used, else rules.
- `LOCAL_LLM_URL` is classified by host: loopback (localhost, 127.0.0.0/8, ::1), private (10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10) or public. DNS names other than `localhost` are public. A public “local” URL is treated as remote.
- **Strict mode**: only a loopback model is used; anything else falls back to the rules. **Remote** (including public “local” URLs) is used only when the owner allowed a remote AI provider on Privacy & data and strict mode is off, and must use https unless on a private network. Otherwise the assistant answers from the rules.
- With a model, a turn is a tool-calling loop: the model calls read tools, results go back to it, and its short answer is shown with the last tool's rows and basis. A write tool call ends the turn with a preview. If the model answers without calling any tool, the rules answer instead (ungrounded text is never shown). If the model server is unreachable, the rules answer.

## Language
- Devanagari questions, or the Hindi UI, are answered in Hindi: rule replies, refusals, follow-up questions, read-tool answers, previews and confirm labels have Hindi templates, and models are instructed to reply in Hindi (Devanagari). Hinglish questions get Hinglish refusals and help; models are told to reply in Hinglish.

## Limits
- Per tool 5 s, per turn 20 s, at most 4 tool calls per question (`AI_TOOL_TIMEOUT_MS`, `AI_TURN_TIMEOUT_MS`, `AI_MAX_TOOL_CALLS`). Over budget, the user gets a plain message (or what was found so far, with a note). Confirmed writes are not cut off mid-way.
- 30 questions per user per minute (`AI_RATE_PER_MIN`), a sliding window in Postgres (`AiAsk`, per-user advisory lock), so it holds across app instances.
- Tool results sent to a model are capped at 4,000 characters and 15 rows.

## Audit
Every tool call is audited (entity `ai`): “AI query” (tool, answered from rules/local/remote; no question text), “AI request refused” (role), “AI action proposed”, “AI action refused at confirm”, “AI action confirmed”. The underlying services write their own events (voucher, stock adjustment, credit note, backup). “AI settings changed” records on/off and name-sharing changes.

## Safety
- Read-only by default. Write tools are hidden from the model unless the role has `aiAct` and the tool's permission; a model that names a hidden tool gets a refusal.
- Prompt-injection defence: the system prompt tells the model that tool results are data, not instructions. Tool outputs are capped in size.
- Outputs show the tool name and data basis. Forecasts state the period, assumptions and uncertainty.

## On/off
- Owners and managers can switch the assistant off for the pharmacy (Privacy & data, or “Turn off” in the drawer). Off: the Ask AI button, Ctrl+J and the drawer are hidden for staff; owners and managers see a “Turn the assistant on” panel; every AI server action refuses. Billing never depends on it.
- `AI_ENABLED=0` (or `false`) switches it off for every pharmacy on the server; nothing can turn it on from the app.

## Privacy
- Rules or a local model by default (Ollama on the app host).
- Remote provider: opt-in by the owner, never in strict mode. Sent: the question and tool results (totals, item and supplier names). Customer names (all of the pharmacy's customers, matched as whole words), phone numbers and emails are replaced with placeholders like `[customer 1]` before sending and put back in the answer on the server, unless the owner turns on “Share customer names with the remote AI”. Nothing from the payloads is logged; failures log only the HTTP status. No training on pharmacy data is requested.
