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

# Setup Guide - Offline Payment System

Complete setup instructions for running the offline payment simulation with FastAPI backend.

## Prerequisites

- **Node.js 18+** (for frontend apps)
- **Python 3.9+** (for bank backend)
- **PostgreSQL** (for bank audit logs)
- **npm** (comes with Node.js)

## Step 1: Setup PostgreSQL Database

### Create Database

Open PowerShell and run:

```powershell
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE offline_payments;"
```

When prompted, enter password: `Soham`

### Apply Schema

From the project root directory:

```powershell
psql -U postgres -h localhost -p 5432 -d offline_payments -f schema.sql
```

Enter password: `Soham` when prompted.

## Step 2: Install Frontend Dependencies

### Sender App

```powershell
cd sender
npm install
cd ..
```

### Receiver App

```powershell
cd receiver
npm install
cd ..
```

## Step 3: Setup Bank Backend (Python)

### Create Virtual Environment

```powershell
cd bank
python -m venv venv
```

### Activate Virtual Environment

**Windows:**
```powershell
venv\Scripts\activate
```

**Linux/Mac:**
```bash
source venv/bin/activate
```

### Install Python Dependencies

```powershell
pip install -r requirements.txt
```

### Configure Environment

```powershell
Copy-Item env.sample .env
notepad .env
```

In the `.env` file, set:

```
PORT=4000
DATABASE_URL=postgres://postgres:Soham@localhost:5432/offline_payments
```

Save and close.

## Step 4: Run All Services

You need **three separate terminal windows** (or PowerShell tabs).

### Terminal 1 - Sender (Buyer UI)

```powershell
cd "C:\Users\soham\OneDrive\Documents\SOHAM\NIT ANDHRA\CSE\Offline-Payment-GateWay\sender"
npm run dev -- --host --port 4173
```

Open browser: **http://localhost:4173**

### Terminal 2 - Receiver (Merchant UI)

```powershell
cd "C:\Users\soham\OneDrive\Documents\SOHAM\NIT ANDHRA\CSE\Offline-Payment-GateWay\receiver"
npm run dev -- --host --port 4174
```

Open browser: **http://localhost:4174**

### Terminal 3 - Bank API (Backend)

```powershell
cd "C:\Users\soham\OneDrive\Documents\SOHAM\NIT ANDHRA\CSE\Offline-Payment-GateWay\bank"
venv\Scripts\activate
python run.py
```

Or alternatively:
```powershell
uvicorn src.main:app --reload --port 4000 --app-dir src
```

API available at: **http://localhost:4000**

## Step 5: Demo Flow

### 1. Create Transaction (Sender - Offline)

1. Open **http://localhost:4173**
2. In **Device Identity** section, optionally click **Regenerate keypair** (once is enough)
3. In **Create Transaction**:
   - Enter **Receiver ID**: `merchant-123` (or any ID)
   - Enter **Amount**: `10.50` (or any amount)
   - Click **Create + Sign**
4. Click **Export signed transaction (JSON)**
5. Save the file (e.g., `transaction.json` on Desktop)

### 2. Import Transaction (Receiver - Offline)

1. Open **http://localhost:4174**
2. In **Import Transaction File**:
   - Click the file input
   - Select the `transaction.json` file you exported from Sender
3. You should see: "Imported and processed transaction file."
4. **Ledger** section will show the appended entry (hash-chained)
5. Click **Export ledger JSON**
6. Save the file (e.g., `receiver-ledger.json` on Desktop)

### 3. Verify Ledger (Bank - Online)

In PowerShell (from any directory):

```powershell
curl.exe -X POST http://localhost:4000/verify-ledger `
  -H "Content-Type: application/json" `
  -d "@C:\Users\soham\Desktop\receiver-ledger.json"
```

Replace the path with your actual ledger file path.

Expected response:
```json
{
  "valid": true,
  "errors": [],
  "verified_transactions": ["txn-id-here"]
}
```

### 4. Settle Transactions (Bank - Online)

```powershell
curl.exe -X POST http://localhost:4000/settle-ledger `
  -H "Content-Type: application/json" `
  -d "@C:\Users\soham\Desktop\receiver-ledger.json"
```

Expected response:
```json
{
  "settled": true,
  "settled_transactions": ["txn-id-here"],
  "errors": [],
  "audit_log_ids": ["uuid-here"]
}
```

