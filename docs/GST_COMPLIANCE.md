# GST compliance

What Medoro generates for Indian GST, how to file or import it, and what it does not do.
**This is not legal or tax advice.** Have your CA review every return before you file it.
Medoro never files a return for you.

All screens are under **Accounts → GST returns** (needs the *Accounting & reports* permission).

## B2B customers and IGST

- A customer can carry a **GSTIN** (checked with the GSTN check character), a **place of supply** (state),
  a billing **address** and **PIN code** (Parties → Customers → Edit → *Business customer*). The customer
  import also accepts a `GSTIN` column. At the counter, choose the customer in the POS customer box; the
  *New* customer form takes a GSTIN too.
- Place of supply = the customer's state (if set), else the state in their GSTIN, else your branch's state.
- If it differs from the branch's state (branch GSTIN, else the pharmacy GSTIN), the sale books **Output IGST**
  instead of Output CGST + SGST. Credit notes against that sale reverse IGST the same way. The sale stores the
  IGST amount, the place of supply and the buyer's GSTIN as they were at the time of sale.
- Leave the state blank for counter sales: a walk-in from another state buying at your shop is still an
  intra-state supply. Set it only when goods are delivered to another state.
- Invoices (A4, thermal, WhatsApp PDF) show the buyer GSTIN, address and place of supply, and an IGST column
  instead of CGST/SGST for inter-state invoices.

## GSTR-1 (JSON for the offline tool + CSV)

Pick the month and the GSTIN. Every branch maps to one GSTIN (its own, else the pharmacy's), so a pharmacy with
branches in several states gets one return per GSTIN.

| Table | Built from |
|---|---|
| `b2b` (4A) | Invoices to customers with a GSTIN. `inv_typ` R, `rchrg` N |
| `b2cl` (5) | Inter-state invoices without a GSTIN above ₹1,00,000 (`B2CL_THRESHOLD_PAISE` in `src/domain/gst/common.ts`) |
| `b2cs` (7) | Every other B2C invoice, by supply type, place of supply and rate, **net** of credit notes against them; `typ` OE |
| `nil` (8) | 0% lines (nil rated), by INTRA/INTER and B2B/B2C |
| `cdnr` (9B) | Credit notes against B2B invoices (`ntty` C) |
| `cdnur` (9B) | Credit notes against B2CL invoices (`typ` B2CL) |
| `hsn` (12) | HSN-wise quantity, taxable value and tax (UQC from the dosage form: PAC, BTL, TUB, NOS). From the May 2025 period split into `hsn_b2b` / `hsn_b2c`; earlier periods use `data` |
| `doc_issue` (13) | Invoice series per branch (numbers missing from a range and invoices whose IRN was cancelled count as cancelled) and credit notes |

Line taxes are split exactly as posted: the CGST halves of an invoice add up to the CGST in its voucher, so the
return agrees with the Output tax ledgers to the paisa. HSN codes come from the medicine master (`Medicine.hsn`,
imported from an `HSN` column, default 3004).

**Upload:** download *JSON for offline tool* and either upload it directly (GST portal → Returns Dashboard →
GSTR-1 → *Prepare offline* → Upload), or open it in the GSTN **Returns Offline Tool** (Open downloaded GSTR-1
file), review, and generate the upload file there. *CSV summary* lists section totals and every document for your
CA; *HSN CSV* is Table 12 alone (also under Reports → *HSN summary*).

Field names follow the published GSTR-1 schema (GSTN developer portal, Returns → GSTR-1, and the offline tool
v3.2.x template: `gstin`, `fp` MMYYYY, `b2b[].ctin`, `inv[].inum`, `idt` DD-MM-YYYY, `val`, `pos`, `rchrg`,
`inv_typ`, `itms[].num`, `itm_det{txval, rt, iamt, camt, samt, csamt}`, `nt[].ntty/nt_num/nt_dt`, `hsn_sc`,
`uqc`, `qty`, `doc_det[].docs[].from/to/totnum/cancel/net_issue`). Cross-checked against the open-source India
Compliance app (resilient-tech/india-compliance, `gst_returns/fields/gstr1.py`), whose JSON the portal accepts,
and GSTN's advisory on the Table 12 B2B/B2C split (Phase III, from the May 2025 return).

Document numbers longer than 16 characters are rejected by the portal and the IRP. Medoro's default numbers
(`PREFIX/BRANCH/FY/000001`) fit only with a 1-character prefix and a 2-character branch code; the screen warns
when a number is too long.

## GSTR-3B (screen, CSV, JSON)

| Row | Source |
|---|---|
| 3.1(a) | Taxable outward supplies (rate > 0) net of credit notes: taxable, IGST, CGST, SGST |
| 3.1(c) | Nil rated (0%) supplies, net |
| 3.1(b), (d), (e) | Always zero: Medoro has no exports, reverse charge or non-GST supplies |
| 3.2 | Inter-state supplies to unregistered persons, by place of supply |
| 4(A)(5) | Input CGST/SGST/IGST ledgers: purchase vouchers less debit notes (supplier returns), for the GSTIN's branches |
| 4(B)(2) | Other net credits to the input tax ledgers in the month (e.g. journal reversals) |
| 4(C) | Net ITC |

The JSON uses the GSTN GSTR-3B API / offline-utility structure (`sup_details.osup_det`, `osup_nil_exmp`,
`inter_sup.unreg_details`, `itc_elg.itc_avl[ty=OTH]`, `itc_rev`, `itc_net`, `inward_sup`). GSTR-3B is usually
entered online; use the JSON with your GSP/ASP or the offline utility if you use one, otherwise copy the CSV
figures into the portal. ITC eligibility (Rule 36(4), blocked credits, GSTR-2B matching) is not checked: reconcile
with GSTR-2B before claiming.

## Multi-branch roll-up

The same screen shows, for the month, every GSTIN with its branches: invoices/credit notes, net taxable value,
output IGST/CGST/SGST, net ITC and net tax, with a total for all branches.

## Tally Prime export

- **Masters XML**: one ledger per Medoro account (Sales Accounts, Purchase Accounts, Duties & Taxes with GST duty
  head, Cash-in-Hand, Bank Accounts, Indirect Expenses, Stock-in-Hand, Capital Account; unknown accounts go to
  Suspense A/c) and one ledger per customer (Sundry Debtors) and supplier (Sundry Creditors) with GSTIN and state.
- **Vouchers XML**: every voucher in the date range as Sales, Purchase, Receipt, Payment, Credit Note, Debit Note
  or Journal (reversals import as Journal). Debits are `ISDEEMEDPOSITIVE Yes` with a negative `AMOUNT`, credits
  `No` with a positive amount; every voucher sums to zero. Party lines post to the party's own ledger.
- **Ledger mapping**: open *Ledger mapping* on the screen to rename the Tally ledger or change the group for any
  Medoro account, and set the Tally company name (`SVCURRENTCOMPANY`, must match the company open in Tally).
- **Import**: in Tally Prime, open the company, then Gateway of Tally → Import → **Masters** (choose the masters
  file), then Import → **Transactions** (the vouchers file). Import masters again whenever new parties are added.
  Re-importing the same vouchers creates duplicates: export each period once.
- *Books* can be the whole pharmacy or one GSTIN's branches (opening balances, which have no branch, are only in
  the whole-pharmacy export).

