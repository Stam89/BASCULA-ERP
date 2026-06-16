package com.bascula.erp.printing

import java.io.ByteArrayOutputStream
import java.nio.charset.Charset

class EscPos58mmFormatter {
    private val charset: Charset = Charset.forName("CP437")

    fun formatText(text: String): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(0x1B, 0x40))
        out.write(byteArrayOf(0x1B, 0x61, 0x00))

        text.lineSequence().forEach { raw ->
            val line = raw.replace("\t", " ").take(32)
            out.write(line.toByteArray(charset))
            out.write(newLine())
        }

        out.write(newLine())
        out.write(newLine())
        out.write(byteArrayOf(0x1D, 0x56, 0x00))
        return out.toByteArray()
    }

    fun format(document: PrintDocument): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(0x1B, 0x40))
        out.write(byteArrayOf(0x1B, 0x61, 0x01))
        out.write(bold(true))
        out.write(document.documentType.take(32).toByteArray(charset))
        out.write(newLine())
        out.write(bold(false))
        out.write(byteArrayOf(0x1B, 0x61, 0x00))

        document.lines.forEach { raw ->
            val line = raw.replace("\t", " ").take(32)
            out.write(line.toByteArray(charset))
            out.write(newLine())
        }

        out.write(newLine())
        out.write(newLine())
        out.write(byteArrayOf(0x1D, 0x56, 0x00))
        return out.toByteArray()
    }

    private fun bold(enabled: Boolean): ByteArray {
        return byteArrayOf(0x1B, 0x45, if (enabled) 0x01 else 0x00)
    }

    private fun newLine(): ByteArray {
        return byteArrayOf(0x0A)
    }
}
