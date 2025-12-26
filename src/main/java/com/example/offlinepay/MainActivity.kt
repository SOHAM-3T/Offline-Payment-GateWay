package com.example.offlinepay

import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var tvWelcome: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize UI Elements
        tvWelcome = findViewById(R.id.tvWelcome)
        val cardOfflineWallet = findViewById<CardView>(R.id.cardOfflineWallet)
        val cardScanQr = findViewById<CardView>(R.id.cardScanQr)
        val cardContacts = findViewById<CardView>(R.id.cardContacts)
        val cardHistory = findViewById<CardView>(R.id.cardHistory)

        // 1. Offline Wallet -> Goes to the Secure Offline Section
        cardOfflineWallet.setOnClickListener {
            startActivity(Intent(this, SendMoneyActivity::class.java))
        }

        // 2. Scan QR -> Opens the Scanner Camera
        cardScanQr.setOnClickListener {
            startActivity(Intent(this, ScanQrActivity::class.java))
        }

        // 3. Contacts -> Opens P2P Contact Payment
        cardContacts.setOnClickListener {
            startActivity(Intent(this, ContactPaymentActivity::class.java))
        }

        // 4. History -> Opens Transaction Log
        cardHistory.setOnClickListener {
            startActivity(Intent(this, HistoryActivity::class.java))
        }

        // Initial Load
        refreshDashboard()
    }

    override fun onResume() {
        super.onResume()
        // --- NEW: AUTOMATIC SYNC ---
        // Whenever the user opens the app or returns to this screen,
        // we check for internet and sync any offline transactions.
        SyncManager.synchronize(this)

        // Refresh the name/UI
        refreshDashboard()
    }

    private fun refreshDashboard() {
        val db = AppDatabase.getDatabase(this)
        CoroutineScope(Dispatchers.Main).launch {
            val user = withContext(Dispatchers.IO) {
                db.userDao().getUser()
            }

            if (user != null) {
                tvWelcome.text = "Hello, ${user.name}"
            } else {
                // If app data was cleared or fresh install, go to Register
                startActivity(Intent(this@MainActivity, RegisterActivity::class.java))
                finish()
            }
        }
    }
}