## E-invoice (IRN) and e-way bill

Off unless **both**: the server has the `EINVOICE_*` settings, and an owner ticks *E-invoicing applicable* in GST
settings (aggregate turnover above the notified limit, ₹5 crore at the time of writing).

```
EINVOICE_PROVIDER=nic-sandbox     # nic-sandbox | nic | gsp-http
EINVOICE_BASE_URL=                # optional for nic-sandbox (https://einv-apisandbox.nic.in) and nic (https://einvapi.gst.gov.in); required for gsp-http
EINVOICE_CLIENT_ID=
EINVOICE_CLIENT_SECRET=
EINVOICE_USERNAME=                # API user created on the e-invoice portal
EINVOICE_PASSWORD=
EINVOICE_GSTIN=                   # the GSTIN these credentials belong to
EINVOICE_PUBLIC_KEY=              # nic / nic-sandbox: the IRP public key (PEM or base64 DER)
EWAYBILL_BASE_URL=                # optional: e-way bill API host if different (path /ewaybillapi/v1.03)
```

- **nic / nic-sandbox** (direct IRP access): sign-in per NIC API v1.04: a random 32-byte AppKey and the
  credentials, base64-encoded and RSA-encrypted (PKCS#1 v1.5) with the IRP public key; the SEK in the response is
  AES-256-ECB decrypted with the AppKey. Requests (`/eicore/v1.03/Invoice`, `/Invoice/Cancel`,
  `/eiewb/v1.03/ewaybill`) send `Data` AES-256-ECB encrypted with the SEK, and responses are decrypted the same
  way. The token is cached and renewed on expiry. Direct production access needs your public IP whitelisted by NIC.
- **gsp-http**: for a GSP that exposes the same paths with plain JSON and handles the NIC encryption itself.
  Medoro sends `client_id`, `client_secret`, `user_name`, `password` and `Gstin` headers on every call. GSPs differ:
  check your GSP's paths and headers match before going live.

**Generate IRN** (Accounts → GST returns → E-invoices) for any invoice with a buyer GSTIN: builds the NIC
e-invoice schema 1.1 JSON (`TranDtls`, `DocDtls`, `SellerDtls`, `BuyerDtls`, `ItemList` with HSN, batch and
expiry, `ValDtls`) from the posted sale. The seller PIN is read from the branch address (add it under Users &
branches); the buyer needs a billing address and PIN. The IRN, Ack no., Ack date and signed QR code are stored in
the append-only `EInvoice` table, and the printed invoice shows the QR code and IRN.

**Cancel IRN** is allowed within 24 hours, and only after the whole invoice has been returned (credit note), so the
books match the cancellation. The invoice and its credit notes then drop out of GSTR-1 and count as a cancelled
document in Table 13. The IRP never issues a second IRN for the same invoice number.

**E-way bill**: against the IRN for B2B invoices (Part B: distance, mode, vehicle no. or transporter ID), and for
branch transfers between branches under the same GSTIN as a delivery challan (supply type Outward, sub-type *For
own use*, value at cost). Rows above ₹50,000 are flagged. Transfers between branches with different GSTINs are
taxable supplies: raise a tax invoice instead. Uses the e-way bill API (`ACCESSTOKEN`, `GENEWAYBILL`) with the
same credentials.

Every IRN, cancellation and e-way bill writes an audit event.

## Limitations

- No exports, SEZ, deemed exports, reverse charge, advances (Table 11), e-commerce (14/15), amendments (9A/9C,
  the `*a` tables) or cess.
- Debit notes to customers aren't issued by Medoro, so CDNR/CDNUR only carry credit notes.
- GSTR-3B Table 5 (inward exempt/nil) and Table 4(D) are left at zero; interest and late fee aren't computed.
- E-invoice: B2B only (no B2C dynamic QR), no credit-note IRNs, no e-way bill update/extend/cancel (do those on
  the portal), one IRP registration (GSTIN) per server.
- The offline tool and portal schemas change; if an upload is rejected, download the latest offline tool, open the
  JSON there, and report the error message.
