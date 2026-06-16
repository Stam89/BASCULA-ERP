package com.bascula.erp.finance

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import com.bascula.erp.tickets.TicketDatabaseHelper

class AdvanceRepository(context: Context) {
    private val dbHelper = TicketDatabaseHelper(context.applicationContext)

    fun saveAdvance(advance: Advance): Advance {
        require(advance.amount > 0.0) { "El anticipo debe ser mayor que cero" }
        val now = System.currentTimeMillis()
        val values = ContentValues().apply {
            put("id", advance.id)
            put("agricultor_id", advance.farmerId)
            put("monto", advance.amount)
            put("saldo_pendiente", advance.pendingBalance)
            put("fecha", advance.date)
            put("estado", advance.status)
            put("created_at", advance.createdAt)
            put("updated_at", now)
        }

        val db = dbHelper.writableDatabase
        if (exists(advance.id)) {
            db.update("anticipos", values, "id = ?", arrayOf(advance.id))
        } else {
            db.insertOrThrow("anticipos", null, values)
        }

        return advance.copy(updatedAt = now)
    }

    fun pendingByFarmer(farmerId: String): List<Advance> {
        val cursor = dbHelper.readableDatabase.rawQuery(
            """
            SELECT * FROM anticipos
            WHERE agricultor_id = ? AND estado = ? AND saldo_pendiente > 0
            ORDER BY fecha ASC
            """.trimIndent(),
            arrayOf(farmerId, Advance.STATUS_PENDING)
        )
        return cursor.use {
            val rows = mutableListOf<Advance>()
            while (it.moveToNext()) {
                rows += it.toAdvance()
            }
            rows
        }
    }

    private fun exists(id: String): Boolean {
        val cursor = dbHelper.readableDatabase.rawQuery(
            "SELECT id FROM anticipos WHERE id = ? LIMIT 1",
            arrayOf(id)
        )
        return cursor.use { it.moveToFirst() }
    }

    private fun Cursor.toAdvance(): Advance {
        return Advance(
            id = getString(getColumnIndexOrThrow("id")),
            farmerId = getString(getColumnIndexOrThrow("agricultor_id")),
            amount = getDouble(getColumnIndexOrThrow("monto")),
            pendingBalance = getDouble(getColumnIndexOrThrow("saldo_pendiente")),
            date = getLong(getColumnIndexOrThrow("fecha")),
            status = getString(getColumnIndexOrThrow("estado")),
            createdAt = getLong(getColumnIndexOrThrow("created_at")),
            updatedAt = getLong(getColumnIndexOrThrow("updated_at"))
        )
    }
}
