"""
FastAPI backend service for offline payment settlement.
Handles ledger verification and transaction settlement.
"""
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from typing import Union, List, Dict, Any

from models import (
    LedgerVerificationRequest,
    LedgerVerificationResponse,
    SettlementRequest,
    SettlementResponse,
    Ledger,
    LedgerEntry,
    LogEntry
)
from crypto import verify_hash_chain, check_duplicate_transactions
from database import write_audit_log, get_audit_logs, check_transaction_settled

# Load environment variables
load_dotenv()

app = FastAPI(
    title="Offline Payment Bank Service",
    description="Backend service for verifying and settling offline payment ledgers",
    version="1.0.0"
)

# CORS middleware to allow frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "Offline Payment Bank Service",
        "status": "running",
        "endpoints": {
            "verify": "/verify-ledger",
            "settle": "/settle-ledger",
            "logs": "/bank-logs"
        }
    }


def parse_ledger_data(data: Any) -> tuple[List[Dict], str]:
    """
    Parse ledger data from various formats:
    - Direct array: [{ledger_index: 0, transaction: {...}, ...}, ...]
    - Wrapped: {"ledger": {receiver_id: "...", entries: [...], ...}}
    - Request model: LedgerVerificationRequest or SettlementRequest
    """
    receiver_id = "unknown"
    entries = []
    
    # Handle direct array (most common - as exported by receiver)
    if isinstance(data, list):
        entries = data
        return entries, receiver_id
    
    # Handle dict
    if isinstance(data, dict):
        # Check if it's a wrapped ledger object
        if 'ledger' in data and isinstance(data['ledger'], dict):
            ledger_dict = data['ledger']
            receiver_id = ledger_dict.get('receiver_id', 'unknown')
            entries = ledger_dict.get('entries', [])
            # Convert Pydantic models to dicts if needed
            if entries and hasattr(entries[0], 'dict'):
                entries = [e.dict() if hasattr(e, 'dict') else e for e in entries]
            return entries, receiver_id
        
        # Check if it's a direct ledger entry (single entry)
        if 'ledger_index' in data and 'transaction' in data:
            entries = [data]
            return entries, receiver_id
        
        # Try parsing as LedgerVerificationRequest/SettlementRequest
        try:
            if 'ledger' in data:
                req = LedgerVerificationRequest(**data)
            else:
                # Assume it's a ledger dict directly
                ledger = Ledger(**data)
                receiver_id = ledger.receiver_id
                entries = [e.dict() for e in ledger.entries]
                return entries, receiver_id
        except:
            pass
    
    # Handle Pydantic models
    if hasattr(data, 'ledger'):
        ledger = data.ledger
        receiver_id = ledger.receiver_id
        entries = [e.dict() for e in ledger.entries]
        return entries, receiver_id
    
    raise ValueError("Unable to parse ledger data format")


@app.post("/verify-ledger", response_model=LedgerVerificationResponse)
async def verify_ledger(request: Request):
    """
    Verify ledger integrity:
    - Hash chain validation
    - Transaction signature verification
    - Duplicate transaction detection
    
    Accepts JSON body as:
    - Direct array: [{"ledger_index": 0, "transaction": {...}, "hash": "...", "status": "..."}, ...]
    - Wrapped: {"ledger": {"receiver_id": "...", "entries": [...], "exported_at": "..."}}
    """
    errors = []
    verified_txn_ids = []
    
    try:
        data = await request.json()
        entries, receiver_id = parse_ledger_data(data)
        
        if not entries:
            return LedgerVerificationResponse(
                valid=False,
                errors=["Ledger is empty"],
                verified_transactions=[]
            )
        
        # Verify hash chain integrity
        chain_valid, chain_errors = verify_hash_chain(entries)
        if not chain_valid:
            errors.extend(chain_errors)
        
        # Check for duplicate transactions
        no_duplicates, duplicates = check_duplicate_transactions(entries)
        if not no_duplicates:
            errors.append(f"Duplicate transactions found: {', '.join(duplicates)}")
        
        # Collect verified transaction IDs
        if chain_valid and no_duplicates:
            verified_txn_ids = [
                entry['transaction']['txn_id'] for entry in entries
            ]
        
        # Log verification attempt
        try:
            write_audit_log(
                actor="bank",
                action="verify_ledger",
                status="success" if len(errors) == 0 else "failed",
                details={
                    "receiver_id": receiver_id,
                    "entry_count": len(entries),
                    "errors": errors,
                    "verified_count": len(verified_txn_ids)
                }
            )
        except Exception as db_err:
            # Don't fail verification if logging fails, but note it
            print(f"Failed to write audit log: {db_err}")
        
        return LedgerVerificationResponse(
            valid=len(errors) == 0,
            errors=errors,
            verified_transactions=verified_txn_ids
        )
        
    except Exception as e:
        error_msg = f"Verification error: {str(e)}"
        try:
            write_audit_log(
                actor="bank",
                action="verify_ledger",
                status="error",
                details={"error": error_msg}
            )
        except:
            pass
        
        raise HTTPException(status_code=500, detail=error_msg)


