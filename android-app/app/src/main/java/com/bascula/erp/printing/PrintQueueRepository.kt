package com.bascula.erp.printing

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import com.bascula.erp.tickets.TicketDatabaseHelper

class PrintQueueRepository(context: Context) {
    private val dbHelper = TicketDatabaseHelper(context.applicationContext)

    fun enqueue(ticketId: String, plainText: String, error: String?): FailedPrint {
        val now = System.currentTimeMillis()
        val values = ContentValues().apply {
            put("ticket_id", ticketId)
            put("plain_text", plainText)
            put("attempts", 0)
            put("last_error", error)
            put("created_at", now)
            put("updated_at", now)
        }

        val id = dbHelper.writableDatabase.insertOrThrow("failed_prints", null, values)
        return FailedPrint(
            id = id,
            ticketId = ticketId,
            plainText = plainText,
            lastError = error,
            createdAt = now,
            updatedAt = now
        )
    }

    fun pendingCount(): Int {
        val cursor = dbHelper.readableDatabase.rawQuery(
            "SELECT COUNT(*) AS total FROM failed_prints",
            null
        )
        return cursor.use {
            if (it.moveToFirst()) it.getInt(it.getColumnIndexOrThrow("total")) else 0
        }
    }

    fun listPending(): List<FailedPrint> {
        val cursor = dbHelper.readableDatabase.rawQuery(
            "SELECT * FROM failed_prints ORDER BY created_at ASC",
            null
        )
        return cursor.use {
            val rows = mutableListOf<FailedPrint>()
            while (it.moveToNext()) {
                rows += it.toFailedPrint()
            }
            rows
        }
    }

    fun markAttempt(id: Long, error: String?) {
        val values = ContentValues().apply {
            put("attempts", getAttempts(id) + 1)
            put("last_error", error)
            put("updated_at", System.currentTimeMillis())
        }
        dbHelper.writableDatabase.update("failed_prints", values, "id = ?", arrayOf(id.toString()))
    }

    fun remove(id: Long) {
        dbHelper.writableDatabase.delete("failed_prints", "id = ?", arrayOf(id.toString()))
    }

    private fun getAttempts(id: Long): Int {
        val cursor = dbHelper.readableDatabase.rawQuery(
            "SELECT attempts FROM failed_prints WHERE id = ?",
            arrayOf(id.toString())
        )
        return cursor.use {
            if (it.moveToFirst()) it.getInt(it.getColumnIndexOrThrow("attempts")) else 0
        }
    }

    private fun Cursor.toFailedPrint(): FailedPrint {
        return FailedPrint(
            id = getLong(getColumnIndexOrThrow("id")),
            ticketId = getString(getColumnIndexOrThrow("ticket_id")),
            plainText = getString(getColumnIndexOrThrow("plain_text")),
            attempts = getInt(getColumnIndexOrThrow("attempts")),
            lastError = getString(getColumnIndexOrThrow("last_error")),
            createdAt = getLong(getColumnIndexOrThrow("created_at")),
            updatedAt = getLong(getColumnIndexOrThrow("updated_at"))
        )
    }
}
