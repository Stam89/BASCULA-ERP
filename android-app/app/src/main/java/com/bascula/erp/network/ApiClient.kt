package com.bascula.erp.network

import com.bascula.erp.printing.PrintDocument
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiClient(private val baseUrl: String) {
    fun getPrintDocument(path: String): PrintDocument {
        val url = URL("${baseUrl.trimEnd('/')}/api/v1$path")
        val connection = url.openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 8000
        connection.readTimeout = 8000

        val body = connection.inputStream.bufferedReader().use { it.readText() }
        val json = JSONObject(body)
        val linesArray = json.getJSONArray("lines")
        val lines = buildList {
            for (index in 0 until linesArray.length()) {
                add(linesArray.getString(index))
            }
        }

        return PrintDocument(
            documentType = json.getString("document_type"),
            lines = lines
        )
    }
}
