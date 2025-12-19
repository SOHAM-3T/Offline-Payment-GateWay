"""
FastAPI backend service for offline payment settlement.
Handles ledger verification and transaction settlement.
"""
import os
import json
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from typing import Union, List, Dict, Any, Optional

from models import (
    LedgerVerificationRequest,
    LedgerVerificationResponse,
    SettlementRequest,
    SettlementResponse,
    Ledger,
    LedgerEntry,
    LogEntry,
    KYCRegistrationRequest,
    KYCRegistrationResponse,
    KYCApprovalRequest,
    UserResponse,
    WalletRequest,
    WalletRequestResponse,
    WalletApprovalRequest,
    WalletResponse
)
from crypto import verify_hash_chain, check_duplicate_transactions, compute_transaction_hash
from crypto_bank import (
    decrypt_aes_key_with_private_key,
    decrypt_aes,
    verify_signature_ecdsa,
    sha256
)
from key_manager import get_or_create_bank_keypair, get_bank_public_key_jwk
from database import (
    write_audit_log, get_audit_logs, check_transaction_settled,
    create_user, update_user_kyc_status, get_user, get_user_by_bank_id, get_all_users,
    create_wallet, approve_wallet, get_wallet, get_wallet_by_user_id,
    update_wallet_balance, settle_transaction_to_wallet, check_wallet_balance_sufficient
)

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
            "logs": "/bank-logs",
            "public_key": "/bank-public-key",
            "kyc": "/kyc/register, /kyc/approve, /kyc/users",
            "wallets": "/wallets/request, /wallets/approve, /wallets/{wallet_id}"
        }
    }


