package com.example.offlinepay

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions

class ScanQrActivity : AppCompatActivity() {

    // Simple QR Scanner Launcher
    private val barcodeLauncher = registerForActivityResult(ScanContract()) { result: ScanIntentResult ->
        if (result.contents == null) {
            Toast.makeText(this, "Cancelled", Toast.LENGTH_LONG).show()
            finish()
        } else {
            // SUCCESS: We got the ID!
            val scannedId = result.contents

            // Open ContactPaymentActivity with this ID pre-filled
            val intent = Intent(this, ContactPaymentActivity::class.java)
            intent.putExtra("TARGET_ID", scannedId)
            startActivity(intent)
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Immediately launch scanner
        val options = ScanOptions()
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        options.setPrompt("Scan Receiver's QR Code")
        options.setCameraId(0) // Back Camera
        options.setBeepEnabled(true)
        options.setBarcodeImageEnabled(false)

        // NEW: Force the Portrait Activity we just created
        options.setCaptureActivity(PortraitCaptureActivity::class.java)
        options.setOrientationLocked(true) // Lock to portrait

        barcodeLauncher.launch(options)
    }
}