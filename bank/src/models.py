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

