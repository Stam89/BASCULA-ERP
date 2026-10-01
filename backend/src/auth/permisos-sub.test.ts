import { describe, expect, it } from "vitest";
import { moduloPermiteEscritura } from "./require-auth.js";

describe("moduloPermiteEscritura (Ver / Editar por sub-pestaña)", () => {
  const edita = ["Ventas", "EDIT:Ventas", "Nomina", "EDIT:Nomina", "Seleccion", "EDIT:Seleccion"];

  it("sin claves RO:SUB: todo queda como antes (EDIT del módulo basta)", () => {
    expect(moduloPermiteEscritura(edita, "Ventas", "orders", "POST", "/")).toBe(true);
    expect(moduloPermiteEscritura(edita, "Ventas", "orders", "POST", "/abc/deliver")).toBe(true);
    expect(moduloPermiteEscritura(edita, "Nomina", "admin-payroll", "POST", "/pay")).toBe(true);
    expect(moduloPermiteEscritura(["Ventas"], "Ventas", "orders", "POST", "/")).toBe(false); // solo Ver del módulo
  });

  it("Solo ver en una sub-pestaña bloquea SUS escrituras y no las de las demás", () => {
    const despachosSoloVer = [...edita, "RO:SUB:Ventas:despachos"];
    expect(moduloPermiteEscritura(despachosSoloVer, "Ventas", "orders", "PATCH", "/abc/prepare")).toBe(false);
    expect(moduloPermiteEscritura(despachosSoloVer, "Ventas", "orders", "POST", "/abc/deliver")).toBe(false);
    expect(moduloPermiteEscritura(despachosSoloVer, "Ventas", "orders", "POST", "/")).toBe(true);           // Nuevo pedido
    expect(moduloPermiteEscritura(despachosSoloVer, "Ventas", "orders", "PUT", "/abc/guia")).toBe(true);    // Guías
    expect(moduloPermiteEscritura(despachosSoloVer, "Ventas", "customers", "POST", "/")).toBe(true);        // catálogo del módulo
  });

  it("Nómina: secadora, pagos y sueldo administrativo por separado", () => {
    const pagosSoloVer = [...edita, "RO:SUB:Nomina:pagos"];
    expect(moduloPermiteEscritura(pagosSoloVer, "Nomina", "labor", "POST", "/pay-worker")).toBe(false);
    expect(moduloPermiteEscritura(pagosSoloVer, "Nomina", "labor", "POST", "/secador-days")).toBe(true);
    expect(moduloPermiteEscritura(pagosSoloVer, "Nomina", "admin-payroll", "POST", "/pay")).toBe(true);
    expect(moduloPermiteEscritura([...edita, "RO:SUB:Nomina:sueldo-admin"], "Nomina", "admin-payroll", "POST", "/pay")).toBe(false);
  });

  it("Selección: nuevo envío vs en proceso", () => {
    const nuevoSoloVer = [...edita, "RO:SUB:Seleccion:nuevo"];
    expect(moduloPermiteEscritura(nuevoSoloVer, "Seleccion", "selection", "POST", "/batches")).toBe(false);
    expect(moduloPermiteEscritura(nuevoSoloVer, "Seleccion", "selection", "POST", "/batches/x/finish")).toBe(true);
    expect(moduloPermiteEscritura(nuevoSoloVer, "Seleccion", "selection", "PUT", "/rates")).toBe(true);
  });
});
