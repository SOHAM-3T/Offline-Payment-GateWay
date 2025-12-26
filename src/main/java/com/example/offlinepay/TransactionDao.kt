package com.example.offlinepay

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface TransactionDao {
    // 1. Save a new receipt
    @Insert
    suspend fun insertTransaction(transaction: TransactionEntity)

    // 2. Get all receipts (Newest first)
    @Query("SELECT * FROM transaction_table ORDER BY id DESC")
    suspend fun getAllTransactions(): List<TransactionEntity>
}