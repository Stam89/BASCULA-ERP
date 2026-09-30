import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { calcularResultadoMensual, CATEGORIAS_NO_OPERATIVAS } from "../../services/resultado-mensual.js";
import { inTransaction } from "../../db/transaction.js";

// 📊 Resultado mensual de CEYRO (costos por QQ vs estimado, ingresos adicionales
// y resultado neto). Exclusivo de la Matriz. Lee los módulos existentes; solo
// escribe en sus propias tablas (costo_rubros y resultado_mensual_manual).
export const resultadoMensualRouter = Router();

async function exigirMatriz(req: AuthenticatedRequest): Promise<string> {
  const id = req.accionistaId ?? null;
  if (!id) throw new ApiError(400, "Selecciona un accionista antes de continuar.");
  const r = await pool.query("SELECT tipo FROM accionistas WHERE id = $1", [id]);
  if (r.rows[0]?.tipo !== "MATRIZ") throw new ApiError(403, "El resultado mensual es de la Matriz.");
  return id;
}

resultadoMensualRouter.get("/", asyncRoute(async (req, res) => {
  const matrizId = await exigirMatriz(req as AuthenticatedRequest);
  const q = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    qq: z.coerce.number().nonnegative().optional()   // QQ de cáscara manual (opcional)
  }).parse(req.query);
  res.json(await calcularResultadoMensual(pool, { year: q.year, month: q.month, matrizId, qqManual: q.qq }));
}));

// ── Rubros: costo estimado $/QQ + CATEGORÍAS de Caja + TIPOS de pago de nómina ──
// Regla: el egreso entra al rubro de la categoría con que se registró en Caja;
// la nómina (una sola categoría) se reparte por tipo de pago. Crear o renombrar
// un rubro crea/renombra su categoría de Caja (sin duplicar).
const TIPOS_NOMINA_VALIDOS = ["SUELDO_ADMIN", "CUADRILLA", "PILADOR", "ESTIBADOR", "SECADOR", "POLVILLO"] as const;
// Categorías que no se renombran desde un rubro (las usan varios flujos).
const CATEGORIAS_PROTEGIDAS = ["PAGO_MANO_OBRA"];

const codigoDesdeNombre = (nombre: string) =>
  nombre.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "RUBRO";

resultadoMensualRouter.get("/rubros", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const r = await pool.query(
    "SELECT id, nombre, costo_estimado_qq::float AS costo_estimado_qq, claves, categorias, nomina, orden, activo FROM costo_rubros ORDER BY orden, nombre"
  );
  res.json(r.rows);
}));

// Categorías de EGRESO de la Matriz que pueden ser costo operativo (para enlazar).
// Incluye las ocultas en Caja (activo = false): siguen siendo del rubro.
resultadoMensualRouter.get("/categorias-caja", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const r = await pool.query(
    `SELECT codigo, nombre, activo, aplicable_a FROM cash_categories
      WHERE tipo = 'EGRESO' AND aplicable_a IN ('MATRIZ', 'AMBOS')
        AND NOT (codigo = ANY ($1::text[]))
      ORDER BY nombre`,
    [[...CATEGORIAS_NO_OPERATIVAS, ...CATEGORIAS_PROTEGIDAS]]
  );
  res.json(r.rows);
}));

// Mostrar u ocultar un rubro en Caja → ➕ Nuevo movimiento. Para rubros que se
// llenan desde otro módulo (Nómina, etc.): su categoría propia se desactiva y deja
// de salir en el formulario de Caja. No borra nada: lo registrado se conserva y
// sigue contando en el reporte. Categorías propias = las enlazadas al rubro y la
// que tiene su mismo nombre (la que se crea con el rubro) si no es de otro rubro.
resultadoMensualRouter.patch("/rubros/:id/caja", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = z.object({ mostrar: z.boolean() }).parse(req.body);
  const out = await inTransaction(async (client) => {
    const rubro = await client.query("SELECT id, nombre, categorias FROM costo_rubros WHERE id = $1", [req.params.id]);
    if (!rubro.rowCount) throw new ApiError(404, "Rubro no encontrado");
    const cats = await client.query(
      `UPDATE cash_categories SET activo = $3
        WHERE tipo = 'EGRESO' AND aplicable_a IN ('MATRIZ', 'AMBOS')
          AND NOT (codigo = ANY ($4::text[]))
          AND (codigo = ANY ($1::text[])
               OR (translate(lower(nombre), 'áéíóú', 'aeiou') = translate(lower($2), 'áéíóú', 'aeiou')
                   AND NOT EXISTS (SELECT 1 FROM costo_rubros o WHERE o.id <> $5 AND o.activo AND cash_categories.codigo = ANY (o.categorias))))
        RETURNING codigo, nombre`,
      [rubro.rows[0].categorias ?? [], rubro.rows[0].nombre, body.mostrar, [...CATEGORIAS_NO_OPERATIVAS, ...CATEGORIAS_PROTEGIDAS], rubro.rows[0].id]
    );
    if (!cats.rowCount) throw new ApiError(400, "Este rubro no tiene una categoría propia en Caja (se llena desde Nómina u otro módulo).");
    return { ok: true, mostrar: body.mostrar, categorias: cats.rows.map((c) => c.nombre as string) };
  });
  res.json(out);
}));

