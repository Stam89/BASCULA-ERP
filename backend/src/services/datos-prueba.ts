// ── «Borrar datos de prueba» (Configuración → ⚠️ Zona de peligro) ────────────
// Vacía las tablas transaccionales para arrancar con datos reales y conserva la
// configuración y los catálogos. Lo usa POST /settings/reset-transactions (que
// valida clave, confirmación y APP_MODE) y la prueba sobre una copia de la base.

import { ApiError } from "../http/error-handler.js";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

// Tablas transaccionales que se vacían al poner en marcha el negocio.
// Se conservan: users/roles, app_settings, products, warehouses, equipment,
// y los catálogos de insumos y sacos (con stock en 0).
export const WIPE_TABLES = [
  // Saldos iniciales (registro de lo cargado al arranque; sus filas reales caen abajo).
  "saldos_iniciales",
  "farmers",
  "customers",
  "vehicles",
  "lots",
  "lot_process_reports",
  "lot_process_report_links",
  "drying_tunnel_reports",
  "drying_tunnel_report_lots",
  "weighing_tickets",
  "mobile_synced_tickets",
  "mobile_advance_applications",
  "insumo_movements",
  "production_yields",
  "third_party_custody",
  "inventory_movements",
  "farmer_advances",
  "processing_batches",
  "processing_batch_drying_lots",
  "processing_outputs",
  "processing_losses",
  "maquila_orders",
  "liquidations",
  "liquidation_details",
  "advance_applications",
  "accounts_payable",
  "cash_registers",
  "cash_movements",
  "payments_made",
  "sales",
  "sale_items",
  "accounts_receivable",
  "payments_received",
  "expenses",
  "labor_payments",
  "worker_payments",
  "worker_advances",
  // Nómina administrativa (personal de oficina + su historial de sueldos pagados).
  "admin_salary_payments",
  "admin_staff",
  "cuadrilla_entries",
  "cuadrilla_advances",
  "pilado_services",
  "milling_drafts",
  "motor_fuel_records",
  "lot_transfers",
  "sales_orders",
  "sales_order_items",
  "selection_batches",
  "selection_batch_inputs",
  "selection_batch_outputs",
  "bank_statements",
  "bank_statement_lines",
  "firebase_sync_state",
  "print_jobs",
  "audit_logs",
  "fomentos",
  "fomento_entregas",
  "fomento_pagos",
  "sack_movements",
  "equipment_maintenance",
  // Repuestos de planta: el kárdex se borra y su stock vuelve a 0 (el catálogo queda).
  "repuesto_movimientos",
  // Transporte y Cosechadora (Campo): SOLO históricos operativos. Se preservan los
  // catálogos maestros (campo_activos flota, campo_operadores choferes,
  // campo_clientes, campo_cuentas, campo_categorias_gasto, campo_config).
  "campo_movimientos",
  "campo_servicios",
  "campo_partes",
  "campo_cxp",
  "campo_caja_sesiones",
  // Avisos de la campana: hablan de movimientos que ya no existirán.
  "notificaciones",
  // Compras (módulo Compras) y reservas/consumo de gas de túneles: transaccionales
  // que no colgaban de ninguna tabla de esta lista, así que quedaban sin borrar.
  "purchases",
  "purchase_items",
  "tunnel_reservations",
  "gas_consumption_reports",
  // Cifras manuales del Resultado mensual (hipoteca, ganancias de envejecido/
  // selectado…): las de la marcha blanca eran de ensayo. Los rubros (costo_rubros)
  // y su enlace con las categorías de Caja se conservan.
  "resultado_mensual_manual"
];

/**
 * Catálogos que NO se pierden aunque tengan una FK hacia una tabla que se vacía.
 * TRUNCATE … CASCADE vacía TODA tabla que referencie a otra vaciada (sin mirar su
 * ON DELETE), así que se borraban los equipos/activos (FK a la compra en caja),
 * el catálogo de repuestos (FK al equipo) y el tarifario de servicios (FK al
 * cliente). Esas FK se sueltan durante el vaciado y se vuelven a crear idénticas;
 * antes, lo que apuntaba a filas borradas se resuelve según la política:
 *  - nulificar: la columna queda en NULL (lo mismo que su ON DELETE SET NULL).
 *  - borrar_filas: se borran esas filas (tarifas de clientes que ya no existen;
 *    las tarifas de los socios se conservan).
 */
export const CATALOGOS_PRESERVADOS: Record<string, "nulificar" | "borrar_filas"> = {
  equipment: "nulificar",
  repuestos: "nulificar",
  tarifario_servicio: "borrar_filas"
};

export type Fk = { conname: string; hijo: string; padre: string; def: string; cols: string[] };

