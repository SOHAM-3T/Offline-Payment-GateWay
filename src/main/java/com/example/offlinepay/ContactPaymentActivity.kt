package com.example.offlinepay

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.ContactsContract
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ContactPaymentActivity : AppCompatActivity() {

    private lateinit var etPhone: EditText
    private lateinit var etAmount: EditText
    private lateinit var tvStatus: TextView
    private lateinit var btnPay: Button
    private lateinit var btnPickContact: ImageButton

    private val STRATEGY = Strategy.P2P_POINT_TO_POINT
    private val SERVICE_ID = "com.example.offlinepay"

    private var targetPhoneNumber: String = ""
    private var currentUser: UserEntity? = null

    // --- PERMISSIONS ---
    private fun getRequiredPermissions(): Array<String> {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_SCAN)
            permissions.add(Manifest.permission.BLUETOOTH_ADVERTISE)
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            permissions.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }
        return permissions.toTypedArray()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_contact_payment)

        etPhone = findViewById(R.id.etTargetPhone)
        etAmount = findViewById(R.id.etAmount)
        tvStatus = findViewById(R.id.tvStatus)
        btnPay = findViewById(R.id.btnPay)
        btnPickContact = findViewById(R.id.btnPickContact)

        // Load User Data
        val db = AppDatabase.getDatabase(this)
        CoroutineScope(Dispatchers.Main).launch {
            currentUser = withContext(Dispatchers.IO) { db.userDao().getUser() }
        }

        // Handle QR Scan Result
        val scannedId = intent.getStringExtra("TARGET_ID")
        if (scannedId != null) {
            etPhone.setText(scannedId)
        }

        // Contact Picker
        val contactLauncher = registerForActivityResult(ActivityResultContracts.PickContact()) { uri ->
            if (uri != null) {
                val cursor = contentResolver.query(uri, null, null, null, null)
                if (cursor != null && cursor.moveToFirst()) {
                    val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                    if (numberIndex >= 0) {
                        var number = cursor.getString(numberIndex)
                        number = number.replace("[^0-9]".toRegex(), "")
                        etPhone.setText(number)
                    }
                    cursor.close()
                }
            }
        }
        btnPickContact.setOnClickListener { contactLauncher.launch(null) }

        // Pay Button
        btnPay.setOnClickListener {
            targetPhoneNumber = etPhone.text.toString()
            val amountStr = etAmount.text.toString()

            if (targetPhoneNumber.isEmpty() || amountStr.isEmpty()) {
                Toast.makeText(this, "Enter Details First", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            if (!arePermissionsGranted()) {
                ActivityCompat.requestPermissions(this, getRequiredPermissions(), 1001)
            } else {
                showPinDialog {
                    startDiscovery(targetPhoneNumber)
                }
            }
        }
    }

    private fun arePermissionsGranted(): Boolean {
        for (permission in getRequiredPermissions()) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                return false
            }
        }
        return true
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1001) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                Toast.makeText(this, "Permission Granted! Click Pay again.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showPinDialog(onSuccess: () -> Unit) {
        val inputEdit = EditText(this)
        inputEdit.hint = "Enter 4-Digit PIN"
        inputEdit.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        inputEdit.gravity = Gravity.CENTER

        val dialog = AlertDialog.Builder(this)
            .setTitle("Authorize Payment")
            .setMessage("Enter PIN to send money to $targetPhoneNumber")
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

    private fun startDiscovery(targetId: String) {
        tvStatus.text = "Searching for $targetId..."
        val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()

        Nearby.getConnectionsClient(this)
            .startDiscovery(SERVICE_ID, object : EndpointDiscoveryCallback() {
                override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
                    if (info.endpointName == targetId) {
                        tvStatus.text = "Found $targetId! Connecting..."
                        Nearby.getConnectionsClient(this@ContactPaymentActivity)
                            .requestConnection("Sender", endpointId, connectionLifecycleCallback)
                    }
                }
                override fun onEndpointLost(endpointId: String) {}
            }, options)
            .addOnFailureListener { e ->
                tvStatus.text = "Error: ${e.message}"
            }
    }

    private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            Nearby.getConnectionsClient(this@ContactPaymentActivity).acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            if (result.status.isSuccess) {
                // IMPORTANT: Stop discovery once connected to save bandwidth and avoid conflicts
                Nearby.getConnectionsClient(this@ContactPaymentActivity).stopDiscovery()
                sendMoney(endpointId)
            }
        }
        override fun onDisconnected(endpointId: String) {}
    }

    private fun sendMoney(endpointId: String) {
        val amountStr = etAmount.text.toString()
        val amount = amountStr.toDouble()

        if (currentUser == null || currentUser!!.offlineBalance < amount) {
            runOnUiThread {
                Toast.makeText(this, "Insufficient Offline Funds!", Toast.LENGTH_SHORT).show()
                Nearby.getConnectionsClient(this).disconnectFromEndpoint(endpointId)
            }
            return
        }

        // 1. Send Signal
        val bytes = amountStr.toByteArray()
        Nearby.getConnectionsClient(this).sendPayload(endpointId, Payload.fromBytes(bytes))

        // 2. Update DB & History
        val db = AppDatabase.getDatabase(this)
        CoroutineScope(Dispatchers.IO).launch {
            val newBalance = currentUser!!.offlineBalance - amount
            val updatedUser = currentUser!!.copy(offlineBalance = newBalance)
            db.userDao().insertUser(updatedUser)

            val receipt = TransactionEntity(
                type = "SENT",
                amount = amount,
                otherParty = targetPhoneNumber,
                timestamp = System.currentTimeMillis()
            )
            db.transactionDao().insertTransaction(receipt)

            // 3. FIX: Disconnect immediately & Trigger Sync
            Nearby.getConnectionsClient(this@ContactPaymentActivity).disconnectFromEndpoint(endpointId)

            // Try to Sync (updates Bank Server if internet is ON)
            SyncManager.synchronize(this@ContactPaymentActivity)

            runOnUiThread {
                tvStatus.text = "Sent ₹$amount! Disconnected."
                Toast.makeText(this@ContactPaymentActivity, "Success! New Balance: ₹$newBalance", Toast.LENGTH_LONG).show()
                currentUser = updatedUser
                etAmount.text.clear() // Clear for next use
            }
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {}
        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }
}