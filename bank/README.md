# Bank Service (FastAPI Backend)

Backend service for verifying and settling offline payment ledgers.

## Setup

1. **Create virtual environment:**
```bash
python -m venv venv
```

2. **Activate virtual environment:**
   - Windows: `venv\Scripts\activate`
   - Linux/Mac: `source venv/bin/activate`

3. **Install dependencies:**
```bash
pip install -r requirements.txt
```

4. **Configure environment:**
```bash
cp env.sample .env
# Edit .env and set DATABASE_URL
```

## Running

**Option 1: Using run.py (recommended)**
```bash
python run.py
```

**Option 2: Using uvicorn directly**
```bash
uvicorn src.main:app --reload --port 4000
```

The service will be available at `http://localhost:4000`

## API Endpoints

- `GET /` - Health check
- `POST /verify-ledger` - Verify ledger integrity (does not settle)
- `POST /settle-ledger` - Verify and settle transactions
- `GET /bank-logs` - Retrieve audit logs

## Testing

Test with curl (PowerShell):

```powershell
# Verify ledger
curl.exe -X POST http://localhost:4000/verify-ledger `
  -H "Content-Type: application/json" `
  -d "@path\to\ledger.json"

# Settle ledger
curl.exe -X POST http://localhost:4000/settle-ledger `
  -H "Content-Type: application/json" `
  -d "@path\to\ledger.json"

# Get logs
curl.exe http://localhost:4000/bank-logs?limit=10
```