/**
 * Plan del vaciado: qué tablas vacía el CASCADE (sin entrar a los catálogos
 * preservados) y qué FK de esos catálogos hay que soltar porque apuntan a algo
 * que se vacía. Puro (sin BD) para poder probarlo.
 */
export function planVaciado(fks: Fk[], tablas: string[], preservados: string[]): { vaciadas: Set<string>; sueltas: Fk[] } {
  const preservar = new Set(preservados);
  const vaciadas = new Set<string>(tablas);
  for (let crece = true; crece;) {
    crece = false;
    for (const f of fks) {
      if (vaciadas.has(f.padre) && !vaciadas.has(f.hijo) && !preservar.has(f.hijo)) { vaciadas.add(f.hijo); crece = true; }
    }
  }
  return { vaciadas, sueltas: fks.filter((f) => preservar.has(f.hijo) && vaciadas.has(f.padre)) };
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function vaciarDatosDePrueba(db: Db): Promise<{ wiped: string[]; notFound: string[]; preservados: string[] }> {
  const preservables = Object.keys(CATALOGOS_PRESERVADOS);
  const existing = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [[...WIPE_TABLES, ...preservables, "insumos", "sack_inventory", "tunnel_status"]]
  );
  const present = new Set<string>(existing.rows.map((r: { tablename: string }) => r.tablename));
  const tables = WIPE_TABLES.filter((t) => present.has(t));
  const notFound = WIPE_TABLES.filter((t) => !present.has(t));
  if (notFound.length > 0) {
    console.error(`[reset-transactions] ⚠️ Tablas de la lista NO encontradas en el esquema (posible nombre incorrecto): ${notFound.join(", ")}`);
  }

  // 1) Qué vaciará el CASCADE (sin entrar a los catálogos preservados) y qué FK
  //    de esos catálogos apuntan a algo que se vacía.
  const fks: Fk[] = (await db.query(
    `SELECT c.conname, c.conrelid::regclass::text AS hijo, c.confrelid::regclass::text AS padre,
            pg_get_constraintdef(c.oid) AS def,
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) AS k(n)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS cols
       FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`
  )).rows;
  const preservar = preservables.filter((t) => present.has(t));
  const { sueltas } = planVaciado(fks, tables, preservar);
  for (const f of sueltas) await db.query(`ALTER TABLE ${f.hijo} DROP CONSTRAINT ${ident(f.conname)}`);

  // 2) Truncado tabla POR tabla, con CASCADE (Postgres: equivale a desactivar las
  //    FKs — no existe SET FOREIGN_KEY_CHECKS aquí). Si UNA falla, se lanza un
  //    error VISIBLE nombrando la tabla y toda la transacción hace rollback.
  for (const t of tables) {
    try {
      await db.query(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
    } catch (err) {
      const msg = `[reset-transactions] ❌ BLOQUEADO al truncar la tabla "${t}": ${(err as Error).message}`;
      console.error(msg);
      throw new ApiError(500, `Borrado de datos de prueba bloqueado en la tabla "${t}". ${(err as Error).message}`);
    }
  }

  // 3) Catálogos preservados: resolver lo que apuntaba a filas borradas y volver
  //    a crear sus FK tal cual estaban.
  for (const f of sueltas) {
    const alguna = f.cols.map((c) => `${ident(c)} IS NOT NULL`).join(" OR ");
    if (CATALOGOS_PRESERVADOS[f.hijo] === "borrar_filas") {
      await db.query(`DELETE FROM ${f.hijo} WHERE ${alguna}`);
    } else {
      await db.query(`UPDATE ${f.hijo} SET ${f.cols.map((c) => `${ident(c)} = NULL`).join(", ")} WHERE ${alguna}`);
    }
    await db.query(`ALTER TABLE ${f.hijo} ADD CONSTRAINT ${ident(f.conname)} ${f.def}`);
  }

  if (present.has("insumos")) await db.query(`UPDATE insumos SET stock_actual = 0`);
  if (present.has("sack_inventory")) await db.query(`UPDATE sack_inventory SET stock = 0, updated_at = now()`);
  if (present.has("repuestos")) await db.query(`UPDATE repuestos SET stock = 0, updated_at = now()`);
  // Túneles: ninguno queda «ocupado» por un secado que ya no existe.
  if (present.has("tunnel_status")) {
    await db.query(
      `UPDATE tunnel_status
          SET status = 'DISPONIBLE', current_accionista_id = NULL, accionista_name = NULL,
              occupied_at = NULL, updated_at = now()
        WHERE status <> 'DISPONIBLE' OR current_accionista_id IS NOT NULL`
    );
  }

  console.log(`[reset-transactions] ✅ Truncadas ${tables.length} tabla(s): ${tables.join(", ")}`);
  return { wiped: tables, notFound, preservados: preservar };
}
