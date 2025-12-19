# Quick Start Guide - Running the Payment Gateway

## Prerequisites

- **Python 3.8+** (for bank server)
- **PostgreSQL** (database)
- **Modern web browser** (Chrome, Firefox, Edge)
- **Node.js** (optional, for serving static files - or use Python's http.server)

## Step-by-Step Setup

### Step 1: Setup Database (One-time)

1. **Install PostgreSQL** if not already installed
   - Download from: https://www.postgresql.org/download/

2. **Create database:**
   ```bash
   # Open PostgreSQL command line (psql)
   createdb payment_gateway
   ```

3. **Run schema:**
   ```bash
   psql -d payment_gateway -f schema.sql
   ```

### Step 2: Setup Bank Server (Device 3)

1. **Navigate to bank directory:**
   ```bash
   cd bank
   ```

2. **Create virtual environment:**
   ```bash
   python -m venv venv
   ```

3. **Activate virtual environment:**
   - **Windows:**
     ```bash
     venv\Scripts\activate
     ```
   - **Linux/Mac:**
     ```bash
     source venv/bin/activate
     ```

4. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

5. **Configure environment:**
   ```bash
   # Copy sample env file
   cp env.sample .env
   
   # Edit .env file and set DATABASE_URL
   # Format: postgresql://username:password@localhost:5432/payment_gateway
   # Example: postgresql://postgres:password@localhost:5432/payment_gateway
   ```

6. **Start bank server:**
   ```bash
   python run.py
   ```
   
   You should see:
   ```
   INFO:     Started server process
   INFO:     Waiting for application startup.
   INFO:     Application startup complete.
   INFO:     Uvicorn running on http://0.0.0.0:4000
   ```

7. **Note the server URL:**
   - If running on same device: `http://localhost:4000`
   - If running on network device: `http://YOUR_IP_ADDRESS:4000`
   - To find IP address:
     - Windows: `ipconfig` (look for IPv4 Address)
     - Linux/Mac: `ifconfig` or `ip addr`

### Step 3: Serve Frontend Files

You need to serve the HTML files via HTTP (not file://). Choose one method:

#### Option A: Python HTTP Server (Easiest)

1. **In project root directory:**
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Or Python 2
   python -m SimpleHTTPServer 8000
   ```

2. **Access at:** `http://localhost:8000`

#### Option B: Node.js http-server

1. **Install globally:**
   ```bash
   npm install -g http-server
   ```

2. **Run:**
   ```bash
   http-server -p 8000
   ```

#### Option C: VS Code Live Server

1. Install "Live Server" extension in VS Code
2. Right-click on `register.html` → "Open with Live Server"

### Step 4: Run on Three Devices

#### Device 3: Bank Admin

1. **Open browser:**
   ```
   http://localhost:8000/bank-admin.html
   ```

2. **Configure Bank API URL:**
   - If bank server on same device: `http://localhost:4000`
   - If bank server on network: `http://192.168.1.100:4000` (use actual IP)
   - Click "Save"

3. **You should see the admin dashboard**

#### Device 1: Sender

1. **Open browser:**
   ```
   http://localhost:8000/register.html
   ```
   (Or use network IP if accessing from different device)

2. **Configure Bank API URL:**
   - Enter bank server URL (same as above)
   - Click "Save" (if visible)

3. **Register as Sender:**
   - Click "Sender" card
   - Fill in:
     - Full Name: `John Doe`
     - Email or Phone: `john@example.com`
     - Bank ID: `SENDER001` (unique identifier)
     - Wallet Amount: `1000.00`
   - Click "Register & Create Wallet"
   - Wait for redirect to `sender.html`

4. **Configure Receiver Public Key:**
   - Wait for Device 2 to provide their public key
   - Go to "Configuration" section
   - Paste receiver's public key JSON
   - Click "Save Receiver Key"

#### Device 2: Receiver

1. **Open browser:**
   ```
   http://localhost:8000/register.html
   ```

2. **Configure Bank API URL:**
   - Enter bank server URL
   - Click "Save"

3. **Register as Receiver:**
   - Click "Receiver" card
   - Fill in:
     - Full Name: `Jane Merchant`
     - Email or Phone: `jane@merchant.com`
     - Bank ID: `RECEIVER001` (unique identifier)
     - Wallet Amount: `0` (receivers don't need wallet)
   - Click "Register & Create Wallet"
   - Wait for redirect to `receiver.html`

4. **Share Public Key with Sender:**
   - Go to "Configuration" section
   - Copy the public key JSON
   - Share with Device 1 (Sender)
   - Sender pastes it in their configuration

### Step 5: Make a Payment

1. **On Device 1 (Sender):**
   - Enter Receiver Bank ID: `RECEIVER001`
   - Enter Amount: `100.00`
   - Click "Create Payment"
   - QR code appears

2. **Transfer Payment (Choose one):**

   **Method A: File Transfer**
   - Right-click QR code → Inspect
   - Find the transaction data in console
   - Or: Open browser console (F12)
   - Copy the encrypted transaction JSON
   - Save as `transaction.json`

   **Method B: QR Code (if you have QR scanner)**
   - Scan QR code with receiver device
   - Decode the JSON data

3. **On Device 2 (Receiver):**
   - Click "Import Transaction File"
   - Select `transaction.json` file
   - Payment should be verified and added to ledger

### Step 6: Settle to Bank

1. **On Device 2 (Receiver):**
   - After receiving payments, click "Sync to Bank"
   - Ledger is encrypted and sent to bank

2. **On Device 3 (Bank Admin):**
   - Go to "Settlements" tab
   - You should see settlement results
   - Or check "Audit Logs" tab for details

## Testing on Single Device

If you want to test everything on one device:

1. **Terminal 1:** Run bank server
   ```bash
   cd bank
   python run.py
   ```

2. **Terminal 2:** Run HTTP server
   ```bash
   python -m http.server 8000
   ```

3. **Browser Window 1:** Open `bank-admin.html`
4. **Browser Window 2:** Open `register.html` → Register as Sender
5. **Browser Window 3:** Open `register.html` → Register as Receiver

## Troubleshooting

### "Cannot connect to bank"
- Check bank server is running: `http://localhost:4000`
- Verify DATABASE_URL in `.env` file
- Check PostgreSQL is running
- Verify firewall isn't blocking port 4000

### "CORS error"
- Bank server already has CORS enabled for `*`
- If still issues, check browser console for exact error
- Try accessing from `http://localhost` instead of `file://`

### "Database connection error"
- Verify PostgreSQL is running
- Check DATABASE_URL format: `postgresql://user:pass@host:port/dbname`
- Test connection: `psql -d payment_gateway`

### "Keys not found"
- Make sure you registered first
- Check browser localStorage (F12 → Application → Local Storage)
- Try registering again

### "Transaction import fails"
- Verify receiver has bank public key (auto-loaded)
- Check transaction file is valid JSON
- Ensure sender's public key is correct

## Network Setup (Multi-Device)

### Same Wi-Fi Network

1. **Find Device 3's IP:**
   ```bash
   # Windows
   ipconfig
   
   # Linux/Mac
   ifconfig
   # or
   ip addr
   ```

2. **Use that IP in all devices:**
   - Bank API URL: `http://192.168.1.100:4000` (example)
   - Frontend: `http://192.168.1.100:8000` (if serving from Device 3)

### Different Networks

- Use public IP or domain name
- Configure firewall to allow ports 4000 and 8000
- Update CORS settings in `bank/src/main.py` if needed

## Quick Test Flow

1. ✅ Bank server running on port 4000
2. ✅ HTTP server running on port 8000
3. ✅ Database created and schema applied
4. ✅ Open `bank-admin.html` → Should see dashboard
5. ✅ Register Sender → Should redirect to sender page
6. ✅ Register Receiver → Should redirect to receiver page
7. ✅ Share receiver public key with sender
8. ✅ Create payment on sender → QR code appears
9. ✅ Import payment on receiver → Should verify
10. ✅ Sync to bank → Should settle

## File Structure

```
.
├── register.html          # Start here - Registration page
├── sender.html            # Sender dashboard
├── receiver.html          # Receiver dashboard
├── bank-admin.html        # Bank admin dashboard
├── schema.sql            # Database schema
├── bank/
│   ├── run.py            # Bank server entry point
│   ├── src/
│   │   └── main.py       # FastAPI application
│   └── requirements.txt  # Python dependencies
└── sender/src/
    └── crypto-utils.js    # Cryptographic functions
```

## Next Steps

- Test payment flow end-to-end
- Check audit logs in bank admin
- Verify wallet balances
- Test multiple transactions
- Test settlement process

## Need Help?

- Check browser console (F12) for errors
- Check bank server logs for backend errors
- Verify all URLs are correct
- Ensure all services are running

