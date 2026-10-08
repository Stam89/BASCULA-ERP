import { describe, expect, it } from "vitest";
import { REGLAS_CONSISTENCIA, resumirIntegridad } from "./consistencia.js";
import { construirTareas, type DatosHoy } from "./hoy.js";
import { construirResumen, type DatosResumen } from "./resumen-diario.js";

describe("reglas de integridad", () => {
  it("tienen nombre único, módulo y son solo consultas de lectura", () => {
    const nombres = REGLAS_CONSISTENCIA.map((r) => r.nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const r of REGLAS_CONSISTENCIA) {
      expect(r.modulo.length).toBeGreaterThan(1);
      expect(r.sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(r.sql.replace(/'[^']*'/g, ""))).toBe(false);
    }
  });

  it("un control que no pudo correr no cuenta como falla; uno con filas sí", () => {
    const r = resumirIntegridad({
      reglas: 3, revisado_at: "2026-10-07T12:00:00Z", ms: 5,
      hallazgos: [
        { regla: "A", modulo: "Caja", total: 2, filas: [{ id: 1 }] },
        { regla: "B", modulo: "Banco", error: "tabla no existe" }
      ]
    });
    expect(r).toEqual({ reglas: 3, problemas: 1, nombres: ["A"] });
  });
});

const hoyBase: DatosHoy = {
  dow: 2, caja: { abierta: true, diasAbierta: 0 }, tuneles: { enProceso: [], motoresSinCombustible: [] },
  nomina: { aplica: false, monto: 0, personas: 0, bajadasSinNombre: 0, nombresPorRevisar: 0 },
  cxc: { n: 0, monto: 0 }, cxp: { n: 0, monto: 0 }, pedidos: { pendientes: 0, paraHoy: 0 }, puesta: { aplica: false, faltantes: [] }
};

describe("integridad en «Hoy»", () => {
  it("sin problemas no hay tarea; con problemas es urgente y va primero", () => {
    expect(construirTareas({ ...hoyBase, integridad: { problemas: 0, nombres: [] } })).toEqual([]);
    expect(construirTareas(hoyBase)).toEqual([]);
    const t = construirTareas({ ...hoyBase, caja: { abierta: false, diasAbierta: 0 }, integridad: { problemas: 3, nombres: ["CxC: saldo", "Cajas", "Ventas"] } });
    expect(t[0]).toMatchObject({ key: "integridad", nivel: "urgente", tab: "Configuracion", sub: "integridad" });
    expect(t[0].titulo).toBe("3 controles de integridad fallan");
    expect(t[0].detalle).toContain("y 1 más");
  });
});

const resumenBase: DatosResumen = {
  negocio: "PILADORA", fecha: "2026-10-07", tickets: { n: 0, qq: 0 }, secado: { terminados: [], enProceso: [] },
  caja: { abierta: true, ingresos: 0, egresos: 0 }, ventas: { n: 0, total: 0 }, tareas: []
};

describe("integridad en el resumen diario", () => {
  it("no aparece si no se pidió; avisa cuando todo está bien, cuando falla o no se pudo leer", () => {
    expect(construirResumen(resumenBase).texto).not.toContain("Integridad");
    expect(construirResumen({ ...resumenBase, integridad: { reglas: 37, problemas: 0, nombres: [] } }).texto).toContain("Todo conectado: 37 controles sin problemas");
    const mal = construirResumen({ ...resumenBase, integridad: { reglas: 37, problemas: 2, nombres: ["CxC: saldo", "Cajas"] } }).texto;
    expect(mal).toContain("2 de 37 controles fallan");
    expect(mal).toContain("• CxC: saldo");
    expect(construirResumen({ ...resumenBase, integridad: null }).texto).toContain("No se pudo leer este dato");
  });
});
