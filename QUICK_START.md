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

