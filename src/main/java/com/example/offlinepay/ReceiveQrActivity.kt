package com.example.offlinepay

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeEncoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ReceiveQrActivity : AppCompatActivity() {

    private lateinit var tvStatus: TextView
    private lateinit var connectionsClient: ConnectionsClient

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
        setContentView(R.layout.activity_receive_qr)

        val ivQr = findViewById<ImageView>(R.id.ivQrCode)
        val tvId = findViewById<TextView>(R.id.tvMyId)
        tvStatus = findViewById(R.id.tvStatus)
        connectionsClient = Nearby.getConnectionsClient(this)

        val db = AppDatabase.getDatabase(this)

        CoroutineScope(Dispatchers.Main).launch {
            val user = withContext(Dispatchers.IO) { db.userDao().getUser() }

            if (user != null) {
                val myId = user.accountNumber
                tvId.text = "ID: $myId"

                // Generate QR
                try {
                    val barcodeEncoder = BarcodeEncoder()
                    val bitmap: Bitmap = barcodeEncoder.encodeBitmap(myId, BarcodeFormat.QR_CODE, 400, 400)
                    ivQr.setImageBitmap(bitmap)
                } catch (e: Exception) {
                    e.printStackTrace()
                }

                // Start
                if (!arePermissionsGranted()) {
                    tvStatus.text = "Waiting for Permissions..."
                    ActivityCompat.requestPermissions(this@ReceiveQrActivity, getRequiredPermissions(), 1002)
                } else {
                    startAdvertising(myId)
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
        if (requestCode == 1002) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                tvStatus.text = "Permission Granted. Restarting..."
                recreate()
            } else {
                tvStatus.text = "Permission Denied."
            }
        }
    }

    private fun startAdvertising(myId: String) {
        val options = AdvertisingOptions.Builder().setStrategy(Strategy.P2P_POINT_TO_POINT).build()

        connectionsClient.startAdvertising(
            myId,
            "com.example.offlinepay",
            object : ConnectionLifecycleCallback() {
                override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
                    connectionsClient.acceptConnection(endpointId, object : PayloadCallback() {
                        override fun onPayloadReceived(id: String, payload: Payload) {
                            if (payload.type == Payload.Type.BYTES) {
                                val bytes = payload.asBytes() ?: return
                                val amount = String(bytes, Charsets.UTF_8).toDoubleOrNull() ?: 0.0

                                CoroutineScope(Dispatchers.IO).launch {
                                    val db = AppDatabase.getDatabase(this@ReceiveQrActivity)
                                    val currentUser = db.userDao().getUser()

                                    if (currentUser != null) {
                                        val newBalance = currentUser.offlineBalance + amount
                                        val updatedUser = currentUser.copy(offlineBalance = newBalance)
                                        db.userDao().insertUser(updatedUser)

                                        val receipt = TransactionEntity(
                                            type = "RECEIVED",
                                            amount = amount,
                                            otherParty = "QR Sender",
                                            timestamp = System.currentTimeMillis()
                                        )
                                        db.transactionDao().insertTransaction(receipt)

                                        // FIX: Disconnect immediately & Sync
                                        connectionsClient.disconnectFromEndpoint(id)
                                        SyncManager.synchronize(this@ReceiveQrActivity)

                                        runOnUiThread {
                                            Toast.makeText(this@ReceiveQrActivity, "RECEIVED ₹$amount", Toast.LENGTH_LONG).show()
                                            tvStatus.text = "Received ₹$amount. Ready for next."
                                        }
                                    }
                                }
                            }
                        }
                        override fun onPayloadTransferUpdate(id: String, u: PayloadTransferUpdate) {}
                    })
                    tvStatus.text = "Status: Connection Incoming..."
                }

                override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
                    if (result.status.isSuccess) tvStatus.text = "Status: Connected! Waiting for funds..."
                }

                override fun onDisconnected(endpointId: String) {
                    tvStatus.text = "Status: Disconnected. Visible again."
                }
            },
            options
        ).addOnSuccessListener {
            tvStatus.text = "Status: Visible to Scanners"
        }.addOnFailureListener {
            tvStatus.text = "Status: Bluetooth Error"
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        connectionsClient.stopAdvertising()
    }
}