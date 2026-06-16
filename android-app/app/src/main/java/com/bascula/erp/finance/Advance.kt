package com.bascula.erp.finance

import java.util.UUID

data class Advance(
    val id: String = UUID.randomUUID().toString(),
    val farmerId: String,
    val amount: Double,
    val pendingBalance: Double = amount,
    val date: Long = System.currentTimeMillis(),
    val status: String = STATUS_PENDING,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    companion object {
        const val STATUS_PENDING = "pendiente"
        const val STATUS_APPLIED = "aplicado"
        const val STATUS_CANCELLED = "anulado"
    }
}
