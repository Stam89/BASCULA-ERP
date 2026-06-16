package com.bascula.erp.finance

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.bascula.erp.tickets.Ticket
import com.bascula.erp.tickets.TicketDatabaseHelper
import com.bascula.erp.tickets.TicketRepository
import java.util.UUID
import kotlin.math.min
import kotlin.math.round

class LiquidationRepository(context: Context) {
    private val dbHelper = TicketDatabaseHelper(context.applicationContext)
    private val ticketRepository = TicketRepository(context.applicationContext)

    fun previewLiquidacionTicket(ticketId: String, precioQQ: Double): LiquidationSummary {
        require(precioQQ >= 0.0) { "El precio por QQ no puede ser negativo" }
        val ticket = ticketRepository.getTicket(ticketId) ?: error("Ticket no encontrado")
        require(!ticket.farmerId.isNullOrBlank()) { "Seleccione un agricultor antes de liquidar" }
        require(ticket.quintals > 0.0) { "El ticket debe tener QQ calculados" }

        val totalBruto = round2(ticket.quintals * precioQQ)
        val totalAnticipos = round2(sumPendingAdvances(ticket.farmerId))
        val descuento = min(totalBruto, totalAnticipos).rounded2()
        val neto = (totalBruto - descuento).rounded2()

        return LiquidationSummary(
            ticket = ticket.copy(
                pricePerQuintal = precioQQ,
                grossPayable = totalBruto,
                advancesDiscount = descuento,
                netPayable = neto
            ),
            pendingAdvancesTotal = totalAnticipos,
            advancesDiscount = descuento,
            grossPayable = totalBruto,
            netPayable = neto
        )
    }

    fun procesarLiquidacionTicket(ticketId: String, precioQQ: Double): LiquidationSummary {
        require(precioQQ >= 0.0) { "El precio por QQ no puede ser negativo" }
        val db = dbHelper.writableDatabase
        db.beginTransaction()
        try {
            val ticket = getTicketForUpdate(db, ticketId) ?: error("Ticket no encontrado")
            val farmerId = ticket.farmerId ?: error("Seleccione un agricultor antes de liquidar")
            require(ticket.quintals > 0.0) { "El ticket debe tener QQ calculados" }

            val totalBruto = round2(ticket.quintals * precioQQ)
            val totalAnticiposPendientes = round2(sumPendingAdvances(db, farmerId))
            val descuentoAnticipos = min(totalBruto, totalAnticiposPendientes).rounded2()
            val netoEntregar = (totalBruto - descuentoAnticipos).rounded2()

            applyAdvances(db, farmerId, ticketId, descuentoAnticipos)

            val liquidatedAt = System.currentTimeMillis()
            updateTicketFinancials(
                db = db,
                ticketId = ticketId,
                precioQQ = precioQQ,
                totalBruto = totalBruto,
                descuentoAnticipos = descuentoAnticipos,
                netoEntregar = netoEntregar,
                liquidatedAt = liquidatedAt
            )
            insertCashMovement(db, ticketId, netoEntregar, liquidatedAt)

            db.setTransactionSuccessful()
            val updatedTicket = ticket.copy(
                isLocked = true,
                isSynced = false,
                pricePerQuintal = precioQQ,
                grossPayable = totalBruto,
                advancesDiscount = descuentoAnticipos,
                netPayable = netoEntregar,
                liquidatedAt = liquidatedAt,
                updatedAt = liquidatedAt
            )
            return LiquidationSummary(
                ticket = updatedTicket,
                pendingAdvancesTotal = totalAnticiposPendientes,
                advancesDiscount = descuentoAnticipos,
                grossPayable = totalBruto,
                netPayable = netoEntregar
            )
        } finally {
            db.endTransaction()
        }
    }

