import { describe, expect, it } from "vitest";
import { armarResultado, etiquetaGasto, notasDelPeriodo, rangoMes, type LineaCruda } from "./campo-resultados.js";

const activos = [
  { id: "cos8", nombre: "COS.8", tipo: "cosechadora" },
  { id: "plat", nombre: "PLATAFORMA", tipo: "camion" }
];
const L = (clase: "ingreso" | "gasto", clave: string, activo_id: string | null, monto: number, grupo: boolean | null = null): LineaCruda =>
  ({ clase, clave, activo_id, monto, grupo });

describe("armarResultado (estado de resultados de Transporte y Cosechadora)", () => {
  const lineas = [
    L("ingreso", "Servicios de cosecha", "cos8", 1000, true),
    L("ingreso", "Servicios de cosecha", "cos8", 500, false),
    L("ingreso", "Servicios de flete y transporte", "plat", 300, false),
    L("ingreso", "Otros ingresos de caja", null, 50),
    L("gasto", "DIESEL", "cos8", 400),
    L("gasto", "NOMINA", "cos8", 250),
    L("gasto", "REPARACION_MANT", "plat", 350),
    L("gasto", "DIESEL", "plat", 100),
    L("gasto", "VIATICOS", null, 60),
    L("gasto", "DIESEL", "cos8", -20) // reversión de un gasto
  ];
  const r = armarResultado(lineas, activos, new Map([["cos8", 120]]));

  it("suma ingresos por concepto y separa grupo vs terceros", () => {
    expect(r.ingresos.total).toBe(1850);
    expect(r.ingresos.lineas.find((l) => l.concepto === "Servicios de cosecha")?.monto).toBe(1500);
    expect(r.ingresos.del_grupo).toBe(1000);
    expect(r.ingresos.de_terceros).toBe(850);
  });

  it("costos con máquina = directos; sin máquina = gastos generales; las reversiones restan", () => {
    expect(r.costos_directos.total).toBe(1080);
    expect(r.costos_directos.lineas[0]).toEqual({ concepto: "Combustible · diésel", monto: 480 });
    expect(r.gastos_generales.total).toBe(60);
    expect(r.gastos_generales.lineas[0].concepto).toBe("Viáticos");
  });

  it("utilidad bruta, resultado y margen", () => {
    expect(r.utilidad_bruta).toBe(770);
    expect(r.resultado).toBe(710);
    expect(r.margen_pct).toBe(38.4);
    expect(r.combustible).toBe(480);
  });

  it("resultado por máquina con QQ, ordenado de mayor a menor", () => {
    expect(r.por_maquina.map((m) => m.nombre)).toEqual(["COS.8", "PLATAFORMA"]);
    const cos = r.por_maquina[0];
    expect([cos.ingresos, cos.costos, cos.resultado, cos.qq]).toEqual([1500, 630, 870, 120]);
    expect(r.por_maquina[1].resultado).toBe(-150);
    expect(r.por_maquina[1].margen_pct).toBe(-50);
  });

  it("sin movimientos: todo en cero y margen nulo", () => {
    const v = armarResultado([], activos);
    expect([v.ingresos.total, v.resultado, v.margen_pct, v.por_maquina.length]).toEqual([0, 0, null, 0]);
  });
});

describe("rangoMes", () => {
  it("mes normal, febrero bisiesto y enero (mes anterior en el año previo)", () => {
    expect(rangoMes("2026-10")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31", anterior: { mes: "2026-09", desde: "2026-09-01", hasta: "2026-09-30" } });
    expect(rangoMes("2028-02").hasta).toBe("2028-02-29");
    expect(rangoMes("2027-01").anterior).toEqual({ mes: "2026-12", desde: "2026-12-01", hasta: "2026-12-31" });
  });
});

describe("etiquetaGasto", () => {
  it("nombres legibles", () => {
    expect(etiquetaGasto("DIESEL")).toBe("Combustible · diésel");
    expect(etiquetaGasto("REPARACION_MANT")).toBe("Reparaciones y mantenimiento");
    expect(etiquetaGasto("MANTENIMIENTO_FLOTA")).toBe("Reparaciones y mantenimiento");
    expect(etiquetaGasto("PEAJES_Y_PESAJE")).toBe("Peajes y pesaje");
  });
});

describe("notasDelPeriodo", () => {
  const info = { cobrado: 900, vales_por_rendir: 80, vales_cantidad: 2, compras_credito: 0, qq_trabajados: 120 };
  it("ganancia, comparación, máquina en pérdida, vales, cobros y depreciación", () => {
    const r = armarResultado([
      L("ingreso", "Servicios de cosecha", "cos8", 1000, true),
      L("gasto", "DIESEL", "cos8", 300),
      L("gasto", "REPARACION_MANT", "plat", 200),
      L("gasto", "OTROS", null, 150)
    ], activos);
    const n = notasDelPeriodo(r, { resultado: 100, ingresos: 800 }, info);
    expect(n[0]).toMatch(/GANANCIA de \$350\.00/);
    expect(n.join(" ")).toMatch(/mejoró en \$250\.00/);
    expect(n.join(" ")).toMatch(/PLATAFORMA \(−\$200\.00\)/);
    expect(n.join(" ")).toMatch(/no tiene máquina asignada/);
    expect(n.join(" ")).toMatch(/vale\(s\) por rendir/);
    expect(n.join(" ")).toMatch(/depreciación/);
  });
  it("pérdida", () => {
    const r = armarResultado([L("ingreso", "Servicios de cosecha", "cos8", 100), L("gasto", "DIESEL", "cos8", 300)], activos);
    expect(notasDelPeriodo(r, null, { ...info, vales_por_rendir: 0 })[0]).toMatch(/PÉRDIDA de \$200\.00/);
  });
  it("sin movimientos", () => {
    expect(notasDelPeriodo(armarResultado([], activos), null, info)).toEqual(["Sin movimientos en el período."]);
  });
});
