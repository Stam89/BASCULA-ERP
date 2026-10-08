import { describe, expect, it } from "vitest";
import { construirAlertas, type DatosAlertasCampo } from "./campo-alertas.js";

const vacio: DatosAlertasCampo = {
  vales: { n: 0, monto: 0, diasMasViejo: 0 },
  mantenimientos: { vencidos: [], proximos: [] },
  partesPorCobrar: { n: 0, qq: 0, diasMasViejo: 0 },
  operadoresSinPagar: { operadores: 0, partes: 0, diasMasViejo: 0 },
  cartera: { monto: 0, clientes: 0, montoMas30: 0 }
};

describe("alertas de Transporte y Cosechadora", () => {
  it("sin nada pendiente no hay alertas", () => {
    expect(construirAlertas(vacio)).toEqual([]);
  });

  it("un vale reciente es informativo y uno viejo pide atención", () => {
    const reciente = construirAlertas({ ...vacio, vales: { n: 2, monto: 45.5, diasMasViejo: 3 } });
    expect(reciente[0]).toMatchObject({ key: "vales-sin-rendir", nivel: "info", seccion: "vales" });
    expect(reciente[0].titulo).toBe("2 vales sin rendir por $45.50");
    const viejo = construirAlertas({ ...vacio, vales: { n: 1, monto: 10, diasMasViejo: 9 } });
    expect(viejo[0].nivel).toBe("atencion");
    expect(viejo[0].detalle).toContain("9 días");
  });

  it("mantenimiento vencido va primero, con el nombre de la máquina", () => {
    const r = construirAlertas({
      ...vacio,
      vales: { n: 1, monto: 5, diasMasViejo: 1 },
      mantenimientos: { vencidos: [{ maquina: "TOYOTA AZUL", tipo: "CAMBIO_ACEITE", fecha: "2026-09-20" }], proximos: [] }
    });
    expect(r[0].key).toBe("mantenimiento-vencido");
    expect(r[0].titulo).toBe("Mantenimiento vencido: TOYOTA AZUL");
    expect(r[0].detalle).toContain("cambio aceite");
    expect(r[0].detalle).toContain("20/09/2026");
  });

  it("la cartera avisa cuánto pasa de 30 días", () => {
    const r = construirAlertas({ ...vacio, cartera: { monto: 300, clientes: 2, montoMas30: 120 } });
    expect(r[0]).toMatchObject({ nivel: "atencion", seccion: "cxc" });
    expect(r[0].detalle).toContain("$120.00");
    const sinViejo = construirAlertas({ ...vacio, cartera: { monto: 300, clientes: 1, montoMas30: 0 } });
    expect(sinViejo[0].nivel).toBe("info");
  });

  it("ordena: atención antes que información, sin mezclar el orden interno", () => {
    const r = construirAlertas({
      vales: { n: 1, monto: 5, diasMasViejo: 1 },
      mantenimientos: { vencidos: [], proximos: [{ maquina: "A", tipo: "PREVENTIVO", fecha: "2026-10-20" }] },
      partesPorCobrar: { n: 3, qq: 120, diasMasViejo: 20 },
      operadoresSinPagar: { operadores: 1, partes: 2, diasMasViejo: 2 },
      cartera: { monto: 10, clientes: 1, montoMas30: 0 }
    });
    expect(r.map((x) => x.nivel)).toEqual(["atencion", "info", "info", "info", "info"]);
    expect(r[0].key).toBe("partes-por-cobrar");
  });
});
