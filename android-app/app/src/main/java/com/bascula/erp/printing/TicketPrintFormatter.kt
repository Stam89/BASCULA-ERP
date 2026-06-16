package com.bascula.erp.printing

import com.bascula.erp.tickets.Ticket
import java.util.Locale

object TicketPrintFormatter {
    private const val LINE_WIDTH = 32
    private const val SEPARATOR = "--------------------------------"

    fun buildTicketText(ticket: Ticket): String {
        val lines = mutableListOf<String>()
        val isReprint = ticket.printCount > 0

        if (isReprint) {
            addReprintWarning(lines, ticket.printCount + 1)
        }

        lines += fitLine("PILADORA DE ARROZ")
        lines += fitLine("TICKET DE BASCULA")
        lines += SEPARATOR
        if (ticket.farmerName.isNotBlank()) {
            lines += labelValue("AGRICULTOR", ticket.farmerName)
        }
        lines += labelValue("BRUTO", kg(ticket.grossWeight))
        lines += labelValue("TARA", kg(ticket.tareWeight))
        lines += labelValue("NETO", kg(ticket.netWeight))
        lines += labelValue("CALIFICACION", number(ticket.qualification))
        lines += labelValue("QQ", number(ticket.quintals))
        if (ticket.pricePerQuintal > 0.0 || ticket.grossPayable > 0.0) {
            lines += SEPARATOR
            lines += fitLine("LIQUIDACION")
            lines += labelValue("PRECIO QQ", money(ticket.pricePerQuintal))
            lines += labelValue("TOTAL BRUTO", money(ticket.grossPayable))
            lines += labelValue("ANTICIPOS", money(ticket.advancesDiscount))
            lines += labelValue("NETO PAGADO", money(ticket.netPayable))
        }
        lines += SEPARATOR
        lines += fitLine("FIRMA: __________________")

        if (isReprint) {
            addReprintWarning(lines, ticket.printCount + 1)
        }

        return lines.joinToString(separator = "\n", postfix = "\n")
    }

    private fun addReprintWarning(lines: MutableList<String>, reprintNumber: Int) {
        lines += SEPARATOR
        lines += fitLine("* REIMPRESION N\u00B0 $reprintNumber *")
        lines += SEPARATOR
    }

    private fun labelValue(label: String, value: String): String {
        val prefix = "$label: "
        val available = (LINE_WIDTH - prefix.length).coerceAtLeast(0)
        return fitLine(prefix + value.take(available))
    }

    private fun kg(value: Double): String {
        return "${number(value)} KG"
    }

    private fun money(value: Double): String {
        return "$" + String.format(Locale.US, "%.2f", value)
    }

    private fun number(value: Double): String {
        return String.format(Locale.US, "%.3f", value)
    }

    private fun fitLine(value: String): String {
        return value.replace("\t", " ").replace("\r", "").replace("\n", " ").take(LINE_WIDTH)
    }
}