resultadoMensualRouter.post("/rubros", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = z.object({
    nombre: z.string().trim().min(2).max(80),
    costo_estimado_qq: z.number().nonnegative().max(1000).default(0),
    categorias: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
    // Si no se eligió una categoría existente, se crea en Caja con el mismo nombre.
    crear_categoria: z.boolean().default(true)
  }).parse(req.body);
  const out = await inTransaction(async (client) => {
    let categorias = body.categorias.map((c) => c.toUpperCase());
    let categoriaCreada: string | null = null;
    if (!categorias.length && body.crear_categoria) {
      const existe = await client.query(
        "SELECT codigo FROM cash_categories WHERE translate(lower(nombre), 'áéíóú', 'aeiou') = translate(lower($1), 'áéíóú', 'aeiou') LIMIT 1",
        [body.nombre]
      );
      if (existe.rowCount) {
        categorias = [existe.rows[0].codigo];
      } else {
        let codigo = codigoDesdeNombre(body.nombre);
        if ((await client.query("SELECT 1 FROM cash_categories WHERE codigo = $1", [codigo])).rowCount) codigo = `${codigo.slice(0, 34)}_${Date.now().toString(36).slice(-4).toUpperCase()}`;
        await client.query(
          "INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a) VALUES ($1, $2, 'EGRESO', 'MATRIZ')",
          [codigo, body.nombre]
        );
        categorias = [codigo];
        categoriaCreada = body.nombre;
      }
    }
    // Una categoría pertenece a un solo rubro: se quita de los demás.
    if (categorias.length) {
      await client.query("UPDATE costo_rubros SET categorias = ARRAY(SELECT c FROM unnest(categorias) c WHERE NOT (c = ANY ($1::text[])))", [categorias]);
    }
    const orden = Number((await client.query("SELECT COALESCE(MAX(orden), 0) + 1 AS o FROM costo_rubros")).rows[0].o);
    const r = await client.query(
      `INSERT INTO costo_rubros (nombre, costo_estimado_qq, categorias, orden) VALUES ($1, $2, $3, $4)
       ON CONFLICT (upper(nombre)) DO UPDATE SET activo = true, costo_estimado_qq = EXCLUDED.costo_estimado_qq,
         categorias = (SELECT ARRAY(SELECT DISTINCT unnest(costo_rubros.categorias || EXCLUDED.categorias)))
       RETURNING id, nombre`,
      [body.nombre, body.costo_estimado_qq, categorias, orden]
    );
    return { ...r.rows[0], categoria_creada: categoriaCreada };
  });
  res.status(201).json(out);
}));

resultadoMensualRouter.patch("/rubros/:id", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = z.object({
    nombre: z.string().trim().min(2).max(80).optional(),
    costo_estimado_qq: z.number().nonnegative().max(1000).optional(),
    claves: z.array(z.string().trim().min(2).max(60)).max(40).optional(),
    categorias: z.array(z.string().trim().min(2).max(40)).max(10).optional(),
    nomina: z.array(z.enum(TIPOS_NOMINA_VALIDOS)).optional(),
    activo: z.boolean().optional()
  }).parse(req.body);
  const out = await inTransaction(async (client) => {
    const actual = await client.query("SELECT id, nombre, categorias FROM costo_rubros WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!actual.rowCount) throw new ApiError(404, "Rubro no encontrado");
    const categorias = body.categorias?.map((c) => c.toUpperCase());
    // Una categoría / tipo de nómina pertenece a un solo rubro.
    if (categorias?.length) {
      await client.query("UPDATE costo_rubros SET categorias = ARRAY(SELECT c FROM unnest(categorias) c WHERE NOT (c = ANY ($2::text[]))) WHERE id <> $1", [req.params.id, categorias]);
    }
    if (body.nomina?.length) {
      await client.query("UPDATE costo_rubros SET nomina = ARRAY(SELECT t FROM unnest(nomina) t WHERE NOT (t = ANY ($2::text[]))) WHERE id <> $1", [req.params.id, body.nomina]);
    }
    await client.query(
      `UPDATE costo_rubros SET
         nombre = COALESCE($2, nombre),
         costo_estimado_qq = COALESCE($3, costo_estimado_qq),
         claves = COALESCE($4, claves),
         categorias = COALESCE($5, categorias),
         nomina = COALESCE($6, nomina),
         activo = COALESCE($7, activo)
       WHERE id = $1`,
      [req.params.id, body.nombre ?? null, body.costo_estimado_qq ?? null, body.claves ?? null,
       categorias ?? null, body.nomina ?? null, body.activo ?? null]
    );
    // Renombrar el rubro renombra también su categoría de Caja (si es solo suya).
    let categoriaRenombrada: string | null = null;
    const cats: string[] = categorias ?? actual.rows[0].categorias ?? [];
    if (body.nombre && body.nombre !== actual.rows[0].nombre && cats.length === 1 && !CATEGORIAS_PROTEGIDAS.includes(cats[0])) {
      const choca = await client.query(
        "SELECT 1 FROM cash_categories WHERE codigo <> $1 AND translate(lower(nombre), 'áéíóú', 'aeiou') = translate(lower($2), 'áéíóú', 'aeiou')",
        [cats[0], body.nombre]
      );
      if (!choca.rowCount) {
        const up = await client.query("UPDATE cash_categories SET nombre = $2 WHERE codigo = $1 RETURNING nombre", [cats[0], body.nombre]);
        categoriaRenombrada = up.rows[0]?.nombre ?? null;
      }
    }
    return { ok: true, categoria_renombrada: categoriaRenombrada };
  });
  res.json(out);
}));