### 5. View Audit Logs

**Via API:**
```powershell
curl.exe http://localhost:4000/bank-logs?limit=10
```

**Via PostgreSQL:**
```powershell
psql -U postgres -h localhost -p 5432 -d offline_payments `
  -c "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10;"
```

Enter password: `Soham`

**Via UI:**
- **Sender logs**: Check "Logs (IndexedDB)" section in Sender UI
- **Receiver logs**: Check "Logs (IndexedDB)" section in Receiver UI

## Troubleshooting

### PostgreSQL Connection Error

If you get connection errors:
1. Verify PostgreSQL is running: `Get-Service postgresql*`
2. Check password is correct in `.env` file
3. Verify database exists: `psql -U postgres -h localhost -p 5432 -l`

### Python Import Errors

If you get import errors:
1. Make sure virtual environment is activated: `venv\Scripts\activate`
2. Reinstall dependencies: `pip install -r requirements.txt`

### Port Already in Use

If ports 4173, 4174, or 4000 are in use:
- Change ports in `vite.config.js` (frontend) or `.env` (backend)
- Or stop the service using that port

### CORS Errors

The bank API has CORS enabled for all origins. If you still see CORS errors, check that the bank service is running.

## API Endpoints Reference

- `GET /` - Health check
- `POST /verify-ledger` - Verify ledger integrity (does not settle)
- `POST /settle-ledger` - Verify and settle transactions
- `GET /bank-logs?limit=100&offset=0` - Retrieve audit logs

## File Formats

### Transaction JSON (from Sender)
```json
{
  "txn_id": "uuid",
  "from_id": "sender-device-id",
  "to_id": "receiver-id",
  "amount": 10.5,
  "timestamp": "2025-01-XX...",
  "prev_hash": "",
  "hash": "sha256...",
  "signature": "hex..."
}
```

### Ledger JSON (from Receiver)
```json
[
  {
    "ledger_index": 0,
    "transaction": { ...transaction... },
    "hash": "sha256...",
    "status": "pending"
  }
]
```


# Bank Reconciliation Guide

Complete guide for running the bank service and settling offline payment ledgers.

## Step 1: Start the Bank Service

Open PowerShell in the `bank` directory:

```powershell
cd "C:\Users\soham\OneDrive\Documents\SOHAM\NIT ANDHRA\CSE\Offline-Payment-GateWay\bank"
venv\Scripts\activate
python run.py
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:4000 (Press CTRL+C to quit)
INFO:     Application startup complete.
```

**Keep this terminal running!** The bank service must be online to process settlements.

---

## Step 2: Verify Bank is Running

In a **new PowerShell window**, test the bank API:

```powershell
curl.exe http://localhost:4000
```

Expected response:
```json
{
  "service": "Offline Payment Bank Service",
  "status": "running",
  "endpoints": {
    "verify": "/verify-ledger",
    "settle": "/settle-ledger",
    "logs": "/bank-logs"
  }
}
```

---

## Step 3: Prepare the Ledger File

Before settling, you need a ledger JSON file exported from the Receiver app:

1. **Sender** creates and exports transaction → `transaction.json`
2. **Receiver** imports transaction and exports ledger → `receiver-ledger.json`

**Note:** The ledger file should be an array of ledger entries, like:
```json
[
  {
    "ledger_index": 0,
    "transaction": {
      "txn_id": "...",
      "from_id": "...",
      "to_id": "...",
      "amount": 10.50,
      ...
    },
    "hash": "...",
    "status": "pending"
  }
]
```

---

## Step 4: Verify Ledger (Optional but Recommended)

Before settling, verify the ledger integrity:

```powershell
curl.exe -X POST http://localhost:4000/verify-ledger `
  -H "Content-Type: application/json" `
  -d "@C:\path\to\receiver-ledger.json"
```

**Replace `C:\path\to\receiver-ledger.json` with your actual file path.**

Expected response if valid:
```json
{
  "valid": true,
  "errors": [],
  "verified_transactions": ["txn-id-here"]
}
```

If there are errors:
```json
{
  "valid": false,
  "errors": ["Entry 0: Transaction hash mismatch", ...],
  "verified_transactions": []
}
```

---

