package com.bascula.erp.tickets

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class TicketDatabaseHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {
    override fun onCreate(db: SQLiteDatabase) {
        createTicketsTable(db)
        createFailedPrintsTable(db)
        createFinanceTables(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            addColumnIfMissing(db, "tickets", "is_locked", "INTEGER NOT NULL DEFAULT 0")
            addColumnIfMissing(db, "tickets", "print_count", "INTEGER NOT NULL DEFAULT 0")
        }
        if (oldVersion < 4) {
            migrateTicketsToOfflineSchema(db)
            migrateFailedPrintsToTextIds(db)
        }
        if (oldVersion < 5) {
            addFinancialColumnsToTickets(db)
            createFinanceTables(db)
        }
    }

    private fun createTicketsTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE tickets (
                id TEXT PRIMARY KEY NOT NULL,
                farmer_id TEXT,
                farmer_name TEXT NOT NULL DEFAULT '',
                gross_weight REAL NOT NULL DEFAULT 0,
                tare_weight REAL NOT NULL DEFAULT 0,
                qualification REAL NOT NULL DEFAULT 0,
                is_locked INTEGER NOT NULL DEFAULT 0,
                print_count INTEGER NOT NULL DEFAULT 0,
                is_synced INTEGER NOT NULL DEFAULT 0,
                price_per_quintal REAL NOT NULL DEFAULT 0,
                gross_payable REAL NOT NULL DEFAULT 0,
                advances_discount REAL NOT NULL DEFAULT 0,
                net_payable REAL NOT NULL DEFAULT 0,
                liquidated_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }

    private fun createFailedPrintsTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS failed_prints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT NOT NULL,
                plain_text TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }

    private fun migrateTicketsToOfflineSchema(db: SQLiteDatabase) {
        if (!tableExists(db, "tickets")) {
            createTicketsTable(db)
            return
        }

        db.execSQL("ALTER TABLE tickets RENAME TO tickets_legacy")
        createTicketsTable(db)
        db.execSQL(
            """
            INSERT INTO tickets (
                id,
                farmer_id,
                farmer_name,
                gross_weight,
                tare_weight,
                qualification,
                is_locked,
                print_count,
                is_synced,
                price_per_quintal,
                gross_payable,
                advances_discount,
                net_payable,
                liquidated_at,
                created_at,
                updated_at
            )
            SELECT
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
                    substr(hex(randomblob(2)), 2) || '-' ||
                    substr('89ab', abs(random()) % 4 + 1, 1) ||
                    substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
                NULL,
                '',
                gross_weight,
                tare_weight,
                qualification,
                is_locked,
                print_count,
                0,
                0,
                0,
                0,
                0,
                NULL,
                created_at,
                updated_at
            FROM tickets_legacy
            """.trimIndent()
        )
        db.execSQL("DROP TABLE tickets_legacy")
    }

    private fun migrateFailedPrintsToTextIds(db: SQLiteDatabase) {
        if (!tableExists(db, "failed_prints")) {
            createFailedPrintsTable(db)
            return
        }

        db.execSQL("ALTER TABLE failed_prints RENAME TO failed_prints_legacy")
        createFailedPrintsTable(db)
        db.execSQL(
            """
            INSERT INTO failed_prints (
                id,
                ticket_id,
                plain_text,
                attempts,
                last_error,
                created_at,
                updated_at
            )
            SELECT
                id,
                CAST(ticket_id AS TEXT),
                plain_text,
                attempts,
                last_error,
                created_at,
                updated_at
            FROM failed_prints_legacy
            """.trimIndent()
        )
        db.execSQL("DROP TABLE failed_prints_legacy")
    }

    private fun addFinancialColumnsToTickets(db: SQLiteDatabase) {
        addColumnIfMissing(db, "tickets", "farmer_id", "TEXT")
        addColumnIfMissing(db, "tickets", "price_per_quintal", "REAL NOT NULL DEFAULT 0")
        addColumnIfMissing(db, "tickets", "gross_payable", "REAL NOT NULL DEFAULT 0")
        addColumnIfMissing(db, "tickets", "advances_discount", "REAL NOT NULL DEFAULT 0")
        addColumnIfMissing(db, "tickets", "net_payable", "REAL NOT NULL DEFAULT 0")
        addColumnIfMissing(db, "tickets", "liquidated_at", "INTEGER")
    }

    private fun createFinanceTables(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS agricultores (
                id TEXT PRIMARY KEY NOT NULL,
                nombre TEXT NOT NULL,
                cedula_ruc TEXT,
                telefono TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS anticipos (
                id TEXT PRIMARY KEY NOT NULL,
                agricultor_id TEXT NOT NULL,
                monto REAL NOT NULL,
                saldo_pendiente REAL NOT NULL,
                fecha INTEGER NOT NULL,
                estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'aplicado', 'anulado')),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (agricultor_id) REFERENCES agricultores(id)
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS anticipo_aplicaciones (
                id TEXT PRIMARY KEY NOT NULL,
                anticipo_id TEXT NOT NULL,
                ticket_id TEXT NOT NULL,
                monto_aplicado REAL NOT NULL,
                fecha INTEGER NOT NULL,
                FOREIGN KEY (anticipo_id) REFERENCES anticipos(id),
                FOREIGN KEY (ticket_id) REFERENCES tickets(id)
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS movimientos_caja (
                id TEXT PRIMARY KEY NOT NULL,
                ticket_id TEXT,
                tipo TEXT NOT NULL,
                categoria TEXT NOT NULL,
                monto REAL NOT NULL,
                descripcion TEXT,
                fecha INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }

    private fun addColumnIfMissing(db: SQLiteDatabase, table: String, column: String, definition: String) {
        val cursor = db.rawQuery("PRAGMA table_info($table)", null)
        cursor.use {
            while (it.moveToNext()) {
                if (it.getString(it.getColumnIndexOrThrow("name")) == column) {
                    return
                }
            }
        }
        db.execSQL("ALTER TABLE $table ADD COLUMN $column $definition")
    }

    private fun tableExists(db: SQLiteDatabase, table: String): Boolean {
        val cursor = db.rawQuery(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            arrayOf(table)
        )
        return cursor.use { it.moveToFirst() }
    }

    companion object {
        private const val DATABASE_NAME = "bascula_tickets.db"
        private const val DATABASE_VERSION = 5
    }
}
