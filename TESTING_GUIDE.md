# Complete Testing Guide - Encrypted Payment Flow

## Prerequisites

1. **PostgreSQL Database** running on port 5432
2. **Node.js** installed (for frontend dev servers)
3. **Python 3.8+** installed (for bank backend)
4. **Three terminal windows** ready

---

## Step 1: Database Setup

```powershell
# Connect to PostgreSQL and create database
psql -U postgres -p 5432
```

In PostgreSQL prompt:
```sql
CREATE DATABASE offline_payments;
\c offline_payments
\i schema.sql
\q
```

Or if you have the schema file:
```powershell
psql -U postgres -p 5432 -d offline_payments -f schema.sql
```

---

## Step 2: Start Bank Service

**Terminal 1 - Bank Backend:**

```powershell
cd bank

# Activate virtual environment
venv\Scripts\activate

# Install dependencies (if not already done)
pip install -r requirements.txt

# Create .env file (if not exists)
# Copy env.sample to .env and update:
# DATABASE_URL=postgres://postgres:Soham@localhost:5432/offline_payments

# Start bank service
python run.py
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:4000
```

**Keep this terminal running!**

---

## Step 3: Get Bank Public Key

**Terminal 2 - Testing/Commands:**

```powershell
# Get bank public key
curl http://localhost:4000/bank-public-key
```

**Save the `public_key` JSON object** - you'll need it for Receiver configuration.

Example output:
```json
{
  "public_key": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  }
}
```

---

## Step 4: Start Frontend Services

**Terminal 3 - Sender:**

```powershell
cd sender
npm install  # if not already done
npm run dev
```

**Terminal 4 - Receiver:**

```powershell
cd receiver
npm install  # if not already done
npm run dev
```

You should see:
- Sender: `http://localhost:5173` (or similar)
- Receiver: `http://localhost:5174` (or similar)

---

## Step 5: Configure Receiver

1. **Open Receiver app** in browser (`http://localhost:5174`)

2. **Export Receiver Public Key:**
   - Click "Export Public Key (for Sender)"
   - Save `receiver-public-key.json` file
   - **Copy the JSON content** - you'll paste it into Sender

3. **Import Bank Public Key:**
   - Paste the Bank public key JSON (from Step 3) into "Bank Public Key" textarea
   - Click "Save Bank Public Key"
   - Should see: "✓ Bank public key saved"

---

## Step 6: Configure Sender

1. **Open Sender app** in browser (`http://localhost:5173`)

2. **Import Receiver Public Key:**
   - Open the `receiver-public-key.json` file you saved
   - Copy the entire JSON content
   - Paste into "Receiver Public Key" textarea in Sender
   - Click "Save Receiver Public Key"
   - Should see: "✓ Receiver public key saved"

---

## Step 7: Create Encrypted Transaction

**In Sender app:**

1. Enter Receiver ID: `merchant-123` (or any ID)
2. Enter Amount: `100.50` (or any amount)
3. Click **"Create + Encrypt + Sign"**
4. You should see encrypted transaction JSON in preview
5. Click **"Export encrypted transaction (JSON)"**
6. Save the file (e.g., `encrypted-txn-1234567890.json`)

**Check Sender logs** - should see:
- `create_encrypted_txn` - success
- `encrypt_txn` - success

---

## Step 8: Process Transaction in Receiver

**In Receiver app:**

1. Click "Choose File" under "Import Encrypted Transaction File"
2. Select the encrypted transaction file you exported from Sender
3. Transaction should be:
   - Decrypted
   - Signature verified
   - Appended to ledger

**Check Receiver logs** - should see:
- `decrypt_aes_key` - success
- `decrypt_payload` - success
- `verify_signature` - success
- `append_ledger` - success

**Verify Ledger View** - should show the transaction entry

---

## Step 9: Create Multiple Transactions (Optional)

Repeat Step 7-8 to create multiple transactions:
- Transaction 1: Amount 100.50
- Transaction 2: Amount 50.25
- Transaction 3: Amount 75.00

