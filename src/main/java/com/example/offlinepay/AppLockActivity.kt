package com.example.offlinepay

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.Executor

class AppLockActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // No setContentView needed; we show the system prompt immediately over a blank screen

        checkLoginAndAuthenticate()
    }

    private fun checkLoginAndAuthenticate() {
        val db = AppDatabase.getDatabase(this)

        CoroutineScope(Dispatchers.Main).launch {
            // 1. Check if user is actually logged in
            val user = withContext(Dispatchers.IO) {
                db.userDao().getUser()
            }

            if (user == null) {
                // Not logged in? Go to Register/Login Screen
                startActivity(Intent(this@AppLockActivity, RegisterActivity::class.java))
                finish()
            } else {
                // Logged in? Trigger Device Security
                showDeviceSecurityPrompt()
            }
        }
    }

    private fun showDeviceSecurityPrompt() {
        val executor: Executor = ContextCompat.getMainExecutor(this)

        val biometricPrompt = BiometricPrompt(this, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    // SUCCESS: Unlock the App
                    Toast.makeText(applicationContext, "Authenticated", Toast.LENGTH_SHORT).show()
                    startActivity(Intent(this@AppLockActivity, MainActivity::class.java))
                    finish()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    // If user cancels or fails too many times, close the app
                    if (errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                        finish()
                    }
                }
            })

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock OfflinePay")
            .setSubtitle("Use your device PIN, Pattern, or Fingerprint")
            // This allows Pattern/PIN if Fingerprint is not set
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            .build()

        biometricPrompt.authenticate(promptInfo)
    }
}