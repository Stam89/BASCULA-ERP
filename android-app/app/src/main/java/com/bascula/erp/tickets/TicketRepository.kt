package com.bascula.erp.tickets

import android.content.ContentValues
import android.content.Context
import android.database.Cursor

class TicketRepository(context: Context) {
    private val dbHelper = TicketDatabaseHelper(context.applicationContext)

    fun getLastTicket(): Ticket? {
        val db = dbHelper.readableDatabase
        val cursor = db.rawQuery("SELECT * FROM tickets ORDER BY created_at DESC LIMIT 1", null)
        return cursor.use {
            if (it.moveToFirst()) {
                it.toTicket()
            } else {
                null
            }
        }
    }

    fun save(ticket: Ticket): Ticket {
        val db = dbHelper.writableDatabase
        val now = System.currentTimeMillis()
        val values = ContentValues().apply {
            put("id", ticket.id)
            put("farmer_id", ticket.farmerId)
            put("farmer_name", ticket.farmerName.trim())
            put("gross_weight", ticket.grossWeight)
            put("tare_weight", ticket.tareWeight)
            put("qualification", ticket.qualification)
            put("is_locked", if (ticket.isLocked) 1 else 0)
            put("print_count", ticket.printCount)
            put("is_synced", 0)
            put("price_per_quintal", ticket.pricePerQuintal)
            put("gross_payable", ticket.grossPayable)
            put("advances_discount", ticket.advancesDiscount)
            put("net_payable", ticket.netPayable)
            put("liquidated_at", ticket.liquidatedAt)
            put("updated_at", now)
        }

        return if (!ticketExists(ticket.id)) {
            values.put("created_at", now)
            db.insertOrThrow("tickets", null, values)
            ticket.copy(isSynced = false, createdAt = now, updatedAt = now)
        } else {
            db.update("tickets", values, "id = ?", arrayOf(ticket.id.toString()))
            ticket.copy(isSynced = false, updatedAt = now)
        }
    }

    fun lock(ticket: Ticket): Ticket {
        return save(ticket.copy(isLocked = true))
    }

    fun incrementPrintCount(ticket: Ticket): Ticket {
        require(ticket.id.isNotBlank()) { "El ticket debe tener UUID antes de imprimir" }

        val db = dbHelper.writableDatabase
        db.execSQL(
            """
            UPDATE tickets
            SET print_count = print_count + 1,
                is_locked = 1,
                is_synced = 0,
                updated_at = ?
            WHERE id = ?
            """.trimIndent(),
            arrayOf(System.currentTimeMillis(), ticket.id)
        )

        return getTicket(ticket.id) ?: ticket.copy(
            isLocked = true,
            printCount = ticket.printCount + 1,
            updatedAt = System.currentTimeMillis()
        )
    }

    fun getTicket(id: String): Ticket? {
        val db = dbHelper.readableDatabase
        val cursor = db.rawQuery("SELECT * FROM tickets WHERE id = ?", arrayOf(id))
        return cursor.use {
            if (it.moveToFirst()) {
                it.toTicket()
            } else {
                null
            }
        }
    }

    fun getUnsyncedTickets(): List<Ticket> {
        val cursor = dbHelper.readableDatabase.rawQuery(
            "SELECT * FROM tickets WHERE is_synced = 0 ORDER BY updated_at ASC",
            null
        )
        return cursor.use {
            val rows = mutableListOf<Ticket>()
            while (it.moveToNext()) {
                rows += it.toTicket()
            }
            rows
        }
    }

    fun markSynced(ids: List<String>) {
        if (ids.isEmpty()) return

        val db = dbHelper.writableDatabase
        db.beginTransaction()
        try {
            ids.forEach { id ->
                val values = ContentValues().apply {
                    put("is_synced", 1)
                }
                db.update("tickets", values, "id = ?", arrayOf(id))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun ticketExists(id: String): Boolean {
        val cursor = dbHelper.readableDatabase.rawQuery(
            "SELECT id FROM tickets WHERE id = ? LIMIT 1",
            arrayOf(id)
        )
        return cursor.use { it.moveToFirst() }
    }

    private fun Cursor.toTicket(): Ticket {
        return Ticket(
            id = getString(getColumnIndexOrThrow("id")),
            farmerId = getStringOrNull("farmer_id"),
            farmerName = getString(getColumnIndexOrThrow("farmer_name")),
            grossWeight = getDouble(getColumnIndexOrThrow("gross_weight")),
            tareWeight = getDouble(getColumnIndexOrThrow("tare_weight")),
            qualification = getDouble(getColumnIndexOrThrow("qualification")),
            isLocked = getInt(getColumnIndexOrThrow("is_locked")) == 1,
            printCount = getInt(getColumnIndexOrThrow("print_count")),
            isSynced = getInt(getColumnIndexOrThrow("is_synced")) == 1,
            pricePerQuintal = getDouble(getColumnIndexOrThrow("price_per_quintal")),
            grossPayable = getDouble(getColumnIndexOrThrow("gross_payable")),
            advancesDiscount = getDouble(getColumnIndexOrThrow("advances_discount")),
            netPayable = getDouble(getColumnIndexOrThrow("net_payable")),
            liquidatedAt = getLongOrNull("liquidated_at"),
            createdAt = getLong(getColumnIndexOrThrow("created_at")),
            updatedAt = getLong(getColumnIndexOrThrow("updated_at"))
        )
    }

    private fun Cursor.getStringOrNull(column: String): String? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getString(index)
    }

    private fun Cursor.getLongOrNull(column: String): Long? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getLong(index)
    }
}
