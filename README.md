# Offline–Offline Payment Simulation with Ledger-Based Settlement

Hackathon-grade simulation that demonstrates offline sender → receiver payments with later bank settlement. Three actors run as isolated apps with file-based message passing (no shared state, no direct network calls between sender/receiver). Each action emits structured logs for auditability.

## Project layout
- `sender/` – Vite web app for Buyer. Generates device identity, signs transactions, exports signed JSON files, writes logs to IndexedDB.
- `receiver/` – Vite web app for Merchant. Imports signed transactions, verifies signatures, appends to an immutable hash-chained ledger in IndexedDB, exports ledger JSON, writes logs to IndexedDB.
- `bank/` – Python + FastAPI service. Imports ledger JSON, verifies hash-chain and signatures, records settlement audit logs to PostgreSQL.
- `schema.sql` – SQL to bootstrap the bank audit table.

## Prereqs
- Node 18+ (for frontend Web Crypto + ES modules)
- npm (for frontend apps)
- Python 3.9+ (for bank backend)
- PostgreSQL (required for bank audit logs)

## Quickstart (dev)

### 1. Setup PostgreSQL Database

Create database and apply schema:

```bash
# Create database
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE offline_payments;"

# Apply schema
psql -U postgres -h localhost -p 5432 -d offline_payments -f schema.sql
```

### 2. Install Dependencies

**Frontend apps (Sender & Receiver):**
```bash
cd sender && npm install
cd ../receiver && npm install
```

**Bank backend (Python):**
```bash
cd bank
python -m venv venv

# On Windows:
venv\Scripts\activate
# On Linux/Mac:
# source venv/bin/activate

pip install -r requirements.txt
```

### 3. Configure Bank Service

```bash
cd bank
cp env.sample .env
# Edit .env and set DATABASE_URL:
# DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/offline_payments
```

### 4. Run All Services

**Terminal 1 - Sender UI:**
```bash
cd sender
npm run dev -- --host --port 4173
```
Open: `http://localhost:4173`

**Terminal 2 - Receiver UI:**
```bash
cd receiver
npm run dev -- --host --port 4174
```
Open: `http://localhost:4174`

**Terminal 3 - Bank API:**
```bash
cd bank
venv\Scripts\activate  # Windows (or: source venv/bin/activate on Linux/Mac)
python -m uvicorn src.main:app --reload --port 4000
```
API available at: `http://localhost:4000`

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
   - **Verify ledger** (check integrity without settling):
```bash
curl -X POST http://localhost:4000/verify-ledger \
  -H "Content-Type: application/json" \
  -d @path/to/ledger.json
```
   - **Settle ledger** (verify and record settlement):
```bash
curl -X POST http://localhost:4000/settle-ledger \
  -H "Content-Type: application/json" \
  -d @path/to/ledger.json
```
   - Bank verifies hash-chain + signatures, checks for duplicates/replays, writes audit logs to PostgreSQL, returns settlement report.
4) Audit visibility:
   - **Sender/Receiver**: Open each UI "Logs" tab (reads IndexedDB).
   - **Bank**: Query audit logs via API:
```bash
curl http://localhost:4000/bank-logs?limit=50
```
   - Or query PostgreSQL directly:
```bash
psql -U postgres -h localhost -p 5432 -d offline_payments \
  -c "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;"
```

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