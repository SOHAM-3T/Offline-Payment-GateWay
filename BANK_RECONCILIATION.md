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