@app.get("/bank-public-key")
async def get_bank_public_key():
    """
    Get bank's public key in JWK format.
    Receiver needs this to encrypt ledgers for the bank.
    """
    try:
        public_key_jwk = get_bank_public_key_jwk()
        return {
            "public_key": public_key_jwk,
            "format": "JWK",
            "algorithm": "ECDH P-256",
            "usage": "Import this key in Receiver app to enable ledger encryption"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get public key: {str(e)}")


async def decrypt_encrypted_ledger(encrypted_data: dict) -> tuple[List[Dict], str]:
    """
    Decrypt encrypted ledger data.
    Returns (entries, receiver_id).
    """
    try:
        # Validate required fields
        if 'encrypted_aes_key' not in encrypted_data:
            raise ValueError("Missing encrypted_aes_key field")
        if 'receiver_public_key' not in encrypted_data:
            raise ValueError("Missing receiver_public_key field (ECDH public key)")
        if 'encrypted_payload' not in encrypted_data:
            raise ValueError("Missing encrypted_payload field")
        if 'iv' not in encrypted_data:
            raise ValueError("Missing iv field")
        
        # Step 1: Decrypt AES key using Bank private key (ECDH)
        # receiver_public_key should be Receiver's ECDH public key
        bank_private_key = get_or_create_bank_keypair()
        
        try:
            aes_key_bytes = decrypt_aes_key_with_private_key(
                encrypted_data['encrypted_aes_key'],
                encrypted_data['receiver_public_key'],  # This should be ECDH public key
                bank_private_key
            )
        except Exception as key_err:
            raise ValueError(f"Failed to decrypt AES key: {str(key_err)}. Check that receiver_public_key is Receiver's ECDH public key.")
        
        # Step 2: Decrypt payload using AES key
        try:
            decrypted_payload = decrypt_aes(
                encrypted_data['encrypted_payload'],
                encrypted_data['iv'],
                aes_key_bytes
            )
            signed_data = json.loads(decrypted_payload)
        except Exception as payload_err:
            raise ValueError(f"Failed to decrypt payload: {str(payload_err)}")
        
        # Step 3: Verify Receiver signature
        ledger_json = json.dumps(signed_data['ledger'], separators=(',', ':'))
        expected_hash = sha256(ledger_json)
        
        if expected_hash != signed_data['hash']:
            raise ValueError("Ledger hash mismatch after decryption")
        
        receiver_public_key_jwk = signed_data.get('receiver_public_key', encrypted_data.get('receiver_public_key'))
        signature_valid = verify_signature_ecdsa(
            signed_data['hash'],
            signed_data['signature'],
            receiver_public_key_jwk
        )
        
        if not signature_valid:
            raise ValueError("Receiver signature verification failed")
        
        # Step 4: Extract ledger entries
        entries = signed_data['ledger']
        receiver_id = "unknown"  # Could be extracted from entries if available
        
        return entries, receiver_id
        
    except Exception as e:
        raise ValueError(f"Decryption failed: {str(e)}")


def parse_ledger_data(data: Any) -> tuple[List[Dict], str]:
    """
    Parse ledger data from various formats:
    - Encrypted: {"encrypted_payload": "...", "encrypted_aes_key": "...", "iv": "...", "receiver_public_key": {...}}
    - Direct array: [{ledger_index: 0, transaction: {...}, ...}, ...]
    - Wrapped: {"ledger": {receiver_id: "...", entries: [...], ...}}
    """
    receiver_id = "unknown"
    entries = []
    
    # Handle encrypted format
    if isinstance(data, dict) and 'encrypted_payload' in data:
        # This is encrypted - will be handled by caller
        raise ValueError("Encrypted data detected - use decrypt_encrypted_ledger")
    
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
    - Decrypts encrypted ledger if provided
    - Verifies Receiver signature
    - Hash chain validation
    - Transaction signature verification
    - Duplicate transaction detection
    
    Accepts JSON body as:
    - Encrypted: {"encrypted_payload": "...", "encrypted_aes_key": "...", "iv": "...", "receiver_public_key": {...}}
    - Direct array: [{"ledger_index": 0, "transaction": {...}, "hash": "...", "status": "..."}, ...]
    - Wrapped: {"ledger": {"receiver_id": "...", "entries": [...], "exported_at": "..."}}
    """
    errors = []
    verified_txn_ids = []
    
    try:
        data = await request.json()
        
        # Check if data is encrypted
        if isinstance(data, dict) and 'encrypted_payload' in data:
            # Decrypt first
            try:
                entries, receiver_id = await decrypt_encrypted_ledger(data)
                write_audit_log(
                    actor="bank",
                    action="decrypt_ledger",
                    status="success",
                    details={"message": "Ledger decrypted successfully"}
                )
            except Exception as decrypt_err:
                return LedgerVerificationResponse(
                    valid=False,
                    errors=[f"Decryption failed: {str(decrypt_err)}"],
                    verified_transactions=[]
                )
        else:
            # Parse unencrypted data
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
        
        # Verify individual transaction signatures
        for i, entry in enumerate(entries):
            txn = entry.get('transaction', {})
            if not txn:
                errors.append(f"Entry {i}: Missing transaction data")
                continue
            
            # Verify transaction hash
            computed_hash = compute_transaction_hash(txn)
            if computed_hash != txn.get('hash'):
                errors.append(f"Entry {i}: Transaction hash mismatch")
            
            # Verify sender signature
            sender_pub_key = txn.get('sender_public_key')
            signature = txn.get('signature')
            if sender_pub_key and signature:
                sig_valid = verify_signature_ecdsa(
                    txn.get('hash', ''),
                    signature,
                    sender_pub_key
                )
                if not sig_valid:
                    errors.append(f"Entry {i}: Sender signature invalid")
        
        # Check for duplicate transactions
        no_duplicates, duplicates = check_duplicate_transactions(entries)
        if not no_duplicates:
            errors.append(f"Duplicate transactions found: {', '.join(duplicates)}")
        
        # Collect verified transaction IDs
        if chain_valid and no_duplicates and len([e for e in errors if 'signature' not in e.lower()]) == 0:
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
    - Decrypts encrypted ledger if provided
    - Verifies Receiver signature
    - Re-verify ledger integrity
    - Check for already-settled transactions
    - Write settlement audit logs
    
    Accepts JSON body as:
    - Encrypted: {"encrypted_payload": "...", "encrypted_aes_key": "...", "iv": "...", "receiver_public_key": {...}}
    - Direct array: [{"ledger_index": 0, "transaction": {...}, "hash": "...", "status": "..."}, ...]
    - Wrapped: {"ledger": {"receiver_id": "...", "entries": [...], "exported_at": "..."}}
    """
    errors = []
    settled_txn_ids = []
    audit_log_ids = []
    
    try:
        data = await request.json()
        
        # Check if data is encrypted
        if isinstance(data, dict) and 'encrypted_payload' in data:
            # Decrypt first
            try:
                entries, receiver_id = await decrypt_encrypted_ledger(data)
                write_audit_log(
                    actor="bank",
                    action="decrypt_ledger",
                    status="success",
                    details={"message": "Ledger decrypted successfully"}
                )
            except Exception as decrypt_err:
                return SettlementResponse(
                    settled=False,
                    settled_transactions=[],
                    errors=[f"Decryption failed: {str(decrypt_err)}"],
                    audit_log_ids=[]
                )
        else:
            # Parse unencrypted data
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
        
        # Verify individual transaction signatures
        for i, entry in enumerate(entries):
            txn = entry.get('transaction', {})
            if not txn:
                errors.append(f"Entry {i}: Missing transaction data")
                continue
            
            # Verify transaction hash
            computed_hash = compute_transaction_hash(txn)
            if computed_hash != txn.get('hash'):
                errors.append(f"Entry {i}: Transaction hash mismatch")
            
            # Verify sender signature
            sender_pub_key = txn.get('sender_public_key')
            signature = txn.get('signature')
            if sender_pub_key and signature:
                sig_valid = verify_signature_ecdsa(
                    txn.get('hash', ''),
                    signature,
                    sender_pub_key
                )
                if not sig_valid:
                    errors.append(f"Entry {i}: Sender signature invalid")
        
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
        
        # If signature errors, don't settle
        signature_errors = [e for e in errors if 'signature' in e.lower() or 'hash mismatch' in e.lower()]
        if signature_errors:
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
            
            # Wallet verification and escrow settlement
            wallet_id = txn.get('wallet_id')
            if wallet_id:
                # Verify wallet exists and is approved
                wallet = get_wallet(wallet_id)
                if not wallet:
                    errors.append(f"Transaction {txn_id}: Wallet {wallet_id} not found")
                    continue
                if wallet['status'] != 'approved':
                    errors.append(f"Transaction {txn_id}: Wallet {wallet_id} not approved (status: {wallet['status']})")
                    continue
                
                # Verify sufficient locked amount in escrow
                if float(wallet['locked_amount']) < float(txn['amount']):
                    errors.append(
                        f"Transaction {txn_id}: Insufficient locked amount. "
                        f"Required: {txn['amount']}, Available: {wallet['locked_amount']}"
                    )
                    continue
                
                # Get user IDs from bank_ids
                from_user = get_user_by_bank_id(txn['from_id'], 'sender')
                to_user = get_user_by_bank_id(txn['to_id'], 'receiver')
                
                if not from_user:
                    errors.append(f"Transaction {txn_id}: Sender user not found for bank_id {txn['from_id']}")
                    continue
                if not to_user:
                    errors.append(f"Transaction {txn_id}: Receiver user not found for bank_id {txn['to_id']}")
                    continue
                
                # Settle transaction and deduct from escrow
                try:
                    settlement_id = settle_transaction_to_wallet(
                        txn_id=txn_id,
                        wallet_id=wallet_id,
                        from_user_id=from_user['user_id'],
                        to_user_id=to_user['user_id'],
                        amount=float(txn['amount']),
                        ledger_index=entry.get('ledger_index'),
                        receiver_id=receiver_id
                    )
                    
                    log_id = write_audit_log(
                        actor="bank",
                        action="settle",
                        status="success",
                        details={
                            "txn_id": txn_id,
                            "wallet_id": wallet_id,
                            "from_id": txn['from_id'],
                            "to_id": txn['to_id'],
                            "amount": txn['amount'],
                            "receiver_id": receiver_id,
                            "ledger_index": entry.get('ledger_index'),
                            "settlement_id": settlement_id
                        },
                        txn_id=txn_id
                    )
                    settled_txn_ids.append(txn_id)
                    audit_log_ids.append(log_id)
                except ValueError as settle_err:
                    errors.append(f"Failed to settle {txn_id}: {str(settle_err)}")
                except Exception as settle_err:
                    errors.append(f"Failed to settle {txn_id}: {str(settle_err)}")
            else:
                # Legacy transaction without wallet_id - still settle but log warning
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
                            "ledger_index": entry.get('ledger_index'),
                            "warning": "Legacy transaction without wallet_id"
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


# KYC Endpoints
@app.post("/kyc/register", response_model=KYCRegistrationResponse)
async def register_kyc(request: KYCRegistrationRequest):
    """
    Register a new user (sender or receiver) with KYC information.
    Binds user identity to their public key.
    """
    try:
        if request.role not in ['sender', 'receiver']:
            raise HTTPException(status_code=400, detail="Role must be 'sender' or 'receiver'")
        
        user_id = create_user(
            full_name=request.full_name,
            email_or_phone=request.email_or_phone,
            role=request.role,
            bank_id=request.bank_id,
            public_key_jwk=request.public_key_jwk
        )
        
        write_audit_log(
            actor="bank",
            action="kyc_register",
            status="success",
            details={
                "user_id": user_id,
                "role": request.role,
                "bank_id": request.bank_id
            }
        )
        
        return KYCRegistrationResponse(
            user_id=user_id,
            kyc_status="pending",
            message="KYC registration submitted. Awaiting approval."
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        write_audit_log(
            actor="bank",
            action="kyc_register",
            status="error",
            details={"error": str(e)}
        )
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")


@app.post("/kyc/approve")
async def approve_kyc(request: KYCApprovalRequest):
    """
    Approve or reject a KYC registration.
    """
    try:
        if request.kyc_status not in ['approved', 'rejected']:
            raise HTTPException(status_code=400, detail="kyc_status must be 'approved' or 'rejected'")
        
        updated = update_user_kyc_status(request.user_id, request.kyc_status)
        if not updated:
            raise HTTPException(status_code=404, detail="User not found")
        
        write_audit_log(
            actor="bank",
            action="kyc_approve",
            status="success",
            details={
                "user_id": request.user_id,
                "kyc_status": request.kyc_status,
                "notes": request.notes
            }
        )
        
        return {"message": f"KYC {request.kyc_status}", "user_id": request.user_id}
    except HTTPException:
        raise
    except Exception as e:
        write_audit_log(
            actor="bank",
            action="kyc_approve",
            status="error",
            details={"error": str(e)}
        )
        raise HTTPException(status_code=500, detail=f"Approval failed: {str(e)}")


@app.get("/kyc/users", response_model=List[UserResponse])
async def list_users(kyc_status: Optional[str] = None):
    """
    List all users, optionally filtered by kyc_status.
    """
    try:
        users = get_all_users(kyc_status=kyc_status)
        return [UserResponse(**user) for user in users]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve users: {str(e)}")


@app.get("/kyc/users/{user_id}", response_model=UserResponse)
async def get_user_info(user_id: str):
    """
    Get user information by user_id.
    """
    try:
        user = get_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return UserResponse(**user)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve user: {str(e)}")


# Wallet Endpoints
@app.post("/wallets/request", response_model=WalletRequestResponse)
async def request_wallet(request: WalletRequest):
    """
    Request creation of an offline wallet.
    User must have approved KYC.
    """
    try:
        # Check if user exists and is approved
        user = get_user(request.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if user['kyc_status'] != 'approved':
            raise HTTPException(
                status_code=400,
                detail=f"User KYC must be approved. Current status: {user['kyc_status']}"
            )
        
        # Check if wallet already exists
        existing_wallet = get_wallet_by_user_id(request.user_id)
        if existing_wallet:
            raise HTTPException(status_code=400, detail="Wallet already exists for this user")
        
        wallet_id = create_wallet(request.user_id, request.requested_limit)
        
        write_audit_log(
            actor="bank",
            action="wallet_request",
            status="success",
            details={
                "wallet_id": wallet_id,
                "user_id": request.user_id,
                "requested_limit": request.requested_limit
            }
        )
        
        return WalletRequestResponse(
            wallet_id=wallet_id,
            status="pending",
            message="Wallet request submitted. Awaiting approval."
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        write_audit_log(
            actor="bank",
            action="wallet_request",
            status="error",
            details={"error": str(e)}
        )
        raise HTTPException(status_code=500, detail=f"Wallet request failed: {str(e)}")


@app.post("/wallets/approve")
async def approve_wallet_request(request: WalletApprovalRequest):
    """
    Approve a wallet request and lock the escrow amount.
    """
    try:
        if request.status not in ['approved', 'rejected']:
            raise HTTPException(status_code=400, detail="status must be 'approved' or 'rejected'")
        
        wallet = get_wallet(request.wallet_id)
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")
        
        if request.status == 'approved':
            updated = approve_wallet(request.wallet_id, request.approved_limit)
            if not updated:
                raise HTTPException(status_code=500, detail="Failed to approve wallet")
        else:
            # Reject wallet
            conn = get_db_connection()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE wallets
                        SET status = 'rejected', updated_at = NOW()
                        WHERE wallet_id = %s
                        """,
                        (request.wallet_id,)
                    )
                    conn.commit()
            finally:
                conn.close()
        
        write_audit_log(
            actor="bank",
            action="wallet_approve",
            status="success",
            details={
                "wallet_id": request.wallet_id,
                "status": request.status,
                "approved_limit": request.approved_limit if request.status == 'approved' else None,
                "notes": request.notes
            }
        )
        
        return {"message": f"Wallet {request.status}", "wallet_id": request.wallet_id}
    except HTTPException:
        raise
    except Exception as e:
        write_audit_log(
            actor="bank",
            action="wallet_approve",
            status="error",
            details={"error": str(e)}
        )
        raise HTTPException(status_code=500, detail=f"Wallet approval failed: {str(e)}")


@app.get("/wallets/{wallet_id}", response_model=WalletResponse)
async def get_wallet_info(wallet_id: str):
    """
    Get wallet information by wallet_id.
    """
    try:
        wallet = get_wallet(wallet_id)
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")
        return WalletResponse(**wallet)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve wallet: {str(e)}")


@app.get("/wallets/user/{user_id}", response_model=WalletResponse)
async def get_wallet_by_user(user_id: str):
    """
    Get wallet information by user_id.
    """
    try:
        wallet = get_wallet_by_user_id(user_id)
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found for this user")
        return WalletResponse(**wallet)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve wallet: {str(e)}")


# KYC Endpoints
@app.post("/kyc/register", response_model=KYCRegistrationResponse)
async def register_kyc(request: KYCRegistrationRequest):
    """
    Register a new user (sender or receiver) with KYC information.
    Binds user identity to their public key.
    """
    try:
        if request.role not in ['sender', 'receiver']:
            raise HTTPException(status_code=400, detail="Role must be 'sender' or 'receiver'")
        
        user_id = create_user(
            full_name=request.full_name,
            email_or_phone=request.email_or_phone,
            role=request.role,
            bank_id=request.bank_id,
            public_key_jwk=request.public_key_jwk
        )
        
        write_audit_log(
            actor="bank",
            action="kyc_register",
            status="success",
            details={
                "user_id": user_id,
                "role": request.role,
                "bank_id": request.bank_id
            }
        )
        
        return KYCRegistrationResponse(
            user_id=user_id,
            kyc_status="pending",
            message="KYC registration submitted. Awaiting approval."
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        write_audit_log(
            actor="bank",
            action="kyc_register",
            status="error",
            details={"error": str(e)}
        )
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")


@app.post("/kyc/approve")
async def approve_kyc(request: KYCApprovalRequest):
    """
    Approve or reject a KYC registration.
    """
    try:
        if request.kyc_status not in ['approved', 'rejected']:
            raise HTTPException(status_code=400, detail="kyc_status must be 'approved' or 'rejected'")
        
        updated = update_user_kyc_status(request.user_id, request.kyc_status)
        if not updated:
            raise HTTPException(status_code=404, detail="User not found")
        
        write_audit_log(
            actor="bank",
            action="kyc_approve",
            status="success",
            details={
                "user_id": request.user_id,
                "kyc_status": request.kyc_status,
                "notes": request.notes
            }
        )
        
        return {"message": f"KYC {request.kyc_status}", "user_id": request.user_id}
    except HTTPException:
        raise
    except Exception as e:
        write_audit_log(
            actor="bank",
            action="kyc_approve",
            status="error",
            details={"error": str(e)}
        )
        raise HTTPException(status_code=500, detail=f"Approval failed: {str(e)}")


@app.get("/kyc/users", response_model=List[UserResponse])
async def list_users(kyc_status: Optional[str] = None):
    """
    List all users, optionally filtered by kyc_status.
    """
    try:
        users = get_all_users(kyc_status=kyc_status)
        return [UserResponse(**user) for user in users]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve users: {str(e)}")


@app.get("/kyc/users/{user_id}", response_model=UserResponse)
async def get_user_info(user_id: str):
    """
    Get user information by user_id.
    """
    try:
        user = get_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return UserResponse(**user)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve user: {str(e)}")


# Wallet Endpoints
@app.post("/wallets/request", response_model=WalletRequestResponse)
async def request_wallet(request: WalletRequest):
    """
    Request creation of an offline wallet.
    User must have approved KYC.
    """
    try:
        # Check if user exists and is approved
        user = get_user(request.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if user['kyc_status'] != 'approved':
            raise HTTPException(
                status_code=400,
                detail=f"User KYC must be approved. Current status: {user['kyc_status']}"
            )
        
        # Check if wallet already exists
        existing_wallet = get_wallet_by_user_id(request.user_id)
        if existing_wallet:
            raise HTTPException(status_code=400, detail="Wallet already exists for this user")
        
        wallet_id = create_wallet(request.user_id, request.requested_limit)
        
        write_audit_log(
            actor="bank",
            action="wallet_request",
            status="success",
            details={
                "wallet_id": wallet_id,
                "user_id": request.user_id,
                "requested_limit": request.requested_limit
            }
        )
        
        return WalletRequestResponse(
            wallet_id=wallet_id,
            status="pending",
            message="Wallet request submitted. Awaiting approval."
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        write_audit_log(
            actor="bank",
            action="wallet_request",
            status="error",
            details={"error": str(e)}
        )
        raise HTTPException(status_code=500, detail=f"Wallet request failed: {str(e)}")


@app.post("/wallets/approve")
async def approve_wallet_request(request: WalletApprovalRequest):
    """
    Approve a wallet request and lock the escrow amount.
    """
    try:
        if request.status not in ['approved', 'rejected']:
            raise HTTPException(status_code=400, detail="status must be 'approved' or 'rejected'")
        
        wallet = get_wallet(request.wallet_id)
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")
        
        if request.status == 'approved':
            updated = approve_wallet(request.wallet_id, request.approved_limit)
            if not updated:
                raise HTTPException(status_code=500, detail="Failed to approve wallet")
        else:
            # Reject wallet
            conn = get_db_connection()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE wallets
                        SET status = 'rejected', updated_at = NOW()
                        WHERE wallet_id = %s
                        """,
                        (request.wallet_id,)
                    )
                    conn.commit()
            finally:
                conn.close()
        
        write_audit_log(
            actor="bank",
            action="wallet_approve",
            status="success",
            details={
                "wallet_id": request.wallet_id,
                "status": request.status,
                "approved_limit": request.approved_limit if request.status == 'approved' else None,
                "notes": request.notes
            }
        )
        
        return {"message": f"Wallet {request.status}", "wallet_id": request.wallet_id}
    except HTTPException:
        raise
    except Exception as e:
        write_audit_log(
            actor="bank",
            action="wallet_approve",
            status="error",
            details={"error": str(e)}
        )
        raise HTTPException(status_code=500, detail=f"Wallet approval failed: {str(e)}")


@app.get("/wallets/{wallet_id}", response_model=WalletResponse)
async def get_wallet_info(wallet_id: str):
    """
    Get wallet information by wallet_id.
    """
    try:
        wallet = get_wallet(wallet_id)
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")
        return WalletResponse(**wallet)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve wallet: {str(e)}")


@app.get("/wallets/user/{user_id}", response_model=WalletResponse)
async def get_wallet_by_user(user_id: str):
    """
    Get wallet information by user_id.
    """
    try:
        wallet = get_wallet_by_user_id(user_id)
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found for this user")
        return WalletResponse(**wallet)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve wallet: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "4000"))
    uvicorn.run(app, host="0.0.0.0", port=port)

