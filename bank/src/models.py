"""
Data models for offline payment system.
Matches the frontend transaction and ledger structures.
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    """Signed transaction created by Sender."""
    txn_id: str
    from_id: str
    to_id: str
    amount: float
    timestamp: str
    prev_hash: Optional[str] = None
    hash: str
    signature: str
    wallet_id: Optional[str] = None  # Wallet ID for offline payments


class LedgerEntry(BaseModel):
    """Append-only ledger entry stored by Receiver."""
    ledger_index: int
    transaction: Transaction
    hash: str
    status: str = Field(default="pending")


class Ledger(BaseModel):
    """Complete ledger exported by Receiver."""
    receiver_id: str
    entries: List[LedgerEntry]
    exported_at: str


class LogEntry(BaseModel):
    """Structured audit log entry."""
    log_id: Optional[str] = None
    actor: str
    action: str
    txn_id: Optional[str] = None
    timestamp: str
    connectivity: str
    status: str
    details: dict


class LedgerVerificationRequest(BaseModel):
    """Request body for ledger verification."""
    ledger: Ledger


class LedgerVerificationResponse(BaseModel):
    """Response from ledger verification."""
    valid: bool
    errors: List[str]
    verified_transactions: List[str] = Field(default_factory=list)


class SettlementRequest(BaseModel):
    """Request body for settlement."""
    ledger: Ledger


class SettlementResponse(BaseModel):
    """Response from settlement."""
    settled: bool
    settled_transactions: List[str]
    errors: List[str]
    audit_log_ids: List[str] = Field(default_factory=list)


# KYC Models
class KYCRegistrationRequest(BaseModel):
    """KYC registration request from sender or receiver."""
    full_name: str
    email_or_phone: str
    role: str  # 'sender' or 'receiver'
    bank_id: str
    public_key_jwk: dict  # ECDSA public key in JWK format


class KYCRegistrationResponse(BaseModel):
    """Response from KYC registration."""
    user_id: str
    kyc_status: str
    message: str


class KYCApprovalRequest(BaseModel):
    """Request to approve/reject KYC."""
    user_id: str
    kyc_status: str  # 'approved' or 'rejected'
    notes: Optional[str] = None


class UserResponse(BaseModel):
    """User information response."""
    user_id: str
    full_name: str
    email_or_phone: str
    role: str
    bank_id: str
    kyc_status: str
    created_at: str


# Wallet Models
class WalletRequest(BaseModel):
    """Request to create/update offline wallet."""
    user_id: str
    requested_limit: float


class WalletRequestResponse(BaseModel):
    """Response from wallet request."""
    wallet_id: str
    status: str
    message: str


class WalletApprovalRequest(BaseModel):
    """Request to approve/reject wallet."""
    wallet_id: str
    approved_limit: float
    status: str  # 'approved' or 'rejected'
    notes: Optional[str] = None


class WalletResponse(BaseModel):
    """Wallet information response."""
    wallet_id: str
    user_id: str
    approved_limit: float
    current_balance: float
    used_amount: float
    locked_amount: float
    status: str
    created_at: str
    updated_at: str

