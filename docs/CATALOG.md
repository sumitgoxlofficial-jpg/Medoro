# Catalogue & counter: salts, loose sale, racks, doctors, labels

How Medoro handles the Indian-pharmacy catalogue features that counters rely on (benchmarks: Marg ERP,
GoFrugal, eVitalRx, Logic ERP, BUSY). Code: `src/domain/inventory/{salts,catalog}.ts`, `src/lib/units.ts`,
`src/lib/barcode.ts`, `src/domain/doctors/*`, migration `20261101000000_catalog_counter`.

## 1. Composition (salt) and substitutes
- `Medicine.composition` is the salts with strengths as text (`Paracetamol 500mg + Caffeine 25mg`). If it is
  left blank it is derived from generic + strength (`Paracetamol + Caffeine` / `500 mg + 25 mg` are zipped).
- `Medicine.saltKey` is the normalised, order-independent key: salt names lower-cased, strengths normalised
  (`650 MG` → `650mg`, `0.50 mg` → `0.5mg`, `µg` → `mcg`, `gm` → `g`), sorted and joined with ` + `.
  Medicines with equal keys are substitutes. Different strengths are never substitutes.
- The migration back-fills single-salt medicines in SQL with the same normalisation; combinations (and
  anything unusual) are filled by **Inventory → Salts → Rebuild composition keys**, which recomputes every
  medicine with `compositionOf()`.
- **Search** (`searchCatalog`): a 6+ digit code is an exact barcode lookup (manufacturer or internal code).
  Otherwise the query is split into tokens (`dolo650` → `dolo 650`) and every token must match the brand,
  the generic or the composition (`ILIKE`). With no hit, a trigram-similarity pass over up to 500 candidates
  sharing the first two letters forgives typos (`azithromicin`). No `pg_trgm` extension is needed, so it runs
  on any PostgreSQL the app supports; the indexed `(tenantId, saltKey)` lookup drives substitutes.
- **Substitutes** (`substitutesFor`): same key, this branch's sellable stock, in-stock first, then cheapest per
  unit (MRP ÷ units per pack, so a 10-tab strip compares fairly with a 15-tab one) or best margin (MRP net of GST
  over batch cost). The POS opens the list automatically when an item has no sellable stock, and on **F6** for the
  highlighted result or the last cart line. The medicine drawer lists the same substitutes.
- **Sample salts:** `src/domain/inventory/salts-sample.json` holds ~60 common Indian brands with compositions
  and pack sizes. *Inventory → Salts → Import sample* adds the missing ones (no stock) and fills the composition
  of brands you already have, never overwriting. MRPs there are indicative; batches sell at the MRP entered on
  receipt. No external dataset is downloaded.
- **Import:** a `Composition` column (aliases: salts, contents) or a `Salt` column that contains strengths fills
  composition, generic and strength. `Units per pack`, `Pack unit`, `Loose unit` and `Sell loose` set units.

## 2. Multi-unit stock and loose sale
| Field | Meaning |
|---|---|
| `packSize` | Stock units in one MRP pack (15 tabs per strip). Default 1. |
| `packUnit`, `looseUnit` | Labels: strip / tab, bottle / tab… |
| `allowLoose` | The counter may sell single loose units (needs `packSize > 1`). |
| `caseSize`, `caseUnit` | Packs per purchase case (1 box = 10 strips), for receiving. |

- **Batches hold stock units.** `Batch.qtyAvailable`, stock movements, transfers, counts and write-offs are all
  in stock units. Batch `costPaise` and `mrpPaise` stay **per pack** (MRP is printed per pack); values are
  `round(perPack × units ÷ packSize)` (`stockValue`).
- **Migration / existing data.** Before this change every quantity was whole packs. The migration adds
  `packSize` with default 1, so one stock unit = one pack and every existing batch, movement, sale line,
  return, transfer and count keeps its meaning without rewriting a row (append-only tables are untouched).
