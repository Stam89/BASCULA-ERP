import { describe, expect, it } from "vitest";
import { clasificarEgreso, clasificarMovimiento, normalizar } from "./resultado-mensual.js";

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

describe("clasificarMovimiento (categoría de Caja + nómina por tipo)", () => {
  const R = [
    { id: "gas", claves: ["gas"], categorias: ["GAS"] },
    { id: "cocinera", claves: ["cocinera"], categorias: ["COCINERA"] },
    { id: "sueldos", claves: ["sueldo"], nomina: ["SUELDO_ADMIN"] },
    { id: "cuadrilla", claves: ["cuadrilla"], categorias: ["CUADRILLA_BAJADA"], nomina: ["CUADRILLA", "POLVILLO"] },
    { id: "pilador", claves: ["pilador"], nomina: ["PILADOR", "ESTIBADOR"] },
    { id: "secada", claves: ["secador"], categorias: ["GUARDIANIA"], nomina: ["SECADOR"] },
    { id: "operativo", claves: ["gastos generales"], categorias: ["GASTO_OPERATIVO"] }
  ];
  const nomina = (reference_type: string, description: string) =>
    ({ category: "PAGO_MANO_OBRA", categoria_nombre: "Nómina planta / Sueldos", reference_type, description });
  it("casos reales de septiembre", () => {
    expect(clasificarMovimiento({ category: "GAS", subcategoria: "Gas", description: "KIN GAS" }, R)).toBe("gas");
    expect(clasificarMovimiento({ category: "COCINERA", subcategoria: "DANIELA", description: "6 DIAS" }, R)).toBe("cocinera");
    expect(clasificarMovimiento(nomina("worker_payments", "Pago semana polvillo ROBERTO"), R)).toBe("cuadrilla");
    expect(clasificarMovimiento(nomina("cuadrilla_entries", "Pago cuadrilla CUADRILLA"), R)).toBe("cuadrilla");
    expect(clasificarMovimiento(nomina("worker_payments", "Pago semana pilador CUCA"), R)).toBe("pilador");
    expect(clasificarMovimiento(nomina("worker_payments", "Pago semana estibador TINTON"), R)).toBe("pilador");
    expect(clasificarMovimiento(nomina("worker_payments", "Pago semana secador HUGO"), R)).toBe("secada");
    expect(clasificarMovimiento(nomina("admin_salary_payments", "Sueldo ASISTENTE CONTABLE ANGIE RUIZ"), R)).toBe("sueldos");
  });
  it("bajada de carro: su propio tipo; sin rubro propio sigue en el de cuadrilla", () => {
    const pago = nomina("cuadrilla_entries", "Pago bajada de carro · 3 ticket(s): JUAN $1.20");
    expect(clasificarMovimiento(pago, R)).toBe("cuadrilla");
    const conBajada = [...R, { id: "bajada", claves: [], nomina: ["BAJADA_CARRO"] }];
    expect(clasificarMovimiento(pago, conBajada)).toBe("bajada");
    expect(clasificarMovimiento(nomina("cuadrilla_entries", "Pago cuadrilla CUADRILLA"), conBajada)).toBe("cuadrilla");
  });
  it("sueldo administrativo cuyo cargo nombra otro rubro", () => {
    expect(clasificarMovimiento(nomina("admin_salary_payments", "Sueldo Cocinera MARIA"), R)).toBe("cocinera");
  });
  it("la categoría manda aunque la subcategoría diga otra cosa", () => {
    expect(clasificarMovimiento({ category: "GASTO_OPERATIVO", subcategoria: "Gas", description: "Bloques" }, R)).toBe("operativo");
  });
  it("categoría sin rubro: respaldo por claves, o sin clasificar", () => {
    expect(clasificarMovimiento({ category: "OTRA", subcategoria: "Gas", description: "x" }, R)).toBe("gas");
    expect(clasificarMovimiento({ category: "OTRA", subcategoria: "Escoba", description: "x" }, R)).toBeNull();
  });
});
