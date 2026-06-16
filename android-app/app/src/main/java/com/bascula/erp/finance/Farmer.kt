package com.bascula.erp.finance

import java.util.UUID

data class Farmer(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val cedulaRuc: String? = null,
    val phone: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
