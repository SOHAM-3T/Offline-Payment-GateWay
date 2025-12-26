package com.example.offlinepay

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "user_table")
data class UserEntity(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val name: String,
    val accountNumber: String,
    val balance: Double,       // Main Available Balance
    val offlineBalance: Double = 0.0, // NEW: Locked for Offline Use
    val pinHash: String,
    val isOfflineMode: Boolean = true
)