Each should appear in Receiver's ledger with hash chain integrity.

---

## Step 10: Export Encrypted Ledger

**In Receiver app:**

1. Ensure you have transactions in the ledger
2. Click **"Export encrypted ledger JSON"**
3. Save the file (e.g., `encrypted-ledger-1234567890.json`)

**Check Receiver logs** - should see:
- `sign_ledger` - success
- `export_encrypted_ledger` - success

---

## Step 11: Settle Ledger at Bank

**Terminal 2 - Testing/Commands:**

```powershell
# Settle encrypted ledger
curl.exe -X POST http://localhost:4000/settle-ledger `
  -H "Content-Type: application/json" `
  -d "@encrypted-ledger-1234567890.json"
```

**Expected Success Response:**
```json
{
  "settled": true,
  "settled_transactions": ["txn-id-1", "txn-id-2", "txn-id-3"],
  "errors": [],
  "audit_log_ids": [1, 2, 3]
}
```

**Check Bank logs** - should see:
- `decrypt_ledger` - success
- `settle` - success for each transaction

---

## Step 12: Verify Audit Logs

**Terminal 2:**

```powershell
# Get bank audit logs
curl http://localhost:4000/bank-logs
```

Should show:
- Decryption logs
- Verification logs
- Settlement logs for each transaction

---

## Step 13: Test Verification Endpoint

**Terminal 2:**

```powershell
# Verify ledger (without settling)
curl.exe -X POST http://localhost:4000/verify-ledger `
  -H "Content-Type: application/json" `
  -d "@encrypted-ledger-1234567890.json"
```

**Expected Response:**
```json
{
  "valid": true,
  "errors": [],
  "verified_transactions": ["txn-id-1", "txn-id-2", "txn-id-3"]
}
```

---

## Troubleshooting

### Bank service won't start
- Check PostgreSQL is running
- Verify `.env` file has correct database credentials
- Check port 4000 is not in use

### "Please import receiver public key first"
- Ensure Receiver public key is saved in Sender
- Verify JSON format is correct

### "Please import bank public key first"
- Ensure Bank public key is saved in Receiver
- Verify bank service is running

### Decryption errors
- Verify keys haven't been regenerated
- Check encrypted file format matches expected structure
- Ensure public keys match the keypairs used for encryption

### Signature verification failures
- Keys may have been regenerated - re-export and import public keys
- Verify transaction hasn't been tampered with
- Check browser console for detailed errors

### Database connection errors
- Verify PostgreSQL is running: `psql -U postgres -p 5432`
- Check `.env` file credentials
- Ensure database exists: `CREATE DATABASE offline_payments;`

---

## Complete Flow Summary

1. ✅ Database setup
2. ✅ Bank service running
3. ✅ Bank public key retrieved
4. ✅ Receiver configured (Bank key imported)
5. ✅ Receiver public key exported
6. ✅ Sender configured (Receiver key imported)
7. ✅ Encrypted transaction created
8. ✅ Transaction decrypted and verified in Receiver
9. ✅ Encrypted ledger exported
10. ✅ Ledger settled at Bank
11. ✅ Audit logs verified

---

## Testing Security Properties

### Confidentiality Test
- Try opening encrypted transaction file - should be unreadable
- Only Receiver with correct private key can decrypt

### Integrity Test
- Modify encrypted file slightly
- Import should fail with decryption/signature error

### Authentication Test
- Verify signatures in logs
- Check signature verification steps succeed

### Non-repudiation Test
- Sender signature verified using public key
- Cannot deny creating transaction

### Tamper Detection Test
- Modify transaction in encrypted file
- Hash chain verification should fail

---

## Success Criteria

✅ All transactions encrypted
✅ All signatures verified
✅ Hash chain integrity maintained
✅ Bank successfully decrypts and settles
✅ Audit logs capture all operations
✅ No security errors in logs

