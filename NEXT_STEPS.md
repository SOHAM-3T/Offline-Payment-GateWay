# Next Steps - You're Almost Done! ✅

## ✅ Database Setup Complete!

Your database is ready. Now let's start the application.

## Step 1: Configure Bank Server

1. **Edit the `.env` file:**
   ```powershell
   cd bank
   notepad .env
   ```

2. **Update the DATABASE_URL:**
   ```
   PORT=4000
   DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/payment_gateway
   ```
   
   Replace `YOUR_POSTGRES_PASSWORD` with the password you used for the `postgres` user.

## Step 2: Start Bank Server

```powershell
cd bank
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:4000
```

**Keep this terminal open!**

## Step 3: Start Frontend Server (New Terminal)

Open a **new PowerShell window**:

```powershell
cd "C:\Users\soham\OneDrive\Documents\SOHAM\NIT ANDHRA\CSE\Offline-Payment-GateWay"
python -m http.server 8000
```

You should see:
```
Serving HTTP on 0.0.0.0 port 8000
```

**Keep this terminal open too!**

## Step 4: Open in Browsers

### Device 3: Bank Admin
Open: `http://localhost:8000/bank-admin.html`
- Configure Bank API URL: `http://localhost:4000`
- Click "Save"

### Device 1: Sender
Open: `http://localhost:8000/register.html`
- Configure Bank API URL: `http://localhost:4000`
- Click "Sender"
- Fill in registration form
- Click "Register & Create Wallet"

### Device 2: Receiver
Open: `http://localhost:8000/register.html` (in different browser/incognito)
- Configure Bank API URL: `http://localhost:4000`
- Click "Receiver"
- Fill in registration form
- Click "Register & Create Wallet"

## Step 5: Share Public Keys

1. **On Receiver page:**
   - Go to "Configuration" section
   - Copy the public key JSON

2. **On Sender page:**
   - Go to "Configuration" section
   - Paste the receiver's public key
   - Click "Save Receiver Key"

## Step 6: Make a Payment

1. **On Sender:**
   - Enter Receiver Bank ID (e.g., `RECEIVER001`)
   - Enter amount (e.g., `100.00`)
   - Click "Create Payment"
   - QR code appears

2. **Transfer Payment:**
   - Option A: Save QR code image
   - Option B: Open browser console (F12) and copy transaction JSON
   - Save as `transaction.json`

3. **On Receiver:**
   - Click "Import Transaction File"
   - Select `transaction.json`
   - Payment verified and added to ledger!

4. **Settle to Bank:**
   - On Receiver: Click "Sync to Bank"
   - On Bank Admin: Check "Settlements" or "Audit Logs" tab

## Troubleshooting

### "Module not found" when starting bank server
```powershell
pip install -r requirements.txt
```

### "Connection refused" error
- Make sure bank server is running on port 4000
- Check `.env` file has correct DATABASE_URL
- Verify PostgreSQL is running

### "CORS error" in browser
- Bank server already has CORS enabled
- Make sure you're using `http://localhost:8000` not `file://`

## You're All Set! 🎉

The application is now running. You can:
- Register users
- Create payments
- Receive payments
- Settle transactions
- View audit logs

Enjoy testing your offline payment gateway!

