import { describe, expect, it } from "vitest";
import { CATALOGOS_PRESERVADOS, planVaciado, WIPE_TABLES, type Fk } from "./datos-prueba.js";

const fk = (hijo: string, padre: string, conname = `${hijo}_${padre}_fkey`): Fk =>
  ({ conname, hijo, padre, def: `FOREIGN KEY (x) REFERENCES ${padre}(id)`, cols: ["x"] });

describe("planVaciado (Borrar datos de prueba)", () => {
  const fks = [
    fk("cash_movements", "cash_registers"),
    fk("equipment", "cash_movements"),          // activo fijo comprado en caja
    fk("repuestos", "equipment"),               // repuesto asociado a un equipo
    fk("tarifario_servicio", "customers"),      // tarifa negociada con un cliente
    fk("tarifario_servicio", "accionistas"),    // tarifa de un socio (catálogo)
    fk("guias_remision", "sales_orders"),       // transaccional hijo: SÍ cae por cascada
    fk("equipment", "branches")
  ];
  const tablas = ["cash_registers", "cash_movements", "customers", "sales_orders"];
  const preservados = Object.keys(CATALOGOS_PRESERVADOS);

  it("no deja que el CASCADE alcance equipos, repuestos ni el tarifario", () => {
    const { vaciadas } = planVaciado(fks, tablas, preservados);
    expect(vaciadas.has("equipment")).toBe(false);
    expect(vaciadas.has("repuestos")).toBe(false);
    expect(vaciadas.has("tarifario_servicio")).toBe(false);
  });

  it("los hijos transaccionales siguen cayendo por cascada", () => {
    expect(planVaciado(fks, tablas, preservados).vaciadas.has("guias_remision")).toBe(true);
  });

  it("suelta solo las FK de catálogos que apuntan a algo que se vacía", () => {
    const { sueltas } = planVaciado(fks, tablas, preservados);
    expect(sueltas.map((f) => `${f.hijo}->${f.padre}`).sort()).toEqual(["equipment->cash_movements", "tarifario_servicio->customers"]);
  });

  it("sin catálogos preservados, el CASCADE los alcanzaría (el bug que se corrigió)", () => {
    const { vaciadas } = planVaciado(fks, tablas, []);
    expect(vaciadas.has("equipment")).toBe(true);
    expect(vaciadas.has("repuestos")).toBe(true);
  });

  it("los catálogos preservados nunca están en la lista de tablas a vaciar", () => {
    for (const t of Object.keys(CATALOGOS_PRESERVADOS)) expect(WIPE_TABLES).not.toContain(t);
  });
});
