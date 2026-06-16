package com.bascula.erp

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.bascula.erp.finance.FarmerRepository
import com.bascula.erp.finance.LiquidationRepository
import com.bascula.erp.finance.LiquidationSummary
import com.bascula.erp.printing.BluetoothPrintManager
import com.bascula.erp.printing.FailedPrint
import com.bascula.erp.printing.PrintResult
import com.bascula.erp.printing.TicketPrintFormatter
import com.bascula.erp.sync.SyncTicketsScheduler
import com.bascula.erp.tickets.Ticket
import com.bascula.erp.tickets.TicketRepository
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var printManager: BluetoothPrintManager
    private lateinit var ticketRepository: TicketRepository
    private lateinit var farmerRepository: FarmerRepository
    private lateinit var liquidationRepository: LiquidationRepository
    private var currentTicket: Ticket = Ticket()
    private var adminEditEnabled: Boolean = false

    private lateinit var farmerInput: EditText
    private lateinit var grossInput: EditText
    private lateinit var tareInput: EditText
    private lateinit var qualificationInput: EditText
    private lateinit var pricePerQuintalInput: EditText
    private lateinit var printerMacInput: EditText
    private lateinit var calculationText: TextView
    private lateinit var liquidationSummaryText: TextView
    private lateinit var statusText: TextView
    private lateinit var previewText: TextView
    private lateinit var pendingPrintsButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestBluetoothPermissions()

        ticketRepository = TicketRepository(this)
        farmerRepository = FarmerRepository(this)
        liquidationRepository = LiquidationRepository(this)
        printManager = BluetoothPrintManager(this)
        SyncTicketsScheduler.enqueuePeriodic(this)
        SyncTicketsScheduler.enqueueOneTime(this)
        currentTicket = ticketRepository.getLastTicket() ?: Ticket()

        farmerInput = EditText(this).apply {
            hint = "Agricultor"
            inputType = InputType.TYPE_CLASS_TEXT
        }
        grossInput = numericInput("Bruto kg")
        tareInput = numericInput("Tara kg")
        qualificationInput = numericInput("Calificacion")
        pricePerQuintalInput = numericInput("Precio por QQ")
        printerMacInput = EditText(this).apply {
            hint = "MAC impresora Bluetooth"
            inputType = InputType.TYPE_CLASS_TEXT
        }
        calculationText = TextView(this)
        liquidationSummaryText = TextView(this)
        statusText = TextView(this)
        previewText = TextView(this)

        val saveButton = Button(this).apply {
            text = "Guardar"
            setOnClickListener { saveAndLockTicket() }
        }
        val editButton = Button(this).apply {
            text = "Editar"
            setOnClickListener { requestAdminPinForEdit() }
        }
        val printButton = Button(this).apply {
            text = "Imprimir 58mm"
            setOnClickListener { printTicket() }
        }
        val previewLiquidationButton = Button(this).apply {
            text = "Vista previa liquidacion"
            setOnClickListener { previewLiquidation() }
        }
        val liquidateButton = Button(this).apply {
            text = "Liquidar ticket"
            setOnClickListener { processLiquidation() }
        }
        pendingPrintsButton = Button(this).apply {
            setOnClickListener { showPendingPrintsDialog() }
        }
        val newButton = Button(this).apply {
            text = "Nuevo ticket"
            setOnClickListener { startNewTicket() }
        }
        val syncButton = Button(this).apply {
            text = "Sincronizar ahora"
            setOnClickListener {
                SyncTicketsScheduler.enqueueOneTime(this@MainActivity)
                Toast.makeText(this@MainActivity, "Sincronizacion programada", Toast.LENGTH_SHORT).show()
            }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            addView(TextView(context).apply { text = "Bascula ERP - Tickets" })
            addView(farmerInput)
            addView(grossInput)
            addView(tareInput)
            addView(qualificationInput)
            addView(calculationText)
            addView(pricePerQuintalInput)
            addView(previewLiquidationButton)
            addView(liquidateButton)
            addView(liquidationSummaryText)
            addView(printerMacInput)
            addView(saveButton)
            addView(editButton)
            addView(printButton)
            addView(pendingPrintsButton)
            addView(newButton)
            addView(syncButton)
            addView(statusText)
            addView(previewText)
        }

        setContentView(layout)
        renderTicket()
    }

    private fun saveAndLockTicket() {
        runCatching {
            val ticket = ticketFromInputs(lockTicket = true)
            require(ticket.hasValidWeights()) {
                "Revise Bruto, Tara y Calificacion"
            }
            currentTicket = ticketRepository.lock(ticket)
            adminEditEnabled = false
            renderTicket()
            Toast.makeText(this, "Ticket guardado y bloqueado", Toast.LENGTH_SHORT).show()
        }.onFailure {
            showError(it.message ?: "No se pudo guardar")
        }
    }

    private fun requestAdminPinForEdit() {
        if (!currentTicket.isLocked) {
            adminEditEnabled = true
            setInputsEnabled(true)
            statusText.text = "Ticket abierto para edicion"
            return
        }

        val pinInput = EditText(this).apply {
            hint = "PIN Administrador"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }

        AlertDialog.Builder(this)
            .setTitle("Ticket bloqueado")
            .setMessage("Ingrese PIN de administrador para editar")
            .setView(pinInput)
            .setPositiveButton("Validar") { _, _ ->
                if (pinInput.text.toString() == ADMIN_PIN) {
                    adminEditEnabled = true
                    setInputsEnabled(true)
                    statusText.text = "Edicion autorizada por administrador"
                } else {
                    Toast.makeText(this, "PIN incorrecto", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun printTicket() {
        runCatching {
            val ticketToPrint = if (currentTicket.isLocked) {
                currentTicket
            } else {
                ticketRepository.lock(ticketFromInputs(lockTicket = true))
            }

            require(ticketToPrint.hasValidWeights()) {
                "Revise Bruto, Tara y Calificacion antes de imprimir"
            }

            currentTicket = ticketToPrint
            adminEditEnabled = false
            renderTicket()

            val printText = TicketPrintFormatter.buildTicketText(ticketToPrint)
            val macAddress = printerMacInput.text.toString().trim()
            require(macAddress.isNotEmpty()) {
                "Ingrese la MAC de la impresora"
            }

            thread {
                when (val result = printManager.printOrQueue(macAddress, ticketToPrint.id, printText)) {
                    PrintResult.Printed -> {
                        val updatedTicket = ticketRepository.incrementPrintCount(ticketToPrint)
                        runOnUiThread {
                            currentTicket = updatedTicket
                            adminEditEnabled = false
                            renderTicket()
                            Toast.makeText(this, "Impresion registrada", Toast.LENGTH_SHORT).show()
                        }
                    }
                    is PrintResult.Queued -> {
                        runOnUiThread {
                            renderTicket()
                            showError("Impresora sin conexion. Ticket enviado a cola #${result.failedPrint.id}")
                        }
                    }
                }
            }
        }.onFailure {
            showError(it.message ?: "No se pudo preparar la impresion")
        }
    }

    private fun previewLiquidation() {
        runCatching {
            val ticket = saveTicketBeforeLiquidation(lockTicket = false)
            val summary = liquidationRepository.previewLiquidacionTicket(ticket.id, priceFromInput())
            currentTicket = summary.ticket
            renderTicket()
            renderLiquidationSummary(summary)
        }.onFailure {
            showError(it.message ?: "No se pudo calcular la liquidacion")
        }
    }

    private fun processLiquidation() {
        runCatching {
            val ticket = saveTicketBeforeLiquidation(lockTicket = true)
            val summary = liquidationRepository.procesarLiquidacionTicket(ticket.id, priceFromInput())
            currentTicket = summary.ticket
            adminEditEnabled = false
            renderTicket()
            renderLiquidationSummary(summary)
            Toast.makeText(this, "Liquidacion procesada", Toast.LENGTH_SHORT).show()
            SyncTicketsScheduler.enqueueOneTime(this)
        }.onFailure {
            showError(it.message ?: "No se pudo liquidar el ticket")
        }
    }

    private fun showPendingPrintsDialog() {
        val pendingItems = printManager.pendingItems()
        if (pendingItems.isEmpty()) {
            Toast.makeText(this, "No hay tickets pendientes", Toast.LENGTH_SHORT).show()
            renderTicket()
            return
        }

        val labels = pendingItems.map { item ->
            "Cola #${item.id} | Ticket ${item.ticketId} | Intentos ${item.attempts}"
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle("Tickets Pendientes (${pendingItems.size})")
            .setItems(labels) { _, index ->
                retrySinglePendingPrint(pendingItems[index])
            }
            .setPositiveButton("Reenviar todos") { _, _ ->
                retryAllPendingPrints()
            }
            .setNegativeButton("Cerrar", null)
            .show()
    }

    private fun retrySinglePendingPrint(failedPrint: FailedPrint) {
        val macAddress = printerMacInput.text.toString().trim()
        if (macAddress.isEmpty()) {
            showError("Ingrese la MAC de la impresora")
            return
        }

        thread {
            val printed = printManager.retryFailedPrint(macAddress, failedPrint)
            if (printed) {
                incrementTicketPrintCount(failedPrint.ticketId)
            }
            runOnUiThread {
                renderTicket()
                if (printed) {
                    Toast.makeText(this, "Ticket pendiente reenviado", Toast.LENGTH_SHORT).show()
                } else {
                    showError("No se pudo reenviar el ticket pendiente")
                }
            }
        }
    }

    private fun retryAllPendingPrints() {
        val macAddress = printerMacInput.text.toString().trim()
        if (macAddress.isEmpty()) {
            showError("Ingrese la MAC de la impresora")
            return
        }

        thread {
            val pendingBeforeRetry = printManager.pendingItems()
            val summary = printManager.retryAll(macAddress)
            if (summary.printed > 0) {
                val remainingIds = printManager.pendingItems().map { it.id }.toSet()
                pendingBeforeRetry
                    .filterNot { remainingIds.contains(it.id) }
                    .forEach { incrementTicketPrintCount(it.ticketId) }
            }
            runOnUiThread {
                renderTicket()
                Toast.makeText(
                    this,
                    "Reenviados: ${summary.printed} | Fallidos: ${summary.failed}",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    private fun incrementTicketPrintCount(ticketId: String) {
        val ticket = ticketRepository.getTicket(ticketId) ?: return
        val updated = ticketRepository.incrementPrintCount(ticket)
        if (currentTicket.id == ticketId) {
            currentTicket = updated
        }
    }

    private fun startNewTicket() {
        currentTicket = Ticket()
        adminEditEnabled = false
        renderTicket()
        statusText.text = "Nuevo ticket sin bloquear"
    }

    private fun ticketFromInputs(lockTicket: Boolean): Ticket {
        val farmerName = farmerInput.text.toString().trim()
        val farmer = if (farmerName.isNotBlank() && farmerName != currentTicket.farmerName) {
            farmerRepository.findOrCreateByName(farmerName)
        } else if (farmerName.isNotBlank() && currentTicket.farmerId.isNullOrBlank()) {
            farmerRepository.findOrCreateByName(farmerName)
        } else {
            null
        }

        return currentTicket.copy(
            farmerId = farmer?.id ?: currentTicket.farmerId,
            farmerName = farmer?.name ?: farmerName,
            grossWeight = grossInput.text.toString().toDoubleOrNull() ?: 0.0,
            tareWeight = tareInput.text.toString().toDoubleOrNull() ?: 0.0,
            qualification = qualificationInput.text.toString().toDoubleOrNull() ?: 0.0,
            isLocked = currentTicket.isLocked || lockTicket
        )
    }

    private fun renderTicket() {
        farmerInput.setText(currentTicket.farmerName)
        grossInput.setText(numberForInput(currentTicket.grossWeight))
        tareInput.setText(numberForInput(currentTicket.tareWeight))
        qualificationInput.setText(numberForInput(currentTicket.qualification))
        pricePerQuintalInput.setText(numberForInput(currentTicket.pricePerQuintal))
        calculationText.text = buildString {
            appendLine("Neto = ${format3(currentTicket.netWeight)} kg")
            appendLine("QQ = ${format3(currentTicket.quintals)}")
        }
        statusText.text = buildString {
            append("Bloqueado: ${if (currentTicket.isLocked) "SI" else "NO"}")
            append(" | Impresiones: ${currentTicket.printCount}")
            append(" | Sync: ${if (currentTicket.isSynced) "OK" else "Pendiente"}")
        }
        previewText.text = TicketPrintFormatter.buildTicketText(currentTicket)
        pendingPrintsButton.text = "Tickets Pendientes (${printManager.pendingCount()})"
        liquidationSummaryText.text = buildString {
            appendLine("Total Bruto: ${money(currentTicket.grossPayable)}")
            appendLine("Anticipos Pendientes Encontrados: ${money(currentTicket.advancesDiscount)}")
            appendLine("Neto a Pagar en Caja: ${money(currentTicket.netPayable)}")
        }
        setInputsEnabled(!currentTicket.isLocked || adminEditEnabled)
    }

    private fun setInputsEnabled(enabled: Boolean) {
        farmerInput.isEnabled = enabled
        grossInput.isEnabled = enabled
        tareInput.isEnabled = enabled
        qualificationInput.isEnabled = enabled
    }

    private fun numericInput(hintText: String): EditText {
        return EditText(this).apply {
            hint = hintText
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
        }
    }

    private fun showError(message: String) {
        statusText.text = message
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun requestBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissions(
                arrayOf(
                    Manifest.permission.BLUETOOTH_CONNECT,
                    Manifest.permission.BLUETOOTH_SCAN
                ),
                100
            )
        }
    }

    private fun numberForInput(value: Double): String {
        return if (value == 0.0) "" else format3(value)
    }

    private fun priceFromInput(): Double {
        return pricePerQuintalInput.text.toString().toDoubleOrNull()
            ?: error("Ingrese el precio por QQ")
    }

    private fun saveTicketBeforeLiquidation(lockTicket: Boolean): Ticket {
        val ticket = ticketFromInputs(lockTicket = lockTicket)
        require(ticket.hasValidWeights()) {
            "Revise Bruto, Tara y Calificacion antes de liquidar"
        }
        require(!ticket.farmerId.isNullOrBlank()) {
            "Ingrese el agricultor antes de liquidar"
        }
        val saved = ticketRepository.save(ticket)
        currentTicket = saved
        return saved
    }

    private fun renderLiquidationSummary(summary: LiquidationSummary) {
        liquidationSummaryText.text = buildString {
            appendLine("Total Bruto: ${money(summary.grossPayable)}")
            appendLine("Anticipos Pendientes Encontrados: ${money(summary.pendingAdvancesTotal)}")
            appendLine("Descuento Anticipos: ${money(summary.advancesDiscount)}")
            appendLine("Neto a Pagar en Caja: ${money(summary.netPayable)}")
        }
    }

    private fun format3(value: Double): String {
        return String.format(java.util.Locale.US, "%.3f", value)
    }

    private fun money(value: Double): String {
        return "$" + String.format(java.util.Locale.US, "%.2f", value)
    }

    companion object {
        private const val ADMIN_PIN = "1234"
    }
}
