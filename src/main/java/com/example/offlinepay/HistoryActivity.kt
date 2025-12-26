package com.example.offlinepay

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class HistoryActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_history)

        val tvLog = findViewById<TextView>(R.id.tvHistoryLog)
        val db = AppDatabase.getDatabase(this)

        CoroutineScope(Dispatchers.Main).launch {
            // Fetch List from Database
            val list = withContext(Dispatchers.IO) {
                db.transactionDao().getAllTransactions()
            }

            if (list.isEmpty()) {
                tvLog.text = "No transactions yet."
            } else {
                // Build a big string to show them (Simple List)
                val builder = StringBuilder()
                val formatter = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())

                for (item in list) {
                    val dateStr = formatter.format(Date(item.timestamp))
                    val symbol = if (item.type == "RECEIVED" || item.type == "LOCKED") "+" else "-"

                    builder.append("$dateStr  |  ${item.type}\n")
                    builder.append("${item.otherParty} :  $symbol ₹${item.amount}\n")
                    builder.append("--------------------------------------\n")
                }
                tvLog.text = builder.toString()
            }
        }
    }
}