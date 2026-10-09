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

  it("Transporte y Cosechadora: cada sección se permite aparte (Ver/Editar)", () => {
    const T = "Transporte / Cosechadora";
    const todo = [T, `EDIT:${T}`];
    expect(moduloPermiteEscritura(todo, T, "campo", "POST", "/movimientos")).toBe(true);           // sin secciones marcadas = todas
    const soloPartes = [...todo, `SUB:${T}:partes`];
    expect(moduloPermiteEscritura(soloPartes, T, "campo", "POST", "/partes")).toBe(true);
    expect(moduloPermiteEscritura(soloPartes, T, "campo", "PATCH", "/partes/abc")).toBe(true);
    expect(moduloPermiteEscritura(soloPartes, T, "campo", "POST", "/movimientos")).toBe(false);     // Caja no marcada
    expect(moduloPermiteEscritura(soloPartes, T, "campo", "POST", "/caja/abrir")).toBe(false);
    expect(moduloPermiteEscritura(soloPartes, T, "campo", "POST", "/nomina-operadores/lote")).toBe(false);
    expect(moduloPermiteEscritura(soloPartes, T, "campo", "POST", "/clientes")).toBe(true);         // catálogo del módulo
    const cajaSoloVer = [...todo, `SUB:${T}:caja`, `SUB:${T}:vales`, `RO:SUB:${T}:caja`];
    expect(moduloPermiteEscritura(cajaSoloVer, T, "campo", "POST", "/movimientos")).toBe(false);
    expect(moduloPermiteEscritura(cajaSoloVer, T, "campo", "POST", "/movimientos/x/liquidar")).toBe(true);
    const clientes = [...todo, `SUB:${T}:clientes`];
    expect(moduloPermiteEscritura(clientes, T, "campo", "POST", "/cxc/abono")).toBe(true);          // abono desde Clientes
    expect(moduloPermiteEscritura(clientes, T, "campo", "POST", "/cxp")).toBe(false);
  });
});
