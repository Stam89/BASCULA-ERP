import { describe, expect, it } from "vitest";
import { clasificarEgreso, normalizar } from "./resultado-mensual.js";

const RUBROS = [
  { id: "gas", claves: ["gas", "bombona"] },
  { id: "gasolina", claves: ["gasolina", "montacarga"] },
  { id: "admin", claves: ["gastos administrativos"] },
  { id: "operativo", claves: ["gasto_operativo", "gastos generales"] },
  { id: "cuadrilla", claves: ["cuadrilla", "cuadrilla_entries"] },
  { id: "gye", claves: ["cuadrilla guayaquil"] },
  { id: "sueldos", claves: ["admin_salary_payments", "sueldo"] },
  { id: "pilador", claves: ["pilador", "estibador"] },
  { id: "secada", claves: ["secador", "guardiania"] }
];

describe("normalizar", () => {
  it("quita tildes, mayúsculas y signos", () => {
    expect(normalizar("Alimentación / Almuerzo!")).toBe("alimentacion almuerzo");
    expect(normalizar("COMPRA_SACOS")).toBe("compra_sacos");
  });
});

describe("clasificarEgreso (rubro por claves)", () => {
  it("'gas' no se confunde con 'gasolina' ni con 'gastos'", () => {
    expect(clasificarEgreso(["Gas", "Compra de 2 bombonas"], RUBROS)).toBe("gas");
    expect(clasificarEgreso(["Gasolina montacarga"], RUBROS)).toBe("gasolina");
    expect(clasificarEgreso(["Gastos Generales", "GASTO_OPERATIVO", "Arreglo de techo"], RUBROS)).toBe("operativo");
    expect(clasificarEgreso(["Gastos administrativos", "Papel"], RUBROS)).toBe("admin");
  });
  it("gana la clave más específica", () => {
    expect(clasificarEgreso(["Cuadrilla Guayaquil"], RUBROS)).toBe("gye");
    expect(clasificarEgreso(["Nomina Planta", "PAGO_MANO_OBRA", "cuadrilla_entries", "Pago cuadrilla semana"], RUBROS)).toBe("cuadrilla");
  });
  it("reconoce pagos de nómina por su origen o rol", () => {
    expect(clasificarEgreso(["Nomina Planta", "PAGO_MANO_OBRA", "admin_salary_payments", "Sueldo contadora"], RUBROS)).toBe("sueldos");
    expect(clasificarEgreso(["Nomina Planta", "PAGO_MANO_OBRA", "worker_payments", "Pago semana pilador JUAN"], RUBROS)).toBe("pilador");
    expect(clasificarEgreso(["Nomina Planta", "PAGO_MANO_OBRA", "worker_payments", "Pago semana secador PEDRO"], RUBROS)).toBe("secada");
  });
  it("la subcategoría manda sobre la categoría de Caja", () => {
    expect(clasificarEgreso([["Gas"], ["Compra de gas"], [null], ["Gastos Generales", "GASTO_OPERATIVO"]], RUBROS)).toBe("gas");
    expect(clasificarEgreso([[null], ["Arreglo de techo"], [null], ["Gastos Generales", "GASTO_OPERATIVO"]], RUBROS)).toBe("operativo");
  });
  it("sin coincidencia queda sin clasificar", () => {
    expect(clasificarEgreso(["Varios", "Compra de escoba"], RUBROS)).toBeNull();
  });
});
