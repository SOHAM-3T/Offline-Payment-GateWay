# Quick Test Reference

## 🚀 Quick Start (5 Minutes)

### 1. Start Bank
```powershell
cd bank
venv\Scripts\activate
python run.py
```

### 2. Get Bank Key
```powershell
curl http://localhost:4000/bank-public-key
```
**Copy the `public_key` JSON**

### 3. Start Frontends
**Terminal 2:**
```powershell
cd sender
npm run dev
```

**Terminal 3:**
```powershell
cd receiver
npm run dev
```

### 4. Configure Receiver
- Open `http://localhost:5174`
- Click "Export Public Key" → Save file
- Paste Bank public key → Click "Save Bank Public Key"

### 5. Configure Sender
- Open `http://localhost:5173`
- Open saved `receiver-public-key.json`
- Paste into "Receiver Public Key" → Click "Save"

### 6. Create Transaction
- Sender: Enter Receiver ID & Amount → "Create + Encrypt + Sign"
- Click "Export encrypted transaction"

### 7. Process Transaction
- Receiver: Import encrypted file → Should decrypt & verify

### 8. Export Ledger
- Receiver: Click "Export encrypted ledger JSON"

### 9. Settle at Bank
```powershell
curl.exe -X POST http://localhost:4000/settle-ledger `
  -H "Content-Type: application/json" `
  -d "@encrypted-ledger-*.json"
```

## ✅ Success Indicators

- ✅ Sender logs show `encrypt_txn: success`
- ✅ Receiver logs show `decrypt`, `verify_signature: success`
- ✅ Bank response: `{"settled": true, "errors": []}`
- ✅ Audit logs show all operations

## 🔧 Common Issues

| Issue | Solution |
|-------|----------|
| Bank won't start | Check `.env` file exists with correct DB credentials |
| "Please import key" | Ensure public keys are saved in UI |
| Decryption fails | Re-export and import public keys |
| Database error | Run `schema.sql` to create tables |

## 📋 Checklist

- [ ] PostgreSQL running (port 5432)
- [ ] Database `offline_payments` created
- [ ] Bank service running (port 4000)
- [ ] Bank public key retrieved
- [ ] Receiver public key exported
- [ ] Sender has Receiver public key
- [ ] Receiver has Bank public key
- [ ] Transaction created & exported
- [ ] Transaction imported & verified
- [ ] Ledger exported
- [ ] Bank settled successfully

