import type { PoolClient } from "pg";
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import multer from "multer";
import ExcelJS from "exceljs";
import crypto from "crypto";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { inTransaction } from "../../db/transaction.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const fomentosRouter = Router();

function getAccionistaId(req: Request): string {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  if (!accionistaId) throw new ApiError(400, "Selecciona un accionista antes de continuar.");
  return accionistaId;
}

async function assertFomentoAccionista(client: PoolClient, fomentoId: string, accionistaId: string) {
  const result = await client.query<{ accionista_id: string | null }>(
    "SELECT accionista_id FROM fomentos WHERE id = $1",
    [fomentoId]
  );
  if (!result.rowCount) throw new ApiError(404, "Fomento no encontrado");
  if (result.rows[0].accionista_id !== accionistaId) {
    throw new ApiError(403, "Este fomento no pertenece al accionista activo");
  }
}

const fomentoSchema = z.object({
  farmer_name:  z.string().min(2),
  farmer_id:    z.string().uuid().optional(),
  cuadras:      z.number().positive(),
  inicio:       z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  cosecha:      z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  renta:        z.number().min(0.001).max(1).default(0.07),
  status:       z.enum(["ACTIVOS","NO ACTIVOS","APROBADOS"]).default("ACTIVOS"),
  notes:        z.string().optional(),
  // Informativos (NO alteran el cálculo del crédito, que sigue en cuadras*800).
  variedad:       z.string().optional(),
  limite_credito: z.number().nonnegative().optional(),
  // N.º de Página / Libreta (Folio): ubicación de la firma física. Se acepta
  // cadena vacía para poder LIMPIARLO desde la edición.
  folio:          z.string().max(50).optional()
});

const entregaSchema = z.object({
  // Para el saldo arrastrado la fecha es irrelevante (no corre por días): se hace
  // opcional y la BD la deja en CURRENT_DATE por defecto.
  fecha:            z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  valor:            z.number().positive(),
  concepto:         z.string().optional(),
  cash_register_id: z.string().uuid().optional(),
  // "Saldos en contra": fila de saldo de cosecha pasada con interés fijo por meses.
  es_saldo_anterior: z.boolean().optional().default(false),
  meses_interes_fijo: z.number().int().min(1).max(60).optional()
});

const pagoSchema = z.object({
  fecha:            z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  valor:            z.number().positive(),
  concepto:         z.string().optional(),
  cash_register_id: z.string().uuid().optional()
});

const SELECT_FOMENTO = `
  SELECT
    f.*,
    ROUND(f.cuadras * 16, 2)  AS paradas,
    ROUND(f.cuadras * 800, 2) AS monto_limite,
    COALESCE(e.total_pedido, 0) AS total_pedido,
    COALESCE(p.total_pagado, 0) AS total_pagado,
    -- Interés HÍBRIDO: suma por fila (ver subconsulta e.gasto_adm) — filas normales
    -- por días + filas de saldo arrastrado con N meses fijos.
    COALESCE(e.gasto_adm, 0) AS gasto_adm,
    ROUND(f.cuadras * 800 - COALESCE(e.total_pedido, 0), 2) AS falta_por_pedir,
    ROUND(COALESCE(e.total_pedido, 0) + COALESCE(e.gasto_adm, 0) - COALESCE(p.total_pagado, 0), 2) AS deuda_total,
    CASE WHEN f.cuadras * 800 - COALESCE(e.total_pedido, 0) > 0
         THEN 'HABILITADO' ELSE 'DESABILITADO' END AS estado_credito
  FROM fomentos f
  LEFT JOIN (
    SELECT
      fomento_id,
      SUM(valor) AS total_pedido,
      SUM(CASE WHEN fe.es_saldo_anterior
               THEN fe.valor * f2.renta * COALESCE(fe.meses_interes_fijo, 0)
               ELSE fe.valor * f2.renta / 30.0 * GREATEST(CURRENT_DATE - fe.fecha, 0) END) AS gasto_adm
    FROM fomento_entregas fe
    JOIN fomentos f2 ON f2.id = fe.fomento_id
    GROUP BY fomento_id
  ) e ON e.fomento_id = f.id
  LEFT JOIN (
    SELECT fomento_id, SUM(valor) AS total_pagado
    FROM fomento_pagos
    GROUP BY fomento_id
  ) p ON p.fomento_id = f.id
`;

fomentosRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const result = await pool.query(`${SELECT_FOMENTO} WHERE f.accionista_id = $1 ORDER BY f.created_at DESC`, [accionistaId]);
  res.json(result.rows);
}));

const upload = multer({ storage: multer.memoryStorage() });

// ── Exportar fomentos a Excel ───────────────────────────────────────────────
fomentosRouter.get("/export", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const result = await pool.query(`${SELECT_FOMENTO} WHERE f.accionista_id = $1 ORDER BY f.created_at DESC`, [accionistaId]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Fomentos");
  sheet.columns = [
    { header: "ID", key: "id", width: 40 },
    { header: "Nombre Agricultor", key: "farmer_name", width: 30 },
    { header: "Cuadras", key: "cuadras", width: 12 },
    { header: "Fecha Inicio", key: "inicio", width: 15 },
    { header: "Fecha Cosecha", key: "cosecha", width: 15 },
    { header: "Renta (%)", key: "renta", width: 12 },
    { header: "Estado", key: "status", width: 14 },
    { header: "Deuda Total", key: "deuda_total", width: 14 }
  ];

  for (const row of result.rows) {
    sheet.addRow({
      id: row.id,
      farmer_name: row.farmer_name,
      cuadras: Number(row.cuadras),
      inicio: row.inicio ? new Date(row.inicio) : null,
      cosecha: row.cosecha ? new Date(row.cosecha) : null,
      renta: Number(row.renta),
      status: row.status,
      deuda_total: Number(row.deuda_total ?? 0)
    });
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  const filename = `fomentos_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}));

// ── Importar fomentos desde Excel ─────────────────────────────────────────────
const importRowSchema = z.object({
  id: z.string().uuid().optional(),
  farmer_name: z.string().min(2),
  cuadras: z.number().positive(),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  cosecha: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  renta: z.number().min(0.001).max(1).default(0.07),
  status: z.enum(["ACTIVOS", "NO ACTIVOS", "APROBADOS"])
});

const cellString = (val: unknown): string | undefined => {
  const s = String(val ?? "").trim();
  return s.length > 0 ? s : undefined;
};

const cellNumber = (val: unknown): number | undefined => {
  const n = parseFloat(String(val ?? ""));
  return isNaN(n) ? undefined : n;
};

const parseExcelDate = (val: unknown): string | undefined => {
  if (!val) return undefined;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "string") {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  if (typeof val === "number") {
    const days = Math.floor(val);
    const fraction = val - days;
    const d = new Date(Date.UTC(1899, 11, 30 + days, 0, 0, fraction * 86400));
    return d.toISOString().split("T")[0];
  }
  return undefined;
};

const parseRenta = (val: unknown): number | undefined => {
  const n = cellNumber(val);
  return n && n > 0 && n <= 1 ? n : undefined;
};

function calcularCosecha(inicio: string): string {
  const [yy, mm, dd] = inicio.split("-").map(Number);
  const d = new Date(Date.UTC(yy, mm - 1, dd));
  d.setUTCMonth(d.getUTCMonth() + 4);
  return d.toISOString().slice(0, 10);
}

// Normaliza el "Estado del Fomento" del Excel maestro (Columna C) al enum del ERP.
function mapEstadoFomento(val: unknown): "ACTIVOS" | "NO ACTIVOS" | "APROBADOS" {
  const s = String(val ?? "").trim().toUpperCase();
  if (s.startsWith("APROB")) return "APROBADOS";
  if (s.startsWith("NO ") || s === "NO" || s.includes("INACTIV") || s.includes("DESACTIV")) return "NO ACTIVOS";
  return "ACTIVOS"; // "ACTIVO"/"ACTIVOS"/vacío → activo por defecto
}

const round2Fom = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

fomentosRouter.post("/import", upload.single("file"), asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) throw new ApiError(400, "No se envio archivo");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ApiError(400, "El archivo no tiene hojas");

  const expected = ["ID", "Nombre Agricultor", "Cuadras", "Fecha Inicio", "Fecha Cosecha", "Renta (%)", "Estado", "Deuda Total"];
  const headers = ((sheet.getRow(1).values ?? []) as unknown[]).slice(1).map((v) => String(v ?? "").trim());

  // ── PLANTILLA PLANA (espejo de los cuadros del cliente) ─────────────────────
  // Encabezados: CLIENTE | CUADRAS | LIMITE | No | Fecha inicial | Fecha final |
  // Dias | Mes | VALOR | GASTO ADMINISTRATIVO | ES_SALDO_ANTERIOR (SI/NO).
  // Se AGRUPA por CLIENTE; la 1ª fila de cada cliente da cuadras/límite; cada fila
  // es una entrega (Fecha inicial + VALOR). Días/Mes/Fecha final se IGNORAN (el
  // motor recalcula por días). Si ES_SALDO_ANTERIOR='SI' → interés fijo por N meses.
  // Los encabezados se normalizan (espacios extra) para tolerar el copy-paste.
  const hnorm = headers.map((h) => h.replace(/\s+/g, " ").trim().toUpperCase());
  const col = (pred: (h: string) => boolean) => { const i = hnorm.findIndex(pred); return i >= 0 ? i + 1 : 0; };
  const cCliente = col((h) => h === "CLIENTE");
  const cValor = col((h) => h === "VALOR");
  const esPlantillaPlana = cCliente > 0 && cValor > 0;

  if (esPlantillaPlana) {
    const cCuadras = col((h) => h === "CUADRAS");
    const cLimite = col((h) => h === "LIMITE" || h.startsWith("LIMITE") || h.startsWith("LÍMITE"));
    const cFechaIni = col((h) => h.startsWith("FECHA INICIAL") || h.startsWith("FECHA INICIO"));
    const cMes = col((h) => h === "MES");
    const cSaldo = col((h) => h.includes("SALDO ANTERIOR") || h.includes("SALDO_ANTERIOR") || h.startsWith("ES_SALDO"));

    type EntradaPlana = { fecha: string | undefined; valor: number; esSaldo: boolean; meses: number | null };
    type GrupoPlano = { cliente: string; cuadras: number; limite: number | null; entregas: EntradaPlana[] };
    const grupos = new Map<string, GrupoPlano>();
    let ultimoCliente = "";

    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      // El CLIENTE puede repetirse o dejarse en blanco en las filas de continuación.
      const clienteCelda = cellString(row.getCell(cCliente).value);
      const cliente = clienteCelda ?? ultimoCliente;
      const valor = cellNumber(row.getCell(cValor).value);
      if (!cliente || valor === undefined || !(valor > 0)) continue;
      ultimoCliente = cliente;

      const key = cliente.trim().toLowerCase();
      let g = grupos.get(key);
      if (!g) {
        // 1ª fila del cliente: cabecera (cuadras/límite).
        const cuadras = cCuadras ? (cellNumber(row.getCell(cCuadras).value) ?? 0) : 0;
        const limiteRaw = cLimite ? cellNumber(row.getCell(cLimite).value) : undefined;
        g = { cliente: cliente.trim(), cuadras: cuadras > 0 ? cuadras : 0, limite: limiteRaw && limiteRaw > 0 ? limiteRaw : null, entregas: [] };
        grupos.set(key, g);
      }
      const esSaldo = cSaldo ? String(cellString(row.getCell(cSaldo).value) ?? "").trim().toUpperCase().startsWith("SI") : false;
      const meses = esSaldo ? Math.max(1, Math.round(cMes ? (cellNumber(row.getCell(cMes).value) ?? 1) : 1)) : null;
      g.entregas.push({ fecha: parseExcelDate(row.getCell(cFechaIni).value) ?? undefined, valor, esSaldo, meses });
    }

    const plana = await inTransaction(async (client) => {
      let created = 0, farmersCreated = 0, entregasCreadas = 0, saldosAnteriores = 0, omitidos = 0;
      const errores: Array<{ cliente: string; error: string }> = [];
      for (const g of grupos.values()) {
        const nombre = g.cliente;
        const fechas = g.entregas.map((e) => e.fecha).filter((f): f is string => !!f).sort();
        const inicio = fechas[0] ?? new Date().toISOString().slice(0, 10);
        const cosecha = calcularCosecha(inicio);

        // Dedup por (accionista, nombre, cuadras, límite, inicio).
        const dup = await client.query(
          "SELECT 1 FROM fomentos WHERE accionista_id = $1 AND lower(farmer_name) = lower($2) AND cuadras = $3 AND COALESCE(limite_credito,0) = COALESCE($4,0) AND inicio = $5 LIMIT 1",
          [accionistaId, nombre, g.cuadras, g.limite, inicio]
        );
        if (dup.rowCount) { omitidos++; continue; }

        // (a) Agricultor: buscar/crear.
        const existe = await client.query("SELECT id FROM farmers WHERE lower(full_name) = lower($1) LIMIT 1", [nombre]);
        let farmerId: string;
        if (existe.rowCount) farmerId = existe.rows[0].id;
        else { farmerId = (await client.query("INSERT INTO farmers (full_name, accionista_id) VALUES ($1,$2) RETURNING id", [nombre, accionistaId])).rows[0].id; farmersCreated++; }

        // (b) Fomento (cabecera).
        const fom = await client.query(
          `INSERT INTO fomentos (accionista_id, farmer_name, farmer_id, cuadras, inicio, cosecha, renta, status, notes, limite_credito)
           VALUES ($1,$2,$3,$4,$5,$6,0.07,'ACTIVOS',$7,$8) RETURNING id`,
          [accionistaId, nombre, farmerId, g.cuadras, inicio, cosecha, "Importado (plantilla plana)", g.limite]
        );
        created++;

        // (c) Entregas: fecha inicial + valor; ES_SALDO_ANTERIOR → interés fijo N meses.
        for (const e of g.entregas) {
          await client.query(
            "INSERT INTO fomento_entregas (fomento_id, fecha, valor, concepto, es_saldo_anterior, meses_interes_fijo) VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6)",
            [fom.rows[0].id, e.fecha ?? null, e.valor,
             e.esSaldo ? "Saldo en contra cosecha pasada" : "Entrega importada (plantilla plana)",
             e.esSaldo, e.esSaldo ? e.meses : null]
          );
          entregasCreadas++;
          if (e.esSaldo) saldosAnteriores++;
        }
      }
      return { created, farmersCreated, entregasCreadas, saldosAnteriores, omitidos, errores };
    });

    res.json({ success: true, plana: true, created: plana.created, farmersCreated: plana.farmersCreated,
      entregasCreadas: plana.entregasCreadas, saldosAnteriores: plana.saldosAnteriores, omitidos: plana.omitidos, errors: plana.errores });
    return;
  }

  // ── Migración masiva del EXCEL MAESTRO del cliente (mapeo POSICIONAL C..L) ──
  // Si el archivo NO trae los encabezados de la exportación del ERP, se asume que
  // es el maestro anual del cliente y se importa por posición de columna:
  //   C(3)=Estado · D(4)=Fecha Inicio · E(5)=Fecha Cosecha · F(6)=Cuadras ·
  //   G(7)=Paradas(info) · H(8)=Estado operativo(info) · I(9)=Disponible ·
  //   J(10)=Monto Límite · K(11)=N.º Libreta · L(12)=Agricultor.
  // El flujo de re-importar la exportación del ERP (por encabezados) queda intacto.
  const esFormatoExportacionErp = headers.includes("Nombre Agricultor") && headers.includes("Cuadras");
  if (!esFormatoExportacionErp) {
    const migr = await inTransaction(async (client) => {
      let created = 0, farmersCreated = 0, saldosMigrados = 0, omitidos = 0;
      const errores: Array<{ fila: number; error: string }> = [];

      for (let i = 2; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i);
        const nombre = cellString(row.getCell(12).value);           // L
        const cuadras = cellNumber(row.getCell(6).value);           // F
        // Salta filas vacías; y cabeceras/totales colados (sin cuadras numéricas).
        if (!nombre && cuadras === undefined) continue;
        if (!nombre) { errores.push({ fila: i, error: "Falta el nombre del agricultor (Columna L)." }); continue; }
        if (!(cuadras !== undefined && cuadras > 0)) {
          if (/agricultor|nombre|total/i.test(nombre)) continue; // encabezado/total intermedio
          errores.push({ fila: i, error: `Cuadras inválidas (Columna F) para "${nombre}".` });
          continue;
        }

        const inicio = parseExcelDate(row.getCell(4).value);        // D
        if (!inicio) { errores.push({ fila: i, error: `Fecha de inicio inválida (Columna D) para "${nombre}".` }); continue; }
        const cosecha = parseExcelDate(row.getCell(5).value) ?? calcularCosecha(inicio); // E
        const status = mapEstadoFomento(row.getCell(3).value);      // C
        const disponible = cellNumber(row.getCell(9).value) ?? 0;   // I
        const limite = cellNumber(row.getCell(10).value) ?? 0;      // J
        const libretaRaw = row.getCell(11).value;                   // K
        const folio = libretaRaw != null && String(libretaRaw).trim() !== ""
          ? String(libretaRaw).trim().replace(/\.0+$/, "").slice(0, 50)
          : null;

        // Dedup: evita duplicar si se vuelve a subir el mismo maestro.
        const dup = await client.query(
          "SELECT 1 FROM fomentos WHERE accionista_id = $1 AND lower(farmer_name) = lower($2) AND inicio = $3 AND cuadras = $4 LIMIT 1",
          [accionistaId, nombre, inicio, cuadras]
        );
        if (dup.rowCount) { omitidos++; continue; }

        // (a) Verificación de agricultor en el Directorio (Báscula = farmers).
        //     Si no existe, se crea para mantener integridad referencial.
        const existente = await client.query("SELECT id FROM farmers WHERE lower(full_name) = lower($1) LIMIT 1", [nombre]);
        let farmerId: string;
        if (existente.rowCount) {
          farmerId = existente.rows[0].id;
        } else {
          const nuevo = await client.query(
            "INSERT INTO farmers (full_name, accionista_id) VALUES ($1, $2) RETURNING id",
            [nombre, accionistaId]
          );
          farmerId = nuevo.rows[0].id;
          farmersCreated++;
        }

        // (b) Creación del Fomento.
        const fom = await client.query(
          `INSERT INTO fomentos (accionista_id, farmer_name, farmer_id, cuadras, inicio, cosecha, renta, status, notes, limite_credito, folio)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [accionistaId, nombre, farmerId, cuadras, inicio, cosecha, 0.07, status,
           "Migrado del Excel maestro", limite > 0 ? limite : null, folio]
        );
        created++;

        // (c) Saldo inicial: Deuda = Monto Límite (J) − Disponible (I).
        const deuda = round2Fom(limite - disponible);
        if (deuda > 0.005) {
          await client.query(
            `INSERT INTO fomento_entregas (fomento_id, fecha, valor, concepto)
             VALUES ($1, $2, $3, $4)`,
            [fom.rows[0].id, inicio, deuda, "SALDO INICIAL MIGRADO"]
          );
          saldosMigrados++;
        }
      }
      return { created, farmersCreated, saldosMigrados, omitidos, errores };
    });

    res.json({
      success: true,
      migracion: true,
      created: migr.created,
      updated: 0,
      farmersCreated: migr.farmersCreated,
      saldosMigrados: migr.saldosMigrados,
      omitidos: migr.omitidos,
      errors: migr.errores
    });
    return;
  }

  const missing = expected.filter((h) => !headers.includes(h));
  if (missing.length) throw new ApiError(400, `Columnas incorrectas. Faltan: ${missing.join(", ")}`);

  const colIndex = (name: string) => headers.indexOf(name) + 1;
  const rows: Array<z.infer<typeof importRowSchema>> = [];
  const errors: Array<{ fila: number; error: string }> = [];

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const farmerName = cellString(row.getCell(colIndex("Nombre Agricultor")).value);
    const cuadras = cellNumber(row.getCell(colIndex("Cuadras")).value);
    if (!farmerName && !cuadras) continue;

    const idValue = row.getCell(colIndex("ID")).value;
    const id = idValue ? String(idValue).trim() : undefined;

    const parsed = importRowSchema.safeParse({
      id,
      farmer_name: farmerName,
      cuadras,
      inicio: parseExcelDate(row.getCell(colIndex("Fecha Inicio")).value),
      cosecha: parseExcelDate(row.getCell(colIndex("Fecha Cosecha")).value) ?? undefined,
      renta: parseRenta(row.getCell(colIndex("Renta (%)")).value),
      status: cellString(row.getCell(colIndex("Estado")).value)?.toUpperCase()
    });

    if (!parsed.success) {
      const msgs = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      errors.push({ fila: i, error: msgs });
      continue;
    }
    rows.push(parsed.data);
  }

  if (rows.length === 0) {
    res.status(400).json({ success: false, created: 0, updated: 0, errors: [{ fila: 0, error: "No se encontraron filas con datos para importar. Verifica que el archivo tenga al menos Nombre Agricultor y Cuadras." }] });
    return;
  }

  if (errors.length) {
    res.status(400).json({ success: false, created: 0, updated: 0, errors });
    return;
  }

  const result = await inTransaction(async (client) => {
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const cosecha = row.cosecha ?? calcularCosecha(row.inicio);
      const renta = row.renta;
      const rowId = row.id;
      const existing = rowId
        ? await client.query<{ accionista_id: string | null }>("SELECT accionista_id FROM fomentos WHERE id = $1", [rowId])
        : null;
      const exists = existing ? (existing.rowCount ?? 0) > 0 : false;
      if (exists) {
        if (existing!.rows[0].accionista_id !== accionistaId) {
          throw new ApiError(403, `El fomento con ID ${rowId} pertenece a otro accionista`);
        }
        await client.query(
          `UPDATE fomentos
           SET farmer_name = $1, cuadras = $2, inicio = $3, cosecha = $4, renta = $5, status = $6
           WHERE id = $7`,
          [row.farmer_name, row.cuadras, row.inicio, cosecha, renta, row.status, rowId]
        );
        updated++;
      } else {
        const newId = rowId || crypto.randomUUID();
        await client.query(
          `INSERT INTO fomentos (id, accionista_id, farmer_name, cuadras, inicio, cosecha, renta, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [newId, accionistaId, row.farmer_name, row.cuadras, row.inicio, cosecha, renta, row.status]
        );
        created++;
      }
    }
    return { created, updated };
  });

  res.json({ success: true, ...result, errors: [] });
}));

// ── Importación MASIVA por "mosaico 2D" (el frontend parsea el Excel con XLSX y
// envía los bloques ya estructurados). Por cada cliente: busca/crea el agricultor,
// crea el fomento (cuadras/límite) e inserta sus entregas con la fecha original.
// El interés lo calcula el motor existente (por días desde cada entrega). ──────
const bulkImportSchema = z.object({
  bloques: z.array(z.object({
    cliente: z.string().min(2).max(160),
    cuadras: z.number().nonnegative().optional(),
    limite:  z.number().nonnegative().optional(),
    entregas: z.array(z.object({
      // El front ya convierte la fecha de Excel a ISO; se acepta opcional.
      fecha: z.string().optional(),
      valor: z.number().positive()
    })).default([])
  })).min(1, "No se detectó ningún bloque (busca la celda 'NOMBRE:').")
});

// Fecha segura: ISO 'YYYY-MM-DD' directo; si no, null → la BD usa CURRENT_DATE.
function fechaISOsegura(v: string | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

fomentosRouter.post("/bulk-import", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const data = bulkImportSchema.parse(req.body);

  const result = await inTransaction(async (client) => {
    let fomentosCreados = 0, agricultoresCreados = 0, entregasCreadas = 0, omitidos = 0;
    const errores: Array<{ cliente: string; error: string }> = [];

    for (const b of data.bloques) {
      const nombre = b.cliente.trim();
      if (!nombre) { errores.push({ cliente: "(vacío)", error: "Nombre vacío" }); continue; }

      // (a) Agricultor: buscar por nombre o crear (integridad referencial).
      const existente = await client.query("SELECT id FROM farmers WHERE lower(full_name) = lower($1) LIMIT 1", [nombre]);
      let farmerId: string;
      if (existente.rowCount) {
        farmerId = existente.rows[0].id;
      } else {
        const nuevo = await client.query("INSERT INTO farmers (full_name, accionista_id) VALUES ($1, $2) RETURNING id", [nombre, accionistaId]);
        farmerId = nuevo.rows[0].id;
        agricultoresCreados++;
      }

      const cuadras = b.cuadras && b.cuadras > 0 ? b.cuadras : 0;
      const limite = b.limite && b.limite > 0 ? b.limite : null;
      // inicio = la entrega más antigua con fecha válida, o HOY.
      const fechas = b.entregas.map((e) => fechaISOsegura(e.fecha)).filter((f): f is string => !!f).sort();
      const inicio = fechas[0] ?? new Date().toISOString().slice(0, 10);
      const cosecha = calcularCosecha(inicio);

      // Dedup: evita duplicar si se re-sube el mismo mosaico.
      const dup = await client.query(
        "SELECT 1 FROM fomentos WHERE accionista_id = $1 AND lower(farmer_name) = lower($2) AND cuadras = $3 AND COALESCE(limite_credito,0) = COALESCE($4,0) AND inicio = $5 LIMIT 1",
        [accionistaId, nombre, cuadras, limite, inicio]
      );
      if (dup.rowCount) { omitidos++; continue; }

      // (b) Fomento principal.
      const fom = await client.query(
        `INSERT INTO fomentos (accionista_id, farmer_name, farmer_id, cuadras, inicio, cosecha, renta, status, notes, limite_credito)
         VALUES ($1,$2,$3,$4,$5,$6,0.07,'ACTIVOS',$7,$8) RETURNING id`,
        [accionistaId, nombre, farmerId, cuadras, inicio, cosecha, "Importado (mosaico 2D)", limite]
      );
      fomentosCreados++;

      // (c) Entregas: fecha original (o CURRENT_DATE) + valor. El interés lo calcula
      //     el motor existente (por días desde cada fecha) — NO se marca saldo anterior.
      for (const e of b.entregas) {
        await client.query(
          "INSERT INTO fomento_entregas (fomento_id, fecha, valor, concepto) VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4)",
          [fom.rows[0].id, fechaISOsegura(e.fecha), e.valor, "Entrega importada (mosaico)"]
        );
        entregasCreadas++;
      }
    }
    return { fomentosCreados, agricultoresCreados, entregasCreadas, omitidos, errores };
  });

  res.json({ success: true, ...result });
}));

fomentosRouter.get("/:id", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const fomento = await pool.query(`${SELECT_FOMENTO} WHERE f.id = $1 AND f.accionista_id = $2`, [req.params.id, accionistaId]);
  if (!fomento.rows[0]) { res.status(404).json({ error: "No encontrado" }); return; }

  const [entregas, pagos] = await Promise.all([
    pool.query(
      `SELECT e.*,
        ROUND(CASE WHEN e.es_saldo_anterior
                   THEN e.valor * f.renta * COALESCE(e.meses_interes_fijo, 0)
                   ELSE e.valor * f.renta / 30.0 * GREATEST(CURRENT_DATE - e.fecha, 0) END, 2) AS interes,
        ROUND(e.valor + CASE WHEN e.es_saldo_anterior
                   THEN e.valor * f.renta * COALESCE(e.meses_interes_fijo, 0)
                   ELSE e.valor * f.renta / 30.0 * GREATEST(CURRENT_DATE - e.fecha, 0) END, 2) AS suman
       FROM fomento_entregas e
       JOIN fomentos f ON f.id = e.fomento_id
       WHERE e.fomento_id = $1
       ORDER BY e.fecha`,
      [req.params.id]
    ),
    pool.query(
      `SELECT * FROM fomento_pagos WHERE fomento_id = $1 ORDER BY fecha`,
      [req.params.id]
    )
  ]);

  res.json({ ...fomento.rows[0], entregas: entregas.rows, pagos: pagos.rows });
}));

fomentosRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const data = fomentoSchema.parse(req.body);
  const cosecha = data.cosecha ?? (() => {
    const d = new Date(data.inicio);
    d.setMonth(d.getMonth() + 4);
    return d.toISOString().slice(0, 10);
  })();

  const result = await pool.query(
    `INSERT INTO fomentos (accionista_id, farmer_name, farmer_id, cuadras, inicio, cosecha, renta, status, notes, variedad, limite_credito, folio)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [accionistaId, data.farmer_name, data.farmer_id ?? null, data.cuadras, data.inicio, cosecha,
     data.renta, data.status, data.notes ?? null, data.variedad ?? null, data.limite_credito ?? null,
     data.folio && data.folio.trim() !== "" ? data.folio.trim() : null]
  );
  res.status(201).json(result.rows[0]);
}));

fomentosRouter.patch("/:id", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const data = fomentoSchema.partial().parse(req.body);
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) { fields.push(`${k} = $${i++}`); vals.push(v); }
  }
  if (!fields.length) { res.json({ message: "nada que actualizar" }); return; }
  vals.push(req.params.id, accionistaId);
  const result = await pool.query(
    `UPDATE fomentos SET ${fields.join(", ")} WHERE id = $${i} AND accionista_id = $${i + 1} RETURNING *`,
    vals
  );
  if (!result.rowCount) throw new ApiError(404, "Fomento no encontrado o no pertenece al accionista activo");
  res.json(result.rows[0]);
}));

// Nota: el interés FIJO ahora se gestiona POR FILA (entregas de saldo arrastrado),
// no globalmente. El antiguo PATCH /:id/interes fue retirado; las columnas
// fomentos.modo_interes/interes_fijo_monto quedan sin uso (se dejan en BD).

fomentosRouter.delete("/:id", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const result = await pool.query("DELETE FROM fomentos WHERE id = $1 AND accionista_id = $2", [req.params.id, accionistaId]);
  if (!result.rowCount) throw new ApiError(404, "Fomento no encontrado o no pertenece al accionista activo");
  res.json({ ok: true });
}));

// ── Entregas (dinero entregado al agricultor) ────────────────────────────────
fomentosRouter.post("/:id/entregas", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const fomentoId = String(req.params.id);
  const data = entregaSchema.parse(req.body);

  // Validación de la fila de saldo arrastrado: requiere N meses de interés fijo.
  if (data.es_saldo_anterior && !(data.meses_interes_fijo && data.meses_interes_fijo >= 1)) {
    throw new ApiError(400, "Indica cuántos meses de interés fijo cobrar al saldo de cosecha pasada.");
  }

  const result = await inTransaction(async (client) => {
    await assertFomentoAccionista(client, fomentoId, accionistaId);
    // El saldo arrastrado no depende de la fecha; se deja en CURRENT_DATE (default).
    const entrega = await client.query(
      `INSERT INTO fomento_entregas (fomento_id, fecha, valor, concepto, es_saldo_anterior, meses_interes_fijo)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6) RETURNING *`,
      [fomentoId, data.fecha ?? null, data.valor,
       data.concepto ?? (data.es_saldo_anterior ? "Saldo en contra cosecha pasada" : null),
       data.es_saldo_anterior ?? false,
       data.es_saldo_anterior ? (data.meses_interes_fijo ?? null) : null]
    );

    // Un saldo ARRASTRADO no es un desembolso nuevo de caja: no genera egreso.
    if (data.cash_register_id && !data.es_saldo_anterior) {
      const fomento = await client.query(
        "SELECT farmer_name FROM fomentos WHERE id = $1",
        [fomentoId]
      );
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description)
         VALUES ($1, 'EXPENSE', 'FOMENTO_ENTREGA', 'fomento_entregas', $2, $3, $4)`,
        [data.cash_register_id, entrega.rows[0].id, data.valor,
         `Fomento entregado a ${fomento.rows[0]?.farmer_name ?? "agricultor"}`]
      );
    }
    return entrega.rows[0];
  });

  res.status(201).json(result);
}));

fomentosRouter.delete("/:fomentoId/entregas/:id", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const fomentoId = String(req.params.fomentoId);
  const entregaId = String(req.params.id);
  await inTransaction(async (client) => {
    await assertFomentoAccionista(client, fomentoId, accionistaId);
    // La entrega debe existir en ESTE fomento (lock para serializar).
    const entrega = (await client.query(
      "SELECT valor FROM fomento_entregas WHERE id=$1 AND fomento_id=$2 FOR UPDATE",
      [entregaId, fomentoId]
    )).rows[0];
    if (!entrega) throw new ApiError(404, "Entrega no encontrada");

    // Integridad: lo entregado NUNCA puede quedar por debajo de lo ya pagado.
    const pagado = Number((await client.query(
      "SELECT COALESCE(SUM(valor),0)::float AS t FROM fomento_pagos WHERE fomento_id=$1", [fomentoId]
    )).rows[0].t);
    const entregasRestantes = Number((await client.query(
      "SELECT COALESCE(SUM(valor),0)::float AS t FROM fomento_entregas WHERE fomento_id=$1 AND id<>$2", [fomentoId, entregaId]
    )).rows[0].t);
    if (pagado > 0.005 && entregasRestantes < pagado - 0.005) {
      throw new ApiError(400, "No se puede eliminar la entrega porque excede los pagos ya registrados en este fomento.");
    }

    await client.query("DELETE FROM fomento_entregas WHERE id=$1 AND fomento_id=$2", [entregaId, fomentoId]);
  });
  res.json({ ok: true });
}));

// ── Pagos (agricultor paga su deuda) ────────────────────────────────────────
fomentosRouter.post("/:id/pagos", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const fomentoId = String(req.params.id);
  const data = pagoSchema.parse(req.body);

  const result = await inTransaction(async (client) => {
    await assertFomentoAccionista(client, fomentoId, accionistaId);
    const pago = await client.query(
      `INSERT INTO fomento_pagos (fomento_id, cash_register_id, fecha, valor, concepto)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [fomentoId, data.cash_register_id ?? null, data.fecha, data.valor,
       data.concepto ?? null]
    );

    // Si hay caja, registrar el ingreso
    if (data.cash_register_id) {
      const fomento = await client.query(
        "SELECT farmer_name FROM fomentos WHERE id = $1",
        [fomentoId]
      );
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description)
         VALUES ($1, 'INCOME', 'PAGO_FOMENTO', 'fomento_pagos', $2, $3, $4)`,
        [data.cash_register_id, pago.rows[0].id, data.valor,
         `Pago de fomento de ${fomento.rows[0]?.farmer_name ?? "agricultor"}`]
      );
    }
    return pago.rows[0];
  });

  res.status(201).json(result);
}));

fomentosRouter.delete("/:fomentoId/pagos/:id", asyncRoute(async (req, res) => {
  const accionistaId = getAccionistaId(req);
  const fomentoId = String(req.params.fomentoId);
  await inTransaction(async (client) => {
    await assertFomentoAccionista(client, fomentoId, accionistaId);
    await client.query("DELETE FROM fomento_pagos WHERE id=$1 AND fomento_id=$2",
      [req.params.id, fomentoId]);
  });
  res.json({ ok: true });
}));
