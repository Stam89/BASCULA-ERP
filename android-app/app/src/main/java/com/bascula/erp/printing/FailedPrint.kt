package com.bascula.erp.printing

data class FailedPrint(
    val id: Long = 0,
    val ticketId: String,
    val plainText: String,
    val attempts: Int = 0,
    val lastError: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
