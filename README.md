# Offline–Offline Payment Simulation with Ledger-Based Settlement

Hackathon-grade simulation that demonstrates offline sender → receiver payments with later bank settlement. Three actors run as isolated apps with file-based message passing (no shared state, no direct network calls between sender/receiver). Each action emits structured logs for auditability.

## Project layout
- `sender/` – Vite web app for Buyer. Generates device identity, signs transactions, exports signed JSON files, writes logs to IndexedDB.
- `receiver/` – Vite web app for Merchant. Imports signed transactions, verifies signatures, appends to an immutable hash-chained ledger in IndexedDB, exports ledger JSON, writes logs to IndexedDB.
- `bank/` – Node + Express service. Imports ledger JSON, verifies hash-chain and signatures, records settlement audit logs to PostgreSQL (or local JSONL fallback).
- `schema.sql` – SQL to bootstrap the bank audit table.

## Prereqs
- Node 18+ (for Web Crypto + ES modules)
- npm
- PostgreSQL (optional; required for persistent bank audit logs)

## Quickstart (dev)
1) Install deps (per actor):
```bash
cd sender && npm install
cd ../receiver && npm install
cd ../bank && npm install
```
2) Run sender UI (offline-friendly):
```bash
cd sender
npm run dev -- --host --port 4173
```
3) Run receiver UI:
```bash
cd receiver
npm run dev -- --host --port 4174
```
4) Run bank API:
```bash
cd bank
cp env.sample .env   # set DATABASE_URL if available
npm run dev
```

## Demo flow (offline → online)
1) Sender (offline):
   - Open sender app.
   - Create transaction (to_id, amount). App signs with device ECDSA key.
   - Click “Export signed transaction” to download JSON file.
2) Receiver (offline):
   - Open receiver app.
   - Import the sender’s transaction JSON file.
   - App verifies signature, appends immutable ledger entry (hash-chained), logs result.
   - Export ledger JSON file.
3) Bank (online):
   - Send ledger JSON to the bank endpoint:
```bash
curl -X POST http://localhost:4000/ledger/import \
  -H "Content-Type: application/json" \
  --data-binary @path/to/ledger.json
```
   - Bank verifies hash-chain + signatures, writes audit log to PostgreSQL (or JSONL fallback), returns settlement report.
4) Audit visibility:
   - Sender/Receiver: open each UI “Logs” tab (reads IndexedDB).
   - Bank: query Postgres `audit_logs` or check `bank/audit-log.jsonl` when DB is absent.

## Data shapes (canonical order)
Transaction
```json
{
  "txn_id": "uuid",
  "from_id": "sender-device-id",
  "to_id": "receiver-id",
  "amount": 10.5,
  "timestamp": "ISO-8601",
  "prev_hash": "string|\"\"",
  "hash": "sha256(transaction core fields)",
  "signature": "base64 ECDSA over hash",
  "sender_public_key": { "kty": "...", "crv": "...", ... }
}
```

Ledger entry
```json
{
  "ledger_index": 0,
  "transaction": { ...transaction... },
  "hash": "sha256(prev_ledger_hash + transaction.hash)",
  "status": "verified|rejected"
}
```

Log entry
```json
{
  "log_id": "uuid",
  "actor": "sender|receiver|bank",
  "action": "create_txn|import_txn|append_ledger|reconcile",
  "txn_id": "uuid|null",
  "timestamp": "ISO-8601",
  "connectivity": "offline|online",
  "status": "success|error",
  "details": { "message": "...", "meta": { ... } }
}
```

## Bank database schema
Apply `schema.sql` to a Postgres database and set `DATABASE_URL` in `bank/.env`.

## Notes
- No real payments, no live networking between sender/receiver.
- Offline-first: sender/receiver rely solely on local device + file transfer.
- Hash-chained ledger for tamper evidence; all actions produce structured logs.