// Clasificar un egreso «Sin clasificar» desde el reporte: su CATEGORÍA de Caja
// (o su tipo de pago de nómina) pasa a ese rubro. Desde ese momento todos los
// egresos con esa categoría/tipo cuentan ahí.
resultadoMensualRouter.post("/rubros/:id/asignar", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = z.object({
    categoria_codigo: z.string().trim().min(2).max(40).optional(),
    tipo_nomina: z.enum(TIPOS_NOMINA_VALIDOS).optional(),
    clave: z.string().trim().min(2).max(60).optional()
  }).parse(req.body);
  await inTransaction(async (client) => {
    if (body.tipo_nomina) {
      await client.query("UPDATE costo_rubros SET nomina = array_remove(nomina, $1)", [body.tipo_nomina]);
      await client.query("UPDATE costo_rubros SET nomina = array_append(nomina, $2) WHERE id = $1", [req.params.id, body.tipo_nomina]);
    } else if (body.categoria_codigo && !CATEGORIAS_PROTEGIDAS.includes(body.categoria_codigo.toUpperCase())) {
      const cod = body.categoria_codigo.toUpperCase();
      await client.query("UPDATE costo_rubros SET categorias = array_remove(categorias, $1)", [cod]);
      await client.query("UPDATE costo_rubros SET categorias = array_append(categorias, $2) WHERE id = $1", [req.params.id, cod]);
    } else if (body.clave) {
      await client.query(
        `UPDATE costo_rubros SET claves = array_append(claves, $2)
          WHERE id = $1 AND NOT (lower($2) = ANY (SELECT lower(c) FROM unnest(claves) c))`,
        [req.params.id, body.clave]
      );
    } else {
      throw new ApiError(400, "Indica la categoría o el tipo de pago a asignar.");
    }
  });
  res.json({ ok: true });
}));

// Compatibilidad con la versión anterior (agregar una palabra clave).
resultadoMensualRouter.post("/rubros/:id/claves", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = z.object({ clave: z.string().trim().min(2).max(60) }).parse(req.body);
  const r = await pool.query(
    `UPDATE costo_rubros SET claves = array_append(claves, $2)
      WHERE id = $1 AND NOT (lower($2) = ANY (SELECT lower(c) FROM unnest(claves) c))
      RETURNING id`,
    [req.params.id, body.clave]
  );
  res.json({ agregado: (r.rowCount ?? 0) > 0 });
}));

// ── Montos manuales del mes (gastos financieros e ingresos adicionales) ─────
resultadoMensualRouter.post("/manual", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = z.object({
    periodo: z.string().regex(/^\d{4}-\d{2}$/),
    seccion: z.enum(["INGRESO", "FINANCIERO"]),
    concepto: z.string().trim().min(2).max(120),
    monto: z.number().nonnegative(),
    nota: z.string().trim().max(300).optional()
  }).parse(req.body);
  const r = await pool.query(
    `INSERT INTO resultado_mensual_manual (periodo, seccion, concepto, monto, nota, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [body.periodo, body.seccion, body.concepto, body.monto, body.nota ?? null, (req as AuthenticatedRequest).user?.id ?? null]
  );
  res.status(201).json(r.rows[0]);
}));

resultadoMensualRouter.delete("/manual/:id", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  await pool.query("DELETE FROM resultado_mensual_manual WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));