## Step 5: Settle the Ledger (Perform Transaction Settlement)

This is the **main step** that reconciles and settles transactions:

```powershell
curl.exe -X POST http://localhost:4000/settle-ledger `
  -H "Content-Type: application/json" `
  -d "@C:\path\to\receiver-ledger.json"
```

**Replace `C:\path\to\receiver-ledger.json` with your actual file path.**

### Expected Response (Success):

```json
{
  "settled": true,
  "settled_transactions": ["txn-id-1", "txn-id-2"],
  "errors": [],
  "audit_log_ids": ["uuid-1", "uuid-2"]
}
```

### What Happens During Settlement:

1. ✅ **Verifies hash chain integrity** - Ensures ledger hasn't been tampered with
2. ✅ **Verifies transaction signatures** - Confirms transactions are authentic
3. ✅ **Checks for duplicates** - Prevents replay attacks
4. ✅ **Checks for already-settled transactions** - Prevents double-spending
5. ✅ **Writes audit logs to PostgreSQL** - Records all settlements permanently
6. ✅ **Returns settlement report** - Shows which transactions were settled

---

## Step 6: Verify Settlement Success

### Option A: Check via API

```powershell
curl.exe http://localhost:4000/bank-logs?limit=10
```

This shows recent audit logs including settlements.

### Option B: Check PostgreSQL Directly

```powershell
psql -U postgres -h localhost -p 5432 -d offline_payments `
  -c "SELECT action, txn_id, status, details, created_at FROM audit_logs WHERE action='settle' ORDER BY created_at DESC LIMIT 5;"
```

Enter password: `Soham` when prompted.

Expected output:
```
   action   |         txn_id          | status |           details            |         created_at
------------+-------------------------+--------+------------------------------+----------------------------
 settle     | abc-123-def-456         | success| {"txn_id": "...", "amount":...}| 2025-01-XX XX:XX:XX
```

---

## Complete Example Flow

### Terminal 1 - Bank Service (Keep Running)
```powershell
cd bank
venv\Scripts\activate
python run.py
```

### Terminal 2 - Settle Ledger
```powershell
# Assuming ledger file is on Desktop
curl.exe -X POST http://localhost:4000/settle-ledger `
  -H "Content-Type: application/json" `
  -d "@C:\Users\soham\Desktop\receiver-ledger.json"
```

### Terminal 3 - Check Results
```powershell
# View recent settlements
curl.exe http://localhost:4000/bank-logs?limit=5
```

---

## Troubleshooting

### "Connection refused" or "Cannot connect"
- Make sure bank service is running (Step 1)
- Check it's listening on port 4000: `curl.exe http://localhost:4000`

### "DATABASE_URL environment variable not set"
- Check `.env` file exists in `bank/` directory
- Verify it contains: `DATABASE_URL=postgres://postgres:Soham@localhost:5432/offline_payments`

### "Ledger verification failed"
- Check ledger file format is correct JSON
- Verify transactions haven't been tampered with
- Ensure hash chain is intact

### "Transaction already settled"
- This is expected if you try to settle the same ledger twice
- Each transaction can only be settled once (prevents double-spending)

### "Duplicate transactions found"
- The ledger contains the same transaction ID multiple times
- This is a validation error - check the receiver's ledger

---

## Key Points

✅ **Bank must be online** - The bank service must be running to process settlements

✅ **Ledger format** - The receiver exports a JSON array of ledger entries

✅ **One-time settlement** - Each transaction can only be settled once (replay protection)

✅ **Audit trail** - All settlements are permanently recorded in PostgreSQL

✅ **Verification first** - Always verify ledger before settling (optional but recommended)

