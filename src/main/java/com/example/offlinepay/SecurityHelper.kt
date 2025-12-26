package com.example.offlinepay

import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

object SecurityHelper {
    // In a real app, store this safely in Android Keystore.
    private const val SECRET_KEY = "1234567890123456" // Fixed 16-digit key for prototype

    fun encrypt(data: String): String {
        try {
            val key = SecretKeySpec(SECRET_KEY.toByteArray(), "AES")
            val cipher = Cipher.getInstance("AES")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val encryptedBytes = cipher.doFinal(data.toByteArray())
            return Base64.encodeToString(encryptedBytes, Base64.DEFAULT)
        } catch (e: Exception) {
            e.printStackTrace()
            return ""
        }
    }

    fun decrypt(data: String): String {
        try {
            val key = SecretKeySpec(SECRET_KEY.toByteArray(), "AES")
            val cipher = Cipher.getInstance("AES")
            cipher.init(Cipher.DECRYPT_MODE, key)
            val decodedBytes = Base64.decode(data, Base64.DEFAULT)
            return String(cipher.doFinal(decodedBytes))
        } catch (e: Exception) {
            e.printStackTrace()
            return ""
        }
    }
}