package com.example.offlinepay

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SendMoneyActivity : AppCompatActivity() {

    private var currentUser: UserEntity? = null
    private lateinit var tvOfflineBalance: TextView
    private lateinit var etLoadAmount: EditText
    private lateinit var layoutActions: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_send_money)

        // Initialize Views
        tvOfflineBalance = findViewById(R.id.tvOfflineBalance)
        etLoadAmount = findViewById(R.id.etLoadAmount)
        layoutActions = findViewById(R.id.layoutActions)
        val btnLock = findViewById<Button>(R.id.btnLockMoney)
        val btnRestore = findViewById<Button>(R.id.btnRestoreMoney)
        val btnPay = findViewById<Button>(R.id.btnPayNearby)
        val btnReceive = findViewById<Button>(R.id.btnReceive)

        // Load Data
        loadUserData()

        // 1. LOCK MONEY (Online -> Offline)
        btnLock.setOnClickListener {
            val amountStr = etLoadAmount.text.toString()
            if (amountStr.isEmpty()) return@setOnClickListener

            val amount = amountStr.toDouble()

            if (currentUser != null) {
                if (currentUser!!.balance >= amount) {
                    // SECURITY CHECK: Ask for PIN before Locking
                    showPinDialog {
                        performTransaction(amount, isLocking = true)
                    }
                } else {
                    Toast.makeText(this, "Insufficient Bank Balance!", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // 2. RESTORE MONEY (Offline -> Online)
        btnRestore.setOnClickListener {
            if (currentUser != null && currentUser!!.offlineBalance > 0) {
                // SECURITY CHECK: Ask for PIN before Restoring
                showPinDialog {
                    // Restore everything (or specific amount if you change logic later)
                    performTransaction(currentUser!!.offlineBalance, isLocking = false)
                }
            } else {
                Toast.makeText(this, "No offline funds to restore.", Toast.LENGTH_SHORT).show()
            }
        }

        // 3. PAY NEARBY (Bluetooth Discovery)
        btnPay.setOnClickListener {
            // Redirect to Contact/P2P Screen instead of just searching blindly
            showPinDialog {
                startActivity(Intent(this, ContactPaymentActivity::class.java))
            }
        }

        // 4. RECEIVE (Show QR Code)
        btnReceive.setOnClickListener {
            startActivity(Intent(this, ReceiveQrActivity::class.java))
        }
    }

    // --- SECURITY HELPER ---
    private fun showPinDialog(onSuccess: () -> Unit) {
        val inputEdit = EditText(this)
        inputEdit.hint = "Enter 4-Digit PIN"
        inputEdit.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        inputEdit.gravity = Gravity.CENTER
        inputEdit.textSize = 20f

        val dialog = AlertDialog.Builder(this)
            .setTitle("Authorize Transaction")
            .setMessage("Enter your Security PIN to proceed.")
            .setView(inputEdit)
            .setPositiveButton("CONFIRM") { _, _ ->
                val enteredPin = inputEdit.text.toString()
                if (currentUser != null && enteredPin == currentUser!!.pinHash) {
                    onSuccess()
                } else {
                    Toast.makeText(this, "Incorrect PIN!", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("CANCEL", null)
            .create()

        dialog.setView(inputEdit, 50, 20, 50, 0)
        dialog.show()
    }

    private fun loadUserData() {
        val db = AppDatabase.getDatabase(this)
        CoroutineScope(Dispatchers.Main).launch {
            val user = withContext(Dispatchers.IO) {
                db.userDao().getUser()
            }
            currentUser = user
            if (user != null) {
                tvOfflineBalance.text = "₹ ${user.offlineBalance}"

                if (user.offlineBalance > 0) {
                    layoutActions.visibility = View.VISIBLE
                } else {
                    layoutActions.visibility = View.GONE
                }
            }
        }
    }

    private fun performTransaction(amount: Double, isLocking: Boolean) {
        val dbLocal = AppDatabase.getDatabase(this)
        val dbOnline = FirebaseFirestore.getInstance()

        // 1. Calculate New Balances
        val currentMain = currentUser!!.balance
        val currentOffline = currentUser!!.offlineBalance
        var newMain = 0.0
        var newOffline = 0.0

        if (isLocking) {
            newMain = currentMain - amount
            newOffline = currentOffline + amount
        } else {
            newMain = currentMain + amount
            newOffline = currentOffline - amount
        }

        // 2. Update CLOUD First
        val updates = hashMapOf<String, Any>(
            "balance" to newMain,
            "offlineBalance" to newOffline
        )

        dbOnline.collection("users").document(currentUser!!.accountNumber)
            .update(updates)
            .addOnSuccessListener {
                // 3. If Cloud Success -> Update LOCAL & SAVE HISTORY
                CoroutineScope(Dispatchers.IO).launch {
                    if (isLocking) {
                        dbLocal.userDao().moveToOffline(currentUser!!.id, amount)

                        // NEW: Log "LOCKED" Transaction
                        dbLocal.transactionDao().insertTransaction(TransactionEntity(
                            type = "LOCKED",
                            amount = amount,
                            otherParty = "Bank Vault",
                            timestamp = System.currentTimeMillis()
                        ))

                    } else {
                        dbLocal.userDao().restoreToMain(currentUser!!.id, amount)

                        // NEW: Log "RESTORED" Transaction
                        dbLocal.transactionDao().insertTransaction(TransactionEntity(
                            type = "RESTORED",
                            amount = amount,
                            otherParty = "Bank Vault",
                            timestamp = System.currentTimeMillis()
                        ))
                    }

                    // Refresh UI
                    runOnUiThread {
                        etLoadAmount.text.clear()
                        val type = if (isLocking) "Locked" else "Restored"
                        Toast.makeText(this@SendMoneyActivity, "Success! $type ₹$amount", Toast.LENGTH_SHORT).show()
                        loadUserData()
                    }
                }
            }
            .addOnFailureListener {
                Toast.makeText(this, "Network Error: Cannot contact Bank.", Toast.LENGTH_LONG).show()
            }
    }
}