    private fun applyAdvances(
        db: SQLiteDatabase,
        farmerId: String,
        ticketId: String,
        maxDiscount: Double
    ) {
        var remaining = maxDiscount
        val cursor = db.rawQuery(
            """
            SELECT * FROM anticipos
            WHERE agricultor_id = ? AND estado = ? AND saldo_pendiente > 0
            ORDER BY fecha ASC
            """.trimIndent(),
            arrayOf(farmerId, Advance.STATUS_PENDING)
        )

        cursor.use {
            while (it.moveToNext() && remaining > 0.0) {
                val advanceId = it.getString(it.getColumnIndexOrThrow("id"))
                val balance = it.getDouble(it.getColumnIndexOrThrow("saldo_pendiente"))
                val applied = min(balance, remaining).rounded2()
                val newBalance = (balance - applied).rounded2()
                val newStatus = if (newBalance <= 0.0) Advance.STATUS_APPLIED else Advance.STATUS_PENDING
                val now = System.currentTimeMillis()

                val values = ContentValues().apply {
                    put("saldo_pendiente", newBalance)
                    put("estado", newStatus)
                    put("updated_at", now)
                }
                db.update("anticipos", values, "id = ?", arrayOf(advanceId))
                insertAdvanceApplication(db, advanceId, ticketId, applied, now)
                remaining = (remaining - applied).rounded2()
            }
        }
    }

    private fun insertAdvanceApplication(
        db: SQLiteDatabase,
        advanceId: String,
        ticketId: String,
        applied: Double,
        now: Long
    ) {
        val values = ContentValues().apply {
            put("id", UUID.randomUUID().toString())
            put("anticipo_id", advanceId)
            put("ticket_id", ticketId)
            put("monto_aplicado", applied)
            put("fecha", now)
        }
        db.insertOrThrow("anticipo_aplicaciones", null, values)
    }

    private fun updateTicketFinancials(
        db: SQLiteDatabase,
        ticketId: String,
        precioQQ: Double,
        totalBruto: Double,
        descuentoAnticipos: Double,
        netoEntregar: Double,
        liquidatedAt: Long
    ) {
        val values = ContentValues().apply {
            put("price_per_quintal", precioQQ)
            put("gross_payable", totalBruto)
            put("advances_discount", descuentoAnticipos)
            put("net_payable", netoEntregar)
            put("liquidated_at", liquidatedAt)
            put("is_locked", 1)
            put("is_synced", 0)
            put("updated_at", liquidatedAt)
        }
        db.update("tickets", values, "id = ?", arrayOf(ticketId))
    }

    private fun insertCashMovement(db: SQLiteDatabase, ticketId: String, amount: Double, now: Long) {
        if (amount <= 0.0) return

        val values = ContentValues().apply {
            put("id", UUID.randomUUID().toString())
            put("ticket_id", ticketId)
            put("tipo", "egreso")
            put("categoria", "liquidacion_ticket")
            put("monto", amount)
            put("descripcion", "Neto pagado por liquidacion de ticket")
            put("fecha", now)
        }
        db.insertOrThrow("movimientos_caja", null, values)
    }

    private fun getTicketForUpdate(db: SQLiteDatabase, ticketId: String): Ticket? {
        val cursor = db.rawQuery("SELECT * FROM tickets WHERE id = ?", arrayOf(ticketId))
        return cursor.use {
            if (it.moveToFirst()) it.toTicket() else null
        }
    }

    private fun sumPendingAdvances(farmerId: String): Double {
        return sumPendingAdvances(dbHelper.readableDatabase, farmerId)
    }

    private fun sumPendingAdvances(db: SQLiteDatabase, farmerId: String): Double {
        val cursor = db.rawQuery(
            """
            SELECT COALESCE(SUM(saldo_pendiente), 0) AS total
            FROM anticipos
            WHERE agricultor_id = ? AND estado = ? AND saldo_pendiente > 0
            """.trimIndent(),
            arrayOf(farmerId, Advance.STATUS_PENDING)
        )
        return cursor.use {
            if (it.moveToFirst()) it.getDouble(it.getColumnIndexOrThrow("total")).rounded2() else 0.0
        }
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

    private fun Double.rounded2(): Double = round2(this)

    private fun round2(value: Double): Double {
        return round(value * 100.0) / 100.0
    }
}
