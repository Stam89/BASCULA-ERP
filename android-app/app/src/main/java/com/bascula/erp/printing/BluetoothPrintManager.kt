package com.bascula.erp.printing

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import java.io.IOException
import java.util.UUID

class BluetoothPrintManager(
    context: Context,
    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter(),
    private val queueRepository: PrintQueueRepository = PrintQueueRepository(context)
) {
    private val serialPortProfile: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private var socket: BluetoothSocket? = null
    private var connectedMacAddress: String? = null

    @SuppressLint("MissingPermission")
    fun pairedPrinters(): List<BluetoothDevice> {
        return bluetoothAdapter?.bondedDevices
            ?.filter { device ->
                device.name?.contains("print", ignoreCase = true) == true ||
                    device.name?.contains("pos", ignoreCase = true) == true
            }
            ?.sortedBy { it.name }
            ?: emptyList()
    }

    fun printOrQueue(macAddress: String, ticketId: String, plainText: String): PrintResult {
        return try {
            val connected = ensureConnected(macAddress)
            if (!connected) {
                val queued = queueRepository.enqueue(ticketId, plainText, "No se pudo reconectar Bluetooth")
                return PrintResult.Queued(queued)
            }

            writeSafely(plainText)
            PrintResult.Printed
        } catch (error: Exception) {
            closeConnection()
            val queued = queueRepository.enqueue(ticketId, plainText, error.message)
            PrintResult.Queued(queued)
        }
    }

    fun retryFailedPrint(macAddress: String, failedPrint: FailedPrint): Boolean {
        return try {
            if (!ensureConnected(macAddress)) {
                queueRepository.markAttempt(failedPrint.id, "No se pudo reconectar Bluetooth")
                return false
            }

            writeSafely(failedPrint.plainText)
            queueRepository.remove(failedPrint.id)
            true
        } catch (error: Exception) {
            closeConnection()
            queueRepository.markAttempt(failedPrint.id, error.message)
            false
        }
    }

    fun retryAll(macAddress: String): RetrySummary {
        var printed = 0
        var failed = 0

        queueRepository.listPending().forEach { item ->
            if (retryFailedPrint(macAddress, item)) {
                printed += 1
            } else {
                failed += 1
            }
        }

        return RetrySummary(printed = printed, failed = failed)
    }

    fun pendingCount(): Int {
        return queueRepository.pendingCount()
    }

    fun pendingItems(): List<FailedPrint> {
        return queueRepository.listPending()
    }

    @SuppressLint("MissingPermission")
    private fun ensureConnected(macAddress: String): Boolean {
        val currentSocket = socket
        if (currentSocket?.isConnected == true && connectedMacAddress == macAddress) {
            return true
        }

        closeConnection()

        repeat(RECONNECT_ATTEMPTS) { attempt ->
            try {
                connect(macAddress)
                if (socket?.isConnected == true) {
                    return true
                }
            } catch (_: Exception) {
                closeConnection()
                if (attempt < RECONNECT_ATTEMPTS - 1) {
                    Thread.sleep(RECONNECT_DELAY_MS)
                }
            }
        }

        return false
    }

    @SuppressLint("MissingPermission")
    private fun connect(macAddress: String) {
        val adapter = bluetoothAdapter ?: throw IOException("Bluetooth no disponible")
        val device = adapter.getRemoteDevice(macAddress)
        val newSocket = device.createRfcommSocketToServiceRecord(serialPortProfile)
        adapter.cancelDiscovery()
        newSocket.connect()
        socket = newSocket
        connectedMacAddress = macAddress
    }

    private fun writeSafely(plainText: String) {
        val currentSocket = socket
        if (currentSocket?.isConnected != true) {
            throw IOException("Socket Bluetooth desconectado")
        }

        val bytes = EscPos58mmFormatter().formatText(plainText.ensurePrinterEnding())
        val output = currentSocket.outputStream
        var offset = 0

        while (offset < bytes.size) {
            val size = minOf(WRITE_CHUNK_SIZE, bytes.size - offset)
            output.write(bytes, offset, size)
            output.flush()
            offset += size
            Thread.sleep(WRITE_CHUNK_DELAY_MS)
        }

        output.flush()
    }

    private fun String.ensurePrinterEnding(): String {
        val normalized = replace("\r\n", "\n").replace("\r", "\n")
        return normalized.trimEnd('\n') + "\n\n\n"
    }

    private fun closeConnection() {
        runCatching { socket?.close() }
        socket = null
        connectedMacAddress = null
    }

    companion object {
        private const val RECONNECT_ATTEMPTS = 3
        private const val RECONNECT_DELAY_MS = 1000L
        private const val WRITE_CHUNK_SIZE = 64
        private const val WRITE_CHUNK_DELAY_MS = 20L
    }
}

sealed class PrintResult {
    object Printed : PrintResult()
    data class Queued(val failedPrint: FailedPrint) : PrintResult()
}

data class RetrySummary(
    val printed: Int,
    val failed: Int
)
