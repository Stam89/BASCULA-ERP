package com.bascula.erp.printing

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Context
import java.util.UUID

class BluetoothThermalPrinter(
    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
) {
    private val serialPortProfile: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    @SuppressLint("MissingPermission")
    fun pairedPrinters(): List<BluetoothDevice> {
        return bluetoothAdapter?.bondedDevices
            ?.filter { it.name?.contains("print", ignoreCase = true) == true || it.name?.contains("pos", ignoreCase = true) == true }
            ?.sortedBy { it.name }
            ?: emptyList()
    }

    @SuppressLint("MissingPermission")
    fun print(macAddress: String, document: PrintDocument) {
        printBytes(macAddress, EscPos58mmFormatter().format(document))
    }

    @SuppressLint("MissingPermission")
    fun printText(macAddress: String, text: String) {
        printBytes(macAddress, EscPos58mmFormatter().formatText(text))
    }

    @SuppressLint("MissingPermission")
    private fun printBytes(macAddress: String, bytes: ByteArray) {
        val adapter = bluetoothAdapter ?: error("Bluetooth no disponible")
        val device = adapter.getRemoteDevice(macAddress)
        device.createRfcommSocketToServiceRecord(serialPortProfile).use { socket ->
            adapter.cancelDiscovery()
            socket.connect()
            socket.outputStream.use { output ->
                output.write(bytes)
                output.flush()
            }
        }
    }
}

class BluetoothThermalPrinterCompat(context: Context) {
    private val manager = BluetoothPrintManager(context)

    fun printText(macAddress: String, ticketId: String, text: String): PrintResult {
        return manager.printOrQueue(macAddress, ticketId, text)
    }
}
