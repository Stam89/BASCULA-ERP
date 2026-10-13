import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { nombreNormal, nombreNormalSql } from "./agricultor-nombres.js";

type Db = Pick<PoolClient, "query">;

export type CompradorVentaDetalle = {
  full_name: string;
  customer_id?: string;
  farmer_id?: string;
  staff_id?: string;
  worker_key?: string;
};

/**
 * Directorio de mostrador: combina clientes, agricultores y personal sin
 * modificar ninguno de esos catálogos. Solo agrupa coincidencias EXACTAS del
 * nombre normalizado; nunca adivina una persona por parecido parcial.
 */
export async function listarPersonasVentaDetalle(db: Db, accionistaId: string | undefined) {
  const r = await db.query(
    `WITH personas AS (
       SELECT ${nombreNormalSql("c.full_name")} AS clave, c.full_name, c.phone,
              c.id AS customer_id, NULL::uuid AS farmer_id, NULL::uuid AS staff_id,
              NULL::text AS worker_key, c.descuento_qq::float AS descuento_qq,
              'Cliente'::text AS rol
         FROM customers c
       UNION ALL
       SELECT ${nombreNormalSql("f.full_name")}, f.full_name, f.phone,
              NULL::uuid, f.id, NULL::uuid, NULL::text, NULL::float,
              CASE WHEN EXISTS (SELECT 1 FROM fomentos fo WHERE fo.farmer_id = f.id)
                   THEN 'Agricultor · Fomento' ELSE 'Agricultor' END
         FROM farmers f WHERE f.is_active
       UNION ALL
       SELECT ${nombreNormalSql("s.worker_name")}, s.worker_name, NULL::varchar,
              NULL::uuid, NULL::uuid, s.id, NULL::text, NULL::float,
              concat('Trabajador', CASE WHEN btrim(s.cargo) = '' THEN '' ELSE ' · ' || s.cargo END)
         FROM admin_staff s WHERE s.is_active AND s.accionista_id = $1
       UNION ALL
       SELECT ${nombreNormalSql("w.worker_name")}, min(w.worker_name), NULL::varchar,
              NULL::uuid, NULL::uuid, NULL::uuid, ${nombreNormalSql("w.worker_name")}, NULL::float,
              concat('Trabajador · ', min(w.worker_role))
         FROM worker_payments w
        WHERE length(btrim(w.worker_name)) >= 2
        GROUP BY ${nombreNormalSql("w.worker_name")}
     )
     SELECT clave AS key,
            min(full_name) AS full_name,
            max(phone) AS phone,
            min(customer_id::text)::uuid AS customer_id,
            min(farmer_id::text)::uuid AS farmer_id,
            min(staff_id::text)::uuid AS staff_id,
            min(worker_key) AS worker_key,
            max(descuento_qq) AS descuento_qq,
            array_agg(DISTINCT rol ORDER BY rol) AS roles
       FROM personas
      WHERE length(clave) >= 2
      GROUP BY clave
      ORDER BY min(full_name)`,
    [accionistaId ?? null]
  );
  return r.rows;
}

async function clientePorNombreExacto(db: Db, nombre: string) {
  const r = await db.query(
    `SELECT id, full_name, descuento_qq::float AS descuento_qq
       FROM customers
      WHERE ${nombreNormalSql("full_name")} = ${nombreNormalSql("$1::text")}
      ORDER BY created_at, id
      LIMIT 2`,
    [nombre]
  );
  // Dos clientes con el mismo nombre pueden ser personas distintas: no se
  // enlazan automáticamente. Se crea un cliente separado para no mezclar CxC.
  return r.rowCount === 1 ? r.rows[0] : null;
}

