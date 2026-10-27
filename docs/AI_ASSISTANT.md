# AI Pharmacy Manager

## Scope
Business questions in English, Hindi and Hinglish: sales, stock, expiry, reorders, supplier dues, cash reconciliation, margins, backups. **No clinical advice.** Dosage, interaction and treatment questions are refused and referred to the pharmacist.

## Architecture
```
User ─▶ Chat API ─▶ Planner (LLM) ─▶ Tool call (JSON) ─▶ Zod validate ─▶ AuthZ ─▶ Domain service ─▶ Result
                                   ◀── structured result ◀────────────────────────────────────────┘
```
- The model never touches the database. It can only call registered tools.
- Each tool: Zod input schema → `requireUser()` → tenant and branch scope → `can(perm)` → service call → audit event → structured output.

## Tool registry
| Tool | Kind | Permission | Notes |
|---|---|---|---|
| get_sales_summary | read | reports or sale | period, branch |
| search_medicines | read | — | name, generic, barcode |
| get_batch_inventory | read | — | |
| get_expiry_report | read | — | window in days |
| get_low_stock_report | read | — | sellable stock only |
| get_supplier_balances | read | payments | |
| get_customer_outstanding | read | payments | names only if the role has access |
| get_cash_reconciliation | read | sale | |
| get_backup_status | read | integrations | |
| generate_report | read | reports | returns a file reference |
| create_draft_purchase_order | **write · confirm** | purchase + aiAct | draft only, never sent |
| create_draft_expense | **write · confirm** | payments + aiAct | |
| request_backup | **write · confirm** | integrations | |
| request_stock_adjustment | **write · confirm** | adjust + aiAct | |
| request_refund | **write · confirm** | refund + aiAct | |

## Confirmation protocol
1. The tool returns `{status:"needs_confirmation", preview, confirmToken}`. The token is single-use, expires in 5 minutes, and is bound to the user, the tool and a hash of the input.
2. The UI shows the preview with Confirm and Cancel.
3. On confirm: re-authenticate the session, re-check permission, **re-validate business rules against current data**, execute with an idempotency key, audit.

## Safety
- Read-only by default. Write tools are hidden from the model unless the role has `aiAct`.
- Prompt-injection defence: OCR and invoice text is passed as quoted data, never as instructions. Tool outputs are capped in size.
- Outputs show the tool name and data basis. Forecasts state the period, assumptions and uncertainty.
- Timeouts: 8 s per tool, 30 s per turn. Errors come back as plain-language messages.

## Privacy
- Local model by default (Ollama on the app host).
- Remote provider: opt-in. Context is minimised (aggregates, no names or phones) and the payload is shown in the settings disclosure. No training on pharmacy data.
- AI can be switched off independently. Billing never depends on it.
