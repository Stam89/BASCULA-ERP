import { describe, expect, it } from "vitest";
import { construirTareas, HORAS_TUNEL_LARGO, type DatosHoy } from "./hoy.js";

const base = (): DatosHoy => ({
  dow: 2,
  caja: { abierta: true, diasAbierta: 0 },
  tuneles: { enProceso: [], motoresSinCombustible: [] },
  nomina: { aplica: true, monto: 0, personas: 0, bajadasSinNombre: 0, nombresPorRevisar: 0 },
  cxc: { n: 0, monto: 0 },
  cxp: { n: 0, monto: 0 },
  pedidos: { pendientes: 0, paraHoy: 0 },
  puesta: { aplica: false, faltantes: [] }
});
const keys = (d: DatosHoy) => construirTareas(d).map((t) => t.key);

describe("construirTareas («Hoy»)", () => {
  it("sin pendientes no hay tareas", () => {
    expect(construirTareas(base())).toEqual([]);
  });

  it("caja: sin caja abierta pide abrirla; abierta desde ayer pide cerrarla; abierta de hoy no dice nada", () => {
    expect(keys({ ...base(), caja: { abierta: false, diasAbierta: 0 } })).toEqual(["caja-cerrada"]);
    const vieja = construirTareas({ ...base(), caja: { abierta: true, diasAbierta: 1 } });
    expect(vieja.map((t) => t.key)).toEqual(["caja-vieja"]);
    expect(vieja[0].titulo).toMatch(/desde ayer/);
    expect(construirTareas({ ...base(), caja: { abierta: true, diasAbierta: 3 } })[0].titulo).toMatch(/3 días/);
  });

  it("falta combustible → urgente y va primero, antes que cualquier otra cosa", () => {
    const t = construirTareas({
      ...base(),
      caja: { abierta: false, diasAbierta: 0 },
      cxc: { n: 2, monto: 50 },
      tuneles: { enProceso: [], motoresSinCombustible: [1] }
    });
    expect(t[0]).toMatchObject({ key: "combustible-motor-1", nivel: "urgente", tab: "Secadoras" });
    expect(t.map((x) => x.nivel)).toEqual(["urgente", "atencion", "atencion"]);
  });

  it("túneles: informativo normal; con más de 18 h pasa a atención y los nombra", () => {
    const normal = construirTareas({ ...base(), tuneles: { enProceso: [{ tunel: 1, motor: 1, horas: 5 }, { tunel: 2, motor: 1, horas: 4.2 }], motoresSinCombustible: [] } });
    expect(normal).toHaveLength(1);
    expect(normal[0]).toMatchObject({ key: "tuneles-en-proceso", nivel: "info", titulo: "2 túneles secando" });
    const largo = construirTareas({ ...base(), tuneles: { enProceso: [{ tunel: 1, motor: 1, horas: HORAS_TUNEL_LARGO + 2 }, { tunel: 2, motor: 1, horas: 3 }], motoresSinCombustible: [] } });
    expect(largo[0]).toMatchObject({ key: "tuneles-largos", nivel: "atencion" });
    expect(largo[0].titulo).toBe("El Túnel 1 lleva 20 h secando");
    expect(largo[0].detalle).not.toMatch(/Túnel 2/);
  });

  it("nómina: monto pendiente es informativo entre semana y de atención viernes/sábado", () => {
    const d = { ...base(), nomina: { aplica: true, monto: 90.41, personas: 8, bajadasSinNombre: 0, nombresPorRevisar: 0 } };
    const martes = construirTareas({ ...d, dow: 2 })[0];
    expect(martes).toMatchObject({ key: "nomina-pendiente", nivel: "info", tab: "Nomina", sub: "pagos" });
    expect(martes.titulo).toBe("Por pagar en Nómina: $90.41");
    expect(martes.detalle).toMatch(/8 personas/);
    for (const dow of [5, 6]) {
      const t = construirTareas({ ...d, dow })[0];
      expect(t.nivel).toBe("atencion");
      expect(t.detalle).toMatch(/toca pagar la semana/);
    }
  });

  it("bajadas sin nombre llevan a la sección de bajada de carro (singular y plural)", () => {
    const uno = construirTareas({ ...base(), nomina: { aplica: true, monto: 0, personas: 0, bajadasSinNombre: 1, nombresPorRevisar: 0 } })[0];
    expect(uno).toMatchObject({ key: "bajadas-sin-nombre", tab: "Nomina", sub: "bajada", titulo: "1 ticket sin quién bajó el carro" });
    expect(construirTareas({ ...base(), nomina: { aplica: true, monto: 0, personas: 0, bajadasSinNombre: 4, nombresPorRevisar: 0 } })[0].titulo).toBe("4 tickets sin quién bajó el carro");
  });

  it("nombres dudosos de la bajada: tarea de atención hacia la bajada de carro", () => {
    const t = construirTareas({ ...base(), nomina: { aplica: true, monto: 0, personas: 0, bajadasSinNombre: 0, nombresPorRevisar: 3 } })[0];
    expect(t).toMatchObject({ key: "bajadas-nombre-dudoso", nivel: "atencion", tab: "Nomina", sub: "bajada", titulo: "3 tickets con un nombre por revisar en bajada de carro" });
    expect(construirTareas({ ...base(), nomina: { aplica: true, monto: 0, personas: 0, bajadasSinNombre: 0, nombresPorRevisar: 1 } })[0].titulo).toBe("1 ticket con un nombre por revisar en bajada de carro");
  });

  it("un socio (nómina no aplica) no ve tareas de nómina aunque lleguen datos", () => {
    expect(keys({ ...base(), nomina: { aplica: false, monto: 500, personas: 3, bajadasSinNombre: 9, nombresPorRevisar: 5 } })).toEqual([]);
  });

  it("cuentas vencidas y pedidos: textos con cantidades y montos", () => {
    const t = construirTareas({ ...base(), cxc: { n: 1, monto: 12.5 }, cxp: { n: 3, monto: 300 }, pedidos: { pendientes: 2, paraHoy: 1 } });
    expect(t.find((x) => x.key === "cxc-vencidas")!.titulo).toBe("1 cobro vencido por $12.50");
    expect(t.find((x) => x.key === "cxp-vencidas")!.titulo).toBe("3 pagos vencidos por $300.00");
    const p = t.find((x) => x.key === "pedidos-pendientes")!;
    expect(p).toMatchObject({ nivel: "atencion", titulo: "2 pedidos por entregar" });
    expect(p.detalle).toMatch(/1 es para hoy o está atrasado/);
    expect(construirTareas({ ...base(), pedidos: { pendientes: 1, paraHoy: 0 } })[0].nivel).toBe("info");
  });

  it("puesta en marcha: solo administrador; muestra 3 pasos y cuenta los demás", () => {
    expect(keys({ ...base(), puesta: { aplica: false, faltantes: ["A"] } })).toEqual([]);
    expect(keys({ ...base(), puesta: { aplica: true, faltantes: [] } })).toEqual([]);
    const t = construirTareas({ ...base(), puesta: { aplica: true, faltantes: ["Inicio contable", "Banco", "Correo", "Firebase", "Otro"] } })[0];
    expect(t).toMatchObject({ key: "puesta-en-marcha", tab: "Configuracion", sub: "puesta" });
    expect(t.titulo).toBe("Faltan 5 pasos de la puesta en marcha");
    expect(t.detalle).toBe("Inicio contable · Banco · Correo · y 2 más.");
  });

  it("el orden respeta urgente → atención → info y es estable dentro de cada nivel", () => {
    const t = construirTareas({
      ...base(), dow: 2,
      caja: { abierta: false, diasAbierta: 0 },
      tuneles: { enProceso: [{ tunel: 1, motor: 1, horas: 2 }], motoresSinCombustible: [2] },
      nomina: { aplica: true, monto: 10, personas: 1, bajadasSinNombre: 2, nombresPorRevisar: 0 },
      cxc: { n: 1, monto: 5 }
    });
    expect(t.map((x) => x.key)).toEqual(["combustible-motor-2", "bajadas-sin-nombre", "caja-cerrada", "cxc-vencidas", "tuneles-en-proceso", "nomina-pendiente"]);
  });
});