async function fuenteOficial(db: Db, comprador: CompradorVentaDetalle, accionistaId: string | undefined) {
  if (comprador.farmer_id) {
    const r = await db.query(
      "SELECT id::text AS source_key, full_name, phone, identification FROM farmers WHERE id = $1 AND is_active",
      [comprador.farmer_id]
    );
    if (r.rows[0]) return { source_type: "FARMER", ...r.rows[0] };
  }
  if (comprador.staff_id) {
    const r = await db.query(
      `SELECT id::text AS source_key, worker_name AS full_name, NULL::text AS phone, NULL::text AS identification
         FROM admin_staff WHERE id = $1 AND accionista_id = $2 AND is_active`,
      [comprador.staff_id, accionistaId ?? null]
    );
    if (r.rows[0]) return { source_type: "ADMIN_STAFF", ...r.rows[0] };
  }
  if (comprador.worker_key) {
    const clave = nombreNormal(comprador.worker_key);
    const r = await db.query(
      `SELECT min(worker_name) AS full_name FROM worker_payments
        WHERE ${nombreNormalSql("worker_name")} = $1`,
      [clave]
    );
    if (r.rows[0]?.full_name) {
      return { source_type: "WORKER", source_key: clave, full_name: r.rows[0].full_name, phone: null, identification: null };
    }
  }
  return null;
}

/** Resuelve la persona elegida a customers dentro de la misma transacción de la venta. */
export async function resolverClienteVentaDetalle(
  db: Db,
  comprador: CompradorVentaDetalle,
  accionistaId: string | undefined
): Promise<{ id: string; full_name: string; descuento_qq: number | null }> {
  const nombreDigitado = comprador.full_name.trim().replace(/\s+/g, " ");
  if (nombreDigitado.length < 2) throw new ApiError(400, "Escriba o seleccione el nombre del cliente");

  if (comprador.customer_id) {
    const r = await db.query(
      "SELECT id, full_name, descuento_qq::float AS descuento_qq FROM customers WHERE id = $1",
      [comprador.customer_id]
    );
    if (!r.rows[0]) throw new ApiError(404, "El cliente seleccionado ya no existe");
    // Si el directorio ya reconoció que ese cliente también es agricultor o
    // trabajador, conserva el vínculo explícito para futuras ventas.
    const fuente = await fuenteOficial(db, comprador, accionistaId);
    if (fuente) {
      await db.query(
        `INSERT INTO customer_directory_links (customer_id, source_type, source_key, source_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_type, source_key) DO NOTHING`,
        [r.rows[0].id, fuente.source_type, fuente.source_key, fuente.full_name]
      );
    }
    return r.rows[0];
  }

  const fuente = await fuenteOficial(db, comprador, accionistaId);
  if (fuente) {
    const vinculo = await db.query(
      `SELECT c.id, c.full_name, c.descuento_qq::float AS descuento_qq
         FROM customer_directory_links l JOIN customers c ON c.id = l.customer_id
        WHERE l.source_type = $1 AND l.source_key = $2`,
      [fuente.source_type, fuente.source_key]
    );
    if (vinculo.rows[0]) return vinculo.rows[0];

    let cliente = null;
    if (fuente.identification) {
      const porIdentificacion = await db.query(
        "SELECT id, full_name, descuento_qq::float AS descuento_qq FROM customers WHERE identification = $1",
        [fuente.identification]
      );
      cliente = porIdentificacion.rows[0] ?? null;
    }
    cliente ??= await clientePorNombreExacto(db, fuente.full_name);
    if (!cliente) {
      const creado = await db.query(
        `INSERT INTO customers (full_name, phone, identification, customer_type)
         VALUES ($1, $2, $3, 'RETAIL')
         RETURNING id, full_name, descuento_qq::float AS descuento_qq`,
        [fuente.full_name, fuente.phone ?? null, fuente.identification ?? null]
      );
      cliente = creado.rows[0];
    }
    await db.query(
      `INSERT INTO customer_directory_links (customer_id, source_type, source_key, source_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_type, source_key) DO NOTHING`,
      [cliente.id, fuente.source_type, fuente.source_key, fuente.full_name]
    );
    return cliente;
  }

  const existente = await clientePorNombreExacto(db, nombreDigitado);
  if (existente) return existente;
  const creado = await db.query(
    `INSERT INTO customers (full_name, customer_type) VALUES ($1, 'RETAIL')
     RETURNING id, full_name, descuento_qq::float AS descuento_qq`,
    [nombreDigitado.toUpperCase()]
  );
  return creado.rows[0];
}
