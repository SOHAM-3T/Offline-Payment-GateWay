package com.example.offlinepay

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface UserDao {
    // For creating new Account
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertUser(user: UserEntity)

    @Update
    suspend fun updateUser(user: UserEntity)

    @Query("SELECT * FROM user_table LIMIT 1")
    suspend fun getUser(): UserEntity?

    @Query("SELECT * FROM user_table WHERE pinHash = :pin LIMIT 1")
    suspend fun login(pin: String): UserEntity?
    // --- TRANSACTION COMMANDS ---

    // 1. Save a new receipt
    @Insert
    suspend fun insertTransaction(transaction: TransactionEntity)

    // 2. Get all history (Passbook)
    @Query("SELECT * FROM transaction_table ORDER BY timestamp DESC")
    suspend fun getAllTransactions(): List<TransactionEntity>

    // 3. Update Balance (Securely)
    @Query("UPDATE user_table SET balance = balance + :amount WHERE id = :userId")
    suspend fun addMoney(userId: Int, amount: Double)

    @Query("UPDATE user_table SET balance = balance - :amount WHERE id = :userId")
    suspend fun deductMoney(userId: Int, amount: Double)

    // Move money FROM Main TO Offline (Locking it)
    @Query("UPDATE user_table SET balance = balance - :amount, offlineBalance = offlineBalance + :amount WHERE id = :userId")
    suspend fun moveToOffline(userId: Int, amount: Double)

    // Move money FROM Offline TO Main (Restoring it)
    @Query("UPDATE user_table SET balance = balance + :amount, offlineBalance = offlineBalance - :amount WHERE id = :userId")
    suspend fun restoreToMain(userId: Int, amount: Double)

    @Query("DELETE FROM user_table")
    suspend fun deleteAll()

}