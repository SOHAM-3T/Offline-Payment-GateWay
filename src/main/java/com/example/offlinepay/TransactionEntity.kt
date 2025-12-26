package com.example.offlinepay

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "transaction_table")
data class TransactionEntity(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val type: String,          // "SENT", "RECEIVED", "LOCKED", "RESTORED"
    val amount: Double,
    val otherParty: String,    // Phone number or ID
    val timestamp: Long        // Time in milliseconds
)