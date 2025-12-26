package com.example.offlinepay

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class RegisterActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_register)

        val etName = findViewById<EditText>(R.id.etName)
        val etAccountId = findViewById<EditText>(R.id.etAccountId)
        val etPin = findViewById<EditText>(R.id.etPin)
        val etInitialBalance = findViewById<EditText>(R.id.etInitialBalance)
        val btnRegister = findViewById<Button>(R.id.btnRegister)

        val dbLocal = AppDatabase.getDatabase(this)
        val dbOnline = FirebaseFirestore.getInstance()

        btnRegister.setOnClickListener {
            val accNum = etAccountId.text.toString()
            val pin = etPin.text.toString()

            // 1. MINIMUM REQUIREMENT: ID and PIN are always needed
            if (accNum.isEmpty() || pin.length != 4) {
                Toast.makeText(this, "Enter Account ID & 4-digit PIN", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // 2. CHECK CLOUD FIRST
            dbOnline.collection("users").document(accNum).get()
                .addOnSuccessListener { document ->
                    if (document.exists()) {
                        // --- SCENARIO A: LOGIN (Account Exists) ---
                        val onlinePin = document.getString("pin")

                        if (onlinePin == pin) {
                            // PIN Matches! Download the REAL data from the Bank.
                            val onlineName = document.getString("name") ?: "User"

                            // Safely get numbers (Handle Integers or Doubles from Firebase)
                            val rawBalance = document.get("balance")
                            val rawOffline = document.get("offlineBalance")
                            val onlineBalance = rawBalance.toString().toDoubleOrNull() ?: 0.0
                            val onlineOfflineBalance = rawOffline.toString().toDoubleOrNull() ?: 0.0

                            // Debug Toast
                            Toast.makeText(this, "Found Cloud Data: Offline=₹$onlineOfflineBalance", Toast.LENGTH_LONG).show()

                            // Create User Object
                            val downloadedUser = UserEntity(
                                name = onlineName,
                                accountNumber = accNum,
                                balance = onlineBalance,
                                offlineBalance = onlineOfflineBalance, // RESTORE OFFLINE FUNDS
                                pinHash = pin,
                                isOfflineMode = false
                            )

                            // Save to Local "Vault"
                            CoroutineScope(Dispatchers.IO).launch {
                                // Wipe old data just in case to prevent conflicts
                                dbLocal.userDao().deleteAll()
                                dbLocal.userDao().insertUser(downloadedUser)

                                navigateToDashboard("Login Successful! Balance: ₹$onlineBalance")
                            }
                        } else {
                            runOnUiThread {
                                Toast.makeText(this@RegisterActivity, "Wrong PIN!", Toast.LENGTH_SHORT).show()
                            }
                        }

                    } else {
                        // --- SCENARIO B: REGISTRATION (Account Missing) ---
                        val name = etName.text.toString()
                        val balanceStr = etInitialBalance.text.toString()

                        if (name.isEmpty() || balanceStr.isEmpty()) {
                            // Prevent accidental new accounts if user just wanted to login
                            runOnUiThread {
                                Toast.makeText(this@RegisterActivity, "Account not found. Fill Name & Balance to Register.", Toast.LENGTH_LONG).show()
                            }
                        } else {
                            // User provided details. They INTEND to register.
                            val initialBalance = balanceStr.toDouble()

                            val newUser = UserEntity(
                                name = name,
                                accountNumber = accNum,
                                balance = initialBalance,
                                offlineBalance = 0.0,
                                pinHash = pin,
                                isOfflineMode = true
                            )

                            // Save Local
                            CoroutineScope(Dispatchers.IO).launch {
                                dbLocal.userDao().insertUser(newUser)

                                // NEW: Log the "Opening Deposit" into History
                                val initialReceipt = TransactionEntity(
                                    type = "DEPOSIT",
                                    amount = initialBalance,
                                    otherParty = "Bank",
                                    timestamp = System.currentTimeMillis()
                                )
                                dbLocal.transactionDao().insertTransaction(initialReceipt)
                            }

                            // Save Cloud
                            val onlineUser = hashMapOf(
                                "name" to name,
                                "balance" to initialBalance,
                                "offlineBalance" to 0.0,
                                "pin" to pin,
                                "isOnline" to true
                            )

                            dbOnline.collection("users").document(accNum).set(onlineUser)
                                .addOnSuccessListener {
                                    navigateToDashboard("Account Created with ₹$initialBalance")
                                }
                        }
                    }
                }
                .addOnFailureListener {
                    // Internet Error
                    runOnUiThread {
                        Toast.makeText(this@RegisterActivity, "Connection Failed. Cannot check Bank.", Toast.LENGTH_SHORT).show()
                    }
                }
        }
    }

    private fun navigateToDashboard(message: String) {
        runOnUiThread {
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
    }
}