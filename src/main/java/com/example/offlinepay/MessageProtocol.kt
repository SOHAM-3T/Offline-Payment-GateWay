package com.example.offlinepay

import java.util.UUID

object MessageProtocol {
    // MESSAGE TYPES
    const val TYPE_PAYMENT = "PAY"
    const val TYPE_CANCEL_REQ = "CANCEL_REQ"
    const val TYPE_CANCEL_ACK = "CANCEL_ACK"

    // 1. CREATE SECURE PAYLOAD (Implements SET Concept: Dual Details)
    fun createPaymentPayload(senderId: String, receiverId: String, amount: Double): String {
        val uuid = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        // Format: PAY|AMOUNT|SENDER|RECEIVER|TIMESTAMP|UUID
        val raw = "$TYPE_PAYMENT|$amount|$senderId|$receiverId|$timestamp|$uuid"
        return SecurityHelper.encrypt(raw)
    }

    // 2. PARSE PAYLOAD
    fun parse(encryptedData: String): List<String> {
        val decrypted = SecurityHelper.decrypt(encryptedData)
        return decrypted.split("|")
    }
}