# Offline Payment Gateway - Multi-Device Setup Guide

## Overview

This application simulates an offline payment gateway system across **three separate devices**:
1. **Device 1**: Sender (Customer/Payer)
2. **Device 2**: Receiver (Merchant/Payee)
3. **Device 3**: Bank (Admin/Settlement Authority)

## Architecture

- **Frontend**: Modern web applications (HTML/CSS/JavaScript)
- **Backend**: FastAPI (Python) running on Device 3
- **Database**: PostgreSQL
- **Cryptography**: ECDSA signatures, ECDH key exchange, AES-256-GCM encryption

## Setup Instructions

### Prerequisites

1. **Device 3 (Bank)**:
   - Python 3.8+
   - PostgreSQL database
   - Node.js (for serving frontend if needed)

2. **Device 1 & 2 (Sender/Receiver)**:
   - Modern web browser (Chrome, Firefox, Edge)
   - Network access to Device 3

### Step 1: Setup Bank (Device 3)

1. Navigate to `bank/` directory:
   ```bash
   cd bank
   ```

2. Create virtual environment:
   ```bash
   python -m venv venv
   ```

3. Activate virtual environment:
   - Windows: `venv\Scripts\activate`
   - Linux/Mac: `source venv/bin/activate`

4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

5. Setup PostgreSQL database:
   - Create a database
   - Run `schema.sql` to create tables:
   ```bash
   psql -d your_database -f ../schema.sql
   ```

6. Configure environment:
   ```bash
   cp env.sample .env
   # Edit .env and set DATABASE_URL
   ```

7. Start bank server:
   ```bash
   python run.py
   ```
   Server will run on `http://localhost:4000`

8. **Important**: Note the IP address of Device 3 (e.g., `192.168.1.100`)

### Step 2: Setup Sender (Device 1)

1. Open `register.html` in a web browser

2. Configure Bank API URL:
   - Enter Device 3's IP address: `http://192.168.1.100:4000`
   - (Replace with actual IP address)

3. Register as Sender:
   - Click "Sender" role
   - Fill in KYC details:
     - Full Name
     - Email or Phone
     - Bank ID (unique identifier)
     - Wallet Amount (e.g., 1000.00)
   - Click "Register & Create Wallet"

4. **Note**: For simulation, KYC and wallet are auto-approved. In production, bank admin would approve.

5. After registration, you'll be redirected to `sender.html`

6. **Configure Receiver Public Key**:
   - Get Receiver's ECDH public key from Device 2
   - Store it (will be done automatically when receiver shares key)

### Step 3: Setup Receiver (Device 2)

1. Open `register.html` in a web browser

2. Configure Bank API URL:
   - Enter Device 3's IP address: `http://192.168.1.100:4000`

3. Register as Receiver:
   - Click "Receiver" role
   - Fill in KYC details
   - Click "Register & Create Wallet"

4. After registration, you'll be redirected to `receiver.html`

5. **Share Public Key with Sender**:
   - Receiver's ECDH public key is automatically available
   - Sender needs this to encrypt transactions
   - (In production, this would be done via secure channel)

### Step 4: Setup Bank Admin (Device 3)

1. Open `bank-admin.html` in a web browser

2. Configure Bank API URL if needed (should be `http://localhost:4000`)

3. Use the admin interface to:
   - **KYC Approvals**: Approve/reject user registrations
   - **Wallet Approvals**: Approve/reject wallet requests
   - **Settlements**: Verify and settle ledgers from receivers
   - **Audit Logs**: View all system activities

## Usage Flow

### Making a Payment (Sender → Receiver)

1. **On Device 1 (Sender)**:
   - Open `sender.html`
   - Enter Receiver's Bank ID
   - Enter payment amount
   - Click "Create Payment"
   - QR code will be displayed

2. **Transfer Payment** (Choose one method):
   - **Method A - QR Code**: Receiver scans QR code with camera
   - **Method B - File**: 
     - Sender: Right-click QR code → Save image
     - Or export transaction JSON (hidden in UI, but available in browser console)
     - Receiver: Import the file

3. **On Device 2 (Receiver)**:
   - Open `receiver.html`
   - Click "Import Transaction File"
   - Select the transaction file
   - Payment will be verified and added to ledger

### Settling Payments (Receiver → Bank)

1. **On Device 2 (Receiver)**:
   - After receiving payments, click "Sync to Bank"
   - Ledger will be encrypted and sent to bank

2. **On Device 3 (Bank)**:
   - Go to "Settlements" tab
   - Upload the encrypted ledger file (or it's sent automatically)
   - Bank verifies signatures, hash chains, and wallet limits
   - Bank settles transactions and deducts from escrow

## Multi-Device Network Configuration

### Option 1: Same Network (Recommended for Testing)

- All devices on same Wi-Fi network
- Use Device 3's local IP (e.g., `192.168.1.100`)
- Configure CORS in bank server (already enabled for `*`)

### Option 2: Localhost (Single Device Testing)

- All apps on same device
- Use `http://localhost:4000` for bank API
- Open different browser windows/tabs for each role

### Option 3: Production Deployment

- Deploy bank server to cloud
- Use HTTPS
- Configure proper CORS origins
- Use domain names instead of IPs

## File Structure

```
.
├── register.html          # Unified registration page
├── sender.html            # Sender transaction interface
├── receiver.html          # Receiver transaction interface
├── bank-admin.html        # Bank admin dashboard
├── register.js            # Registration logic
├── sender-app.js          # Sender app logic
├── receiver-app.js        # Receiver app logic
├── bank-admin.js          # Bank admin logic
├── sender/
│   ├── src/
│   │   ├── main.js        # Original sender logic (preserved)
│   │   └── crypto-utils.js # Cryptographic functions
├── receiver/
│   ├── src/
│   │   ├── main.js        # Original receiver logic (preserved)
│   │   └── crypto-utils.js # Cryptographic functions
└── bank/
    └── src/               # Bank backend (FastAPI)
```

## Security Features

✅ **All transactions are**:
- Digitally signed (ECDSA P-256)
- Encrypted (AES-256-GCM)
- Hash-chained (tamper-evident)
- Wallet-limited (offline spending capped)

✅ **Bank verifies**:
- Sender signatures
- Receiver signatures
- Hash chain integrity
- Wallet balance limits
- Duplicate transaction detection

## Troubleshooting

### CORS Errors
- Ensure bank server CORS is configured (already set to `*`)
- Check firewall settings
- Verify bank API URL is correct

### Cannot Connect to Bank
- Check bank server is running: `http://localhost:4000`
- Verify network connectivity
- Check IP address is correct

### Transaction Import Fails
- Verify receiver has bank public key configured
- Check transaction file format (must be JSON)
- Ensure sender's public key is valid

### Wallet Balance Issues
- Check wallet is approved in bank admin
- Verify KYC is approved
- Refresh wallet balance from bank

## Development Notes

- All cryptographic operations use Web Crypto API
- Keys are stored in browser localStorage/IndexedDB
- No server-side key storage (keys never leave device)
- All encryption/decryption happens client-side
- Bank only verifies signatures and settles transactions

## Next Steps

For production deployment:
1. Add HTTPS
2. Implement proper authentication
3. Add QR code scanning (camera API)
4. Implement real-time sync
5. Add transaction history persistence
6. Implement proper error handling and retry logic