@app.post("/settle-ledger", response_model=SettlementResponse)
async def settle_ledger(request: Request):
    """
    Settle verified transactions:
    - Re-verify ledger integrity
    - Check for already-settled transactions
    - Write settlement audit logs
    
    Accepts JSON body as:
    - Direct array: [{"ledger_index": 0, "transaction": {...}, "hash": "...", "status": "..."}, ...]
    - Wrapped: {"ledger": {"receiver_id": "...", "entries": [...], "exported_at": "..."}}
    """
    errors = []
    settled_txn_ids = []
    audit_log_ids = []
    
    try:
        data = await request.json()
        entries, receiver_id = parse_ledger_data(data)
        
        if not entries:
            return SettlementResponse(
                settled=False,
                settled_transactions=[],
                errors=["Ledger is empty"],
                audit_log_ids=[]
            )
        
        # Verify hash chain
        chain_valid, chain_errors = verify_hash_chain(entries)
        if not chain_valid:
            errors.extend(chain_errors)
            errors.append("Ledger verification failed. Cannot settle.")
            return SettlementResponse(
                settled=False,
                settled_transactions=[],
                errors=errors,
                audit_log_ids=[]
            )
        
        # Check duplicates
        no_duplicates, duplicates = check_duplicate_transactions(entries)
        if not no_duplicates:
            errors.append(f"Duplicate transactions found: {', '.join(duplicates)}")
            return SettlementResponse(
                settled=False,
                settled_transactions=[],
                errors=errors,
                audit_log_ids=[]
            )
        
        # Process each transaction
        for entry in entries:
            txn = entry['transaction']
            txn_id = txn['txn_id']
            
            # Check if already settled
            if check_transaction_settled(txn_id):
                errors.append(f"Transaction {txn_id} already settled (replay detected)")
                continue
            
            # Settle transaction
            try:
                log_id = write_audit_log(
                    actor="bank",
                    action="settle",
                    status="success",
                    details={
                        "txn_id": txn_id,
                        "from_id": txn['from_id'],
                        "to_id": txn['to_id'],
                        "amount": txn['amount'],
                        "receiver_id": receiver_id,
                        "ledger_index": entry['ledger_index']
                    },
                    txn_id=txn_id
                )
                settled_txn_ids.append(txn_id)
                audit_log_ids.append(log_id)
            except Exception as settle_err:
                errors.append(f"Failed to settle {txn_id}: {str(settle_err)}")
        
        # Write summary log
        try:
            write_audit_log(
                actor="bank",
                action="settle_ledger_batch",
                status="success" if len(errors) == 0 else "partial",
                details={
                    "receiver_id": receiver_id,
                    "total_transactions": len(entries),
                    "settled_count": len(settled_txn_ids),
                    "errors": errors
                }
            )
        except Exception as summary_err:
            print(f"Failed to write summary log: {summary_err}")
        
        return SettlementResponse(
            settled=len(settled_txn_ids) > 0,
            settled_transactions=settled_txn_ids,
            errors=errors,
            audit_log_ids=audit_log_ids
        )
        
    except Exception as e:
        error_msg = f"Settlement error: {str(e)}"
        try:
            write_audit_log(
                actor="bank",
                action="settle_ledger",
                status="error",
                details={"error": error_msg}
            )
        except:
            pass
        
        raise HTTPException(status_code=500, detail=error_msg)


@app.get("/bank-logs")
async def get_bank_logs(limit: int = 100, offset: int = 0):
    """
    Retrieve bank audit logs from PostgreSQL.
    """
    try:
        logs = get_audit_logs(limit=limit, offset=offset)
        return {
            "logs": logs,
            "count": len(logs),
            "limit": limit,
            "offset": offset
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve logs: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "4000"))
    uvicorn.run(app, host="0.0.0.0", port=port)