- **Changing a pack size** (`rescaleStock`, inside the medicine update): with stock on hand the new size must be
  a whole multiple of the old one (1 → 15, 10 → 20). Every batch is multiplied and gets a `unit` stock movement
  for the difference, so the movement ledger still sums to the batch quantity. Open transfers block the change.
  With no stock anywhere the size can change freely.
- **Selling.** A cart line has `unit: "pack" | "loose"`. A pack uses `packSize` units from one batch (never split
  across batches); a loose unit uses one. FEFO (`nextFefo(…, need)`, `allocateUnits`) works in stock units.
  A loose unit's price is **MRP ÷ packSize rounded down to the paisa** (₹32.50 / 15 = ₹2.16), so selling a full
  strip loose never exceeds the printed MRP; its cost is per-pack cost ÷ packSize rounded. GST is back-calculated
  per line exactly as for packs. `SaleItem` stores the sold unit's MRP and cost, `loose` and the pack size at sale,
  so `mrpPaise × qty`, GST and COGS reports work unchanged.
- **Returns** go back in the unit sold (strip lines in strips, loose lines in tabs). Stock put back is
  `qty × packSize` for packs and `qty × packSize ÷ packSize-at-sale` for loose lines (exact because pack sizes only
  change by whole multiples while stock exists).
- **Receiving.** GRN lines and opening stock are in packs (rate per pack); `postGrn` converts to stock units. The
  inventory drawer can also receive in cases (`qty × caseSize` packs).
- **Display.** Stock reads as packs plus loose remainder (`3 strips + 2 tabs`) in inventory, POS, counts, transfers,
  reports and the dashboard. Count boxes take `3` (packs) or `3+2` (packs + loose). Reorder levels, sellable
  counts in reports and sales velocity are in whole packs.
- **Offline.** The snapshot carries `packSize`, `allowLoose`, units, composition and rack per medicine;
  allowances are in stock units. Offline bills carry each line's unit; conflict re-posting allocates packs first,
  then loose units.

## 3. Racks
`Medicine.rack` is the catalogue rack; `MedicineRack` (branch, medicine) overrides it at a branch. The effective
rack shows in POS search results, the medicine drawer, labels and the stock count sheet (filter by rack, shelf
order, print). Inventory filters by rack.

## 4. Doctor master and referrals
- `Doctor` (per pharmacy): name, qualification, registration number (unique per pharmacy), clinic, phone,
  address, active. Cashiers can quick-add from the POS; editing needs stock, users or reports permission.
- The POS prescriber field is a doctor picker; a typed name still works (free text, like older bills).
  `Sale.doctorId` links the doctor and `Sale.prescriber` is always filled (`Dr A. Mehta (Reg MMC 2011/04/1234)`
  when picked), so invoices, the sales register and any prescription register read the same field. A register can
  join `Sale.doctorId → Doctor` for qualification, registration number and clinic.
- **Sales by doctor** (*Doctors & referrals → Sales by doctor*, reports permission): bills, Rx bills, gross,
  returns (credit notes against those bills) and net per doctor for a date range and branch; unlinked typed names
  are grouped by name. CSV download.

## 5. Barcodes and labels
- `src/lib/barcode.ts` encodes Code 128 (set B, switching to set C for digit runs; mod-103 check) and EAN-13
  (UPC-A as EAN-13 with a leading 0; GS1 check digit) to SVG, with no dependencies.
- Labels (*Inventory → Labels*, the medicine drawer, or a batch row) open `/print/labels` as a 50 × 25 mm
  thermal roll or an A4 sheet of 3 × 10 (63.5 × 25.4 mm): name, strength, batch, expiry, MRP, rack and barcode.
- Items with no barcode first get an internal EAN-13: `29` (GS1 restricted-circulation prefix) + a per-pharmacy
  number + check digit. It is stored as the medicine's barcode, so scanning it at the POS adds the item.
