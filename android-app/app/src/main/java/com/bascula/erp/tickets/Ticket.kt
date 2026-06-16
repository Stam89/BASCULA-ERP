package com.bascula.erp.tickets

import kotlin.math.round
import java.util.UUID

data class Ticket(
    val id: String = UUID.randomUUID().toString(),
    val farmerId: String? = null,
    val farmerName: String = "",
    val grossWeight: Double = 0.0,
    val tareWeight: Double = 0.0,
    val qualification: Double = 0.0,
    val isLocked: Boolean = false,
    val printCount: Int = 0,
    val isSynced: Boolean = false,
    val pricePerQuintal: Double = 0.0,
    val grossPayable: Double = 0.0,
    val advancesDiscount: Double = 0.0,
    val netPayable: Double = 0.0,
    val liquidatedAt: Long? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    val netWeight: Double
        get() = round3(grossWeight - tareWeight)

    val quintals: Double
        get() = if (qualification > 0.0) {
            round3((netWeight * 2.2) / qualification)
        } else {
            0.0
        }

    fun hasValidWeights(): Boolean {
        return grossWeight >= 0.0 && tareWeight >= 0.0 && qualification > 0.0 && netWeight >= 0.0
    }

    private fun round3(value: Double): Double {
        return round(value * 1000.0) / 1000.0
    }
}
