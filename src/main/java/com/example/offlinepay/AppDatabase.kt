package com.example.offlinepay

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

// UPDATED: Added TransactionEntity to entities list, Version -> 4
@Database(entities = [UserEntity::class, TransactionEntity::class], version = 4, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {

    abstract fun userDao(): UserDao
    abstract fun transactionDao(): TransactionDao // NEW: Access to history

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "offline_pay_database"
                )
                    .fallbackToDestructiveMigration() // Wipes data if version changes
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}