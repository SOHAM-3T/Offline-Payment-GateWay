package com.example.offlinepay

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

object SyncManager {

    // Helper: Check Internet
    fun isNetworkAvailable(context: Context): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivityManager.activeNetwork ?: return false
        val activeNetwork = connectivityManager.getNetworkCapabilities(network) ?: return false
        return activeNetwork.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                activeNetwork.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
    }

    // Main Sync Logic
    fun synchronize(context: Context) {
        if (!isNetworkAvailable(context)) {
            Log.d("SyncManager", "No Internet. Sync Skipped.")
            return
        }

        val dbLocal = AppDatabase.getDatabase(context)
        val dbOnline = FirebaseFirestore.getInstance()

        CoroutineScope(Dispatchers.IO).launch {
            // 1. Get Local Truth (Offline Balance is King)
            val localUser = dbLocal.userDao().getUser() ?: return@launch

            try {
                // 2. Force Cloud to match Local Offline Balance
                // We do not READ cloud first, we WRITE to it because the phone knows what was just spent.
                dbOnline.collection("users").document(localUser.accountNumber)
                    .update("offlineBalance", localUser.offlineBalance)
                    .await()

                Log.d("SyncManager", "Sync Success! Cloud updated to ${localUser.offlineBalance}")

            } catch (e: Exception) {
                e.printStackTrace()
                Log.e("SyncManager", "Sync Failed: ${e.message}")
            }
        }
    }
}