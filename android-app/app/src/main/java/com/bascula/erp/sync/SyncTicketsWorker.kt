package com.bascula.erp.sync

import android.content.Context
import android.provider.Settings
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.bascula.erp.tickets.Ticket
import com.bascula.erp.tickets.TicketRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class SyncTicketsWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    private val ticketRepository = TicketRepository(appContext)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val pendingTickets = ticketRepository.getUnsyncedTickets()
        if (pendingTickets.isEmpty()) {
            return@withContext Result.success()
        }

        try {
            val response = postTickets(pendingTickets)
            if (response.isSuccessful) {
                ticketRepository.markSynced(response.syncedIds.ifEmpty { pendingTickets.map { it.id } })
                Result.success()
            } else {
                Result.retry()
            }
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun postTickets(tickets: List<Ticket>): SyncResponse {
        val endpoint = "${apiBaseUrl().trimEnd('/')}/api/v1/tickets/sync"
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        val payload = buildPayload(tickets).toString().toByteArray(Charsets.UTF_8)

        connection.requestMethod = "POST"
        connection.connectTimeout = 10000
        connection.readTimeout = 15000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")

        connection.outputStream.use { output ->
            output.write(payload)
            output.flush()
        }

        val code = connection.responseCode
        val body = if (code in 200..299) {
            connection.inputStream.bufferedReader().use { it.readText() }
        } else {
            connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
        }
        connection.disconnect()

        return SyncResponse(
            isSuccessful = code == HttpURLConnection.HTTP_OK || code == HttpURLConnection.HTTP_CREATED,
            syncedIds = parseSyncedIds(body)
        )
    }

    private fun buildPayload(tickets: List<Ticket>): JSONObject {
        val deviceId = Settings.Secure.getString(
            applicationContext.contentResolver,
            Settings.Secure.ANDROID_ID
        ).orEmpty()

        return JSONObject()
            .put("deviceId", deviceId)
            .put(
                "tickets",
                JSONArray().apply {
                    tickets.forEach { ticket ->
                        put(ticket.toJson())
                    }
                }
            )
    }

    private fun Ticket.toJson(): JSONObject {
        return JSONObject()
            .put("id", id)
            .put("farmerId", farmerId)
            .put("farmerName", farmerName)
            .put("agricultor", farmerName)
            .put("grossWeight", grossWeight)
            .put("tareWeight", tareWeight)
            .put("netWeight", netWeight)
            .put("qualification", qualification)
            .put("quintals", quintals)
            .put("printCount", printCount)
            .put("isLocked", isLocked)
            .put("isSynced", isSynced)
            .put("pricePerQuintal", pricePerQuintal)
            .put("grossPayable", grossPayable)
            .put("advancesDiscount", advancesDiscount)
            .put("netPayable", netPayable)
            .put("liquidatedAt", liquidatedAt)
            .put("createdAt", createdAt)
            .put("updatedAt", updatedAt)
    }

    private fun parseSyncedIds(body: String): List<String> {
        if (body.isBlank()) return emptyList()
        val json = JSONObject(body)
        val ids = json.optJSONArray("syncedIds") ?: json.optJSONArray("synced_ids") ?: return emptyList()
        return buildList {
            for (index in 0 until ids.length()) {
                add(ids.getString(index))
            }
        }
    }

    private fun apiBaseUrl(): String {
        return inputData.getString(KEY_API_BASE_URL) ?: DEFAULT_API_BASE_URL
    }

    private data class SyncResponse(
        val isSuccessful: Boolean,
        val syncedIds: List<String>
    )

    companion object {
        const val KEY_API_BASE_URL = "apiBaseUrl"
        const val DEFAULT_API_BASE_URL = "http://10.0.2.2:4000"
    }
}