---

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Health check |
| `/verify-ledger` | POST | Verify ledger integrity (doesn't settle) |
| `/settle-ledger` | POST | Verify AND settle transactions |
| `/bank-logs` | GET | View audit logs |

---

## Next Steps After Settlement

After successful settlement:
1. ✅ Transactions are recorded in PostgreSQL audit logs
2. ✅ Bank can query settled transactions to prevent replays
3. ✅ Sender and Receiver can verify settlement via their logs
4. ✅ System maintains complete audit trail

The offline payment flow is now complete! 🎉

# Quick Start Guide - Run the Application

## ✅ Your PostgreSQL is Already Configured!

Your `.env` file is set up with:
- **Password**: `Soham`
- **Port**: `5432`
- **Database**: `offline_payments`

---

## Step 1: Setup Database (One-Time)

Open PowerShell and run:

```powershell
# Create database
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE offline_payments;"

# Apply schema
psql -U postgres -h localhost -p 5432 -d offline_payments -f ..\schema.sql
```

When prompted, enter password: **Soham**

---

## Step 2: Install Dependencies (One-Time)

### Frontend Apps (Sender & Receiver)

**Terminal 1:**
```powershell
cd sender
npm install
```

**Terminal 2:**
```powershell
cd receiver
npm install
```

### Bank Backend (Python)

**Terminal 3:**
```powershell
cd bank
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

---

## Step 3: Run All Services

You need **3 separate PowerShell windows/tabs**:

### 🟢 Terminal 1 - Sender (Buyer UI)

```powershell
cd "C:\Users\soham\OneDrive\Documents\SOHAM\NIT ANDHRA\CSE\Offline-Payment-GateWay\sender"
npm run dev -- --host --port 4173
```

**Open browser:** http://localhost:4173

---

### 🟢 Terminal 2 - Receiver (Merchant UI)

```powershell
cd "C:\Users\soham\OneDrive\Documents\SOHAM\NIT ANDHRA\CSE\Offline-Payment-GateWay\receiver"
npm run dev -- --host --port 4174
```

**Open browser:** http://localhost:4174

---

### 🟢 Terminal 3 - Bank API (Backend)

```powershell
cd "C:\Users\soham\OneDrive\Documents\SOHAM\NIT ANDHRA\CSE\Offline-Payment-GateWay\bank"
venv\Scripts\activate
python run.py
```

**API available at:** http://localhost:4000

**Test it:** Open http://localhost:4000 in browser (should show API info)

---

## Step 4: Test the Flow

### 1️⃣ Create Transaction (Sender)

1. Go to http://localhost:4173
2. Click **"Regenerate keypair"** (once)
3. Enter:
   - Receiver ID: `merchant-123`
   - Amount: `10.50`
4. Click **"Create + Sign"**
5. Click **"Export signed transaction (JSON)"**
6. Save file (e.g., `transaction.json`)

### 2️⃣ Import Transaction (Receiver)

1. Go to http://localhost:4174
2. Click **"Choose File"** → Select `transaction.json`
3. Should see: "Imported and processed transaction file."
4. Click **"Export ledger JSON"**
5. Save file (e.g., `ledger.json`)

### 3️⃣ Settle Transaction (Bank)

In PowerShell (any directory):

```powershell
curl.exe -X POST http://localhost:4000/settle-ledger `
  -H "Content-Type: application/json" `
  -d "@C:\Users\soham\Desktop\ledger.json"
```

*(Replace path with your actual ledger file path)*

### 4️⃣ View Audit Logs

**Via API:**
```powershell
curl.exe http://localhost:4000/bank-logs
```

**Via PostgreSQL:**
```powershell
psql -U postgres -h localhost -p 5432 -d offline_payments -c "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5;"
```

---

## ✅ Verify Database Connection

To confirm your bank is connected to PostgreSQL:

```powershell
# Check if logs are being written
curl.exe http://localhost:4000/bank-logs
```

If you see logs, **your PostgreSQL connection is working!** 🎉

---

## Troubleshooting

### "DATABASE_URL environment variable not set"
- Make sure `.env` file exists in `bank/` folder
- Check that `DATABASE_URL` line is correct

### "Connection refused" or PostgreSQL errors
- Verify PostgreSQL is running: `Get-Service postgresql*`
- Check password is `Soham` in `bank/.env`
- Verify database exists: `psql -U postgres -h localhost -p 5432 -l`

### Port already in use
- Change port in `bank/.env` (PORT=4001) or stop the service using that port

### Python import errors
- Make sure virtual environment is activated: `venv\Scripts\activate`
- Reinstall: `pip install -r requirements.txt`

---

## All Set! 🚀

Your application is now running with:
- ✅ Sender on http://localhost:4173
- ✅ Receiver on http://localhost:4174  
- ✅ Bank API on http://localhost:4000
- ✅ PostgreSQL connected (password: Soham, port: 5432)


