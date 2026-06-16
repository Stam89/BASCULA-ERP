package com.bascula.erp.printing

data class PrintDocument(
    val documentType: String,
    val lines: List<String>
)
