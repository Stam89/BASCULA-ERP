package com.bascula.erp.finance

import com.bascula.erp.tickets.Ticket

data class LiquidationSummary(
    val ticket: Ticket,
    val pendingAdvancesTotal: Double,
    val advancesDiscount: Double,
    val grossPayable: Double,
    val netPayable: Double
)
