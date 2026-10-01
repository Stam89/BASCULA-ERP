import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";

/**
 * EQUIPO / MÁQUINA de la planta = una SECCIÓN del catálogo de mantenimiento
 * (maintenance_categories kind 'SECTION', con su área: PILADORA › DESCASCARADOR).
 * Su id es el `maquina_id` que envían los formularios de Caja; la hoja de vida
 * (equipment_maintenance) guarda el área y la sección como texto.
 */
export type Maquina = { id: string; area: string; section: string };

export async function resolverMaquina(client: Pick<PoolClient, "query">, maquinaId: string): Promise<Maquina> {
  const r = await client.query(
    "SELECT id, nombre, area FROM maintenance_categories WHERE id = $1 AND kind = 'SECTION'",
    [maquinaId]
  );
  const m = r.rows[0] as { id: string; nombre: string; area: string | null } | undefined;
  if (!m || !m.area) throw new ApiError(404, "Equipo / máquina no encontrado: elígelo de la lista.");
  return { id: m.id, area: m.area, section: m.nombre };
}

export const etiquetaMaquina = (m: Pick<Maquina, "area" | "section">) => `${m.area} › ${m.section}`;
