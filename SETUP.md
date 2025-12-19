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

