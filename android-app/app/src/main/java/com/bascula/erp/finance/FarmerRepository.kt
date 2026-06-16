package com.bascula.erp.finance

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import com.bascula.erp.tickets.TicketDatabaseHelper

class FarmerRepository(context: Context) {
    private val dbHelper = TicketDatabaseHelper(context.applicationContext)

    fun findOrCreateByName(name: String): Farmer? {
        val cleanName = name.trim()
        if (cleanName.isBlank()) return null

        findByName(cleanName)?.let { return it }

        val now = System.currentTimeMillis()
        val farmer = Farmer(name = cleanName, createdAt = now, updatedAt = now)
        val values = ContentValues().apply {
            put("id", farmer.id)
            put("nombre", farmer.name)
            put("cedula_ruc", farmer.cedulaRuc)
            put("telefono", farmer.phone)
            put("created_at", farmer.createdAt)
            put("updated_at", farmer.updatedAt)
        }
        dbHelper.writableDatabase.insertOrThrow("agricultores", null, values)
        return farmer
    }

    fun getById(id: String): Farmer? {
        val cursor = dbHelper.readableDatabase.rawQuery(
            "SELECT * FROM agricultores WHERE id = ?",
            arrayOf(id)
        )
        return cursor.use {
            if (it.moveToFirst()) it.toFarmer() else null
        }
    }

    private fun findByName(name: String): Farmer? {
        val cursor = dbHelper.readableDatabase.rawQuery(
            "SELECT * FROM agricultores WHERE lower(nombre) = lower(?) LIMIT 1",
            arrayOf(name)
        )
        return cursor.use {
            if (it.moveToFirst()) it.toFarmer() else null
        }
    }

    private fun Cursor.toFarmer(): Farmer {
        return Farmer(
            id = getString(getColumnIndexOrThrow("id")),
            name = getString(getColumnIndexOrThrow("nombre")),
            cedulaRuc = getStringOrNull("cedula_ruc"),
            phone = getStringOrNull("telefono"),
            createdAt = getLong(getColumnIndexOrThrow("created_at")),
            updatedAt = getLong(getColumnIndexOrThrow("updated_at"))
        )
    }

    private fun Cursor.getStringOrNull(column: String): String? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getString(index)
    }
}
