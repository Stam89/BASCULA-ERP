import { describe, expect, it } from "vitest";
import { moduloPermiteEscritura, rechazoDeEscritura, rechazoDeLectura, subDeLectura } from "./require-auth.js";

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

  it("Un módulo limitado abre solo lo que usa su pestaña", () => {
    const pagar = ["Por Pagar", "EDIT:Por Pagar"];
    expect(rechazoDeEscritura(pagar, ["Caja", "Por Pagar"], "cash", "POST", "/payables/abc/pay")).toBeNull();
    expect(rechazoDeEscritura(pagar, ["Caja", "Por Pagar"], "cash", "POST", "/payables/pay-group")).toBeNull();
    expect(rechazoDeEscritura(pagar, ["Caja", "Por Pagar"], "cash", "POST", "/registers/open")).not.toBeNull();
    expect(rechazoDeEscritura(pagar, ["Caja", "Por Pagar"], "cash", "POST", "/movements")).not.toBeNull();
    expect(rechazoDeEscritura([...pagar, "Caja", "EDIT:Caja"], ["Caja", "Por Pagar"], "cash", "POST", "/movements")).toBeNull();

    const tablet = ["Mostrador", "EDIT:Mostrador"];
    expect(rechazoDeEscritura(tablet, ["Ventas", "Caja", "Mostrador"], "sales", "POST", "/retail")).toBeNull();
    expect(rechazoDeEscritura(tablet, ["Ventas", "Caja", "Mostrador"], "sales", "POST", "/")).toBe("Desde el Mostrador solo se registran ventas al detalle.");

    const gana = ["Gana", "EDIT:Gana"];
    expect(moduloPermiteEscritura(gana, "Gana", "processing-batches", "PATCH", "/abc/precio-venta")).toBe(true);
    expect(moduloPermiteEscritura(gana, "Gana", "processing-batches", "POST", "/abc/finish")).toBe(false);

    const secador = ["Secadoras", "EDIT:Secadoras"];
    expect(moduloPermiteEscritura(secador, "Secadoras", "labor", "PUT", "/secador-guardia")).toBe(true);
    expect(moduloPermiteEscritura(secador, "Secadoras", "labor", "POST", "/pay-worker")).toBe(false);

    const caja = ["Caja", "EDIT:Caja"];
    expect(moduloPermiteEscritura(caja, "Caja", "sacks", "POST", "/purchases")).toBe(true);
    expect(moduloPermiteEscritura(caja, "Caja", "sacks", "PATCH", "/abc/adjust")).toBe(false);
    expect(moduloPermiteEscritura(caja, "Caja", "repuestos", "POST", "/compra")).toBe(true);
    expect(moduloPermiteEscritura(caja, "Caja", "repuestos", "POST", "/abc/ajuste")).toBe(false);
  });

  it("Nómina: lo que no se ve tampoco se escribe, y lo de Pagos sigue saliendo desde Pagos", () => {
    const soloCuadrilla = ["Nomina", "EDIT:Nomina", "SUB:Nomina:cuadrilla"];
    expect(moduloPermiteEscritura(soloCuadrilla, "Nomina", "cuadrilla", "POST", "/entries")).toBe(true);
    expect(moduloPermiteEscritura(soloCuadrilla, "Nomina", "labor", "POST", "/pay-worker")).toBe(false);
    expect(moduloPermiteEscritura(soloCuadrilla, "Nomina", "admin-payroll", "POST", "/pay")).toBe(false);
    expect(moduloPermiteEscritura(soloCuadrilla, "Nomina", "nomina-semanal", "POST", "/pagar")).toBe(false);
    expect(moduloPermiteEscritura(soloCuadrilla, "Nomina", "cuadrilla", "POST", "/bajadas/asignar")).toBe(false);

    const conPagos = ["Nomina", "EDIT:Nomina", "SUB:Nomina:pagos"];
    expect(moduloPermiteEscritura(conPagos, "Nomina", "admin-payroll", "POST", "/pay")).toBe(true);
    expect(moduloPermiteEscritura(conPagos, "Nomina", "cuadrilla", "POST", "/bajadas/pagar")).toBe(true);
    expect(moduloPermiteEscritura(conPagos, "Nomina", "cuadrilla", "POST", "/pay-worker")).toBe(true);
    expect(moduloPermiteEscritura(conPagos, "Nomina", "cuadrilla", "POST", "/advances/abc/settle")).toBe(true);
    expect(moduloPermiteEscritura(conPagos, "Nomina", "cuadrilla", "POST", "/entries")).toBe(false);
    expect(moduloPermiteEscritura(conPagos, "Nomina", "cuadrilla", "POST", "/bajadas/asignar")).toBe(false);
    // «Solo ver» de Sueldo Administrativo sigue mandando aunque se vea desde Pagos.
    expect(moduloPermiteEscritura([...conPagos, "SUB:Nomina:sueldo-admin", "RO:SUB:Nomina:sueldo-admin"], "Nomina", "admin-payroll", "POST", "/pay")).toBe(false);
  });

  it("Sueldos: se leen con Pagos, con Sueldo Administrativo o por Caja; no con otra sub-pestaña de Nómina", () => {
    const sub = subDeLectura("admin-payroll", "/staff");
    expect(sub?.subs).toEqual(["sueldo-admin", "pagos"]);
    const modulos = ["Nomina", "Caja"];
    expect(rechazoDeLectura(["Nomina", "SUB:Nomina:cuadrilla"], modulos, sub)).not.toBeNull();
    expect(rechazoDeLectura(["Nomina", "SUB:Nomina:pagos"], modulos, sub)).toBeNull();
    expect(rechazoDeLectura(["Nomina"], modulos, sub)).toBeNull();                                  // sin marcar = todas
    expect(rechazoDeLectura(["Nomina", "SUB:Nomina:cuadrilla", "Caja"], modulos, sub)).toBeNull();  // Caja también los usa
    expect(rechazoDeLectura(["Ventas"], modulos, sub)).not.toBeNull();
  });

  it("Secciones nuevas: sin marcar ninguna todo sigue igual; marcando, solo lo marcado", () => {
    const caja = ["Caja", "EDIT:Caja"];
    expect(moduloPermiteEscritura(caja, "Caja", "sales", "POST", "/retail")).toBe(true);
    expect(moduloPermiteEscritura(caja, "Caja", "advances", "POST", "/")).toBe(true);
    const soloAnticipos = [...caja, "SUB:Caja:anticipo"];
    expect(moduloPermiteEscritura(soloAnticipos, "Caja", "advances", "POST", "/")).toBe(true);
    expect(moduloPermiteEscritura(soloAnticipos, "Caja", "sales", "POST", "/retail")).toBe(false);
    expect(moduloPermiteEscritura(soloAnticipos, "Caja", "equipment", "POST", "/planta/gasto")).toBe(false);
    expect(moduloPermiteEscritura(soloAnticipos, "Caja", "cash", "POST", "/movements")).toBe(false);
    const conHoja = [...soloAnticipos, "SUB:Caja:resumen"];
    expect(moduloPermiteEscritura(conHoja, "Caja", "cash", "POST", "/abc/movements")).toBe(true);
    expect(moduloPermiteEscritura(conHoja, "Caja", "equipment", "POST", "/planta/gasto")).toBe(true);  // máquina desde la hoja
    expect(moduloPermiteEscritura(conHoja, "Caja", "equipment", "POST", "/abc/maintenance")).toBe(false);

    const inv = ["Inventario", "EDIT:Inventario", "SUB:Inventario:sacos"];
    expect(moduloPermiteEscritura(inv, "Inventario", "sacks", "POST", "/movements")).toBe(true);
    expect(moduloPermiteEscritura(inv, "Inventario", "inventory", "POST", "/adjustments")).toBe(false);
    expect(moduloPermiteEscritura(inv, "Inventario", "repuestos", "POST", "/abc/ajuste")).toBe(false);

    const liq = ["Liquidaciones", "EDIT:Liquidaciones", "SUB:Liquidaciones:nueva"];
    expect(moduloPermiteEscritura(liq, "Liquidaciones", "liquidations", "POST", "/")).toBe(true);
    expect(moduloPermiteEscritura(liq, "Liquidaciones", "liquidations", "PUT", "/abc")).toBe(false);

    const bas = ["Bascula", "EDIT:Bascula", "SUB:Bascula:tickets"];
    expect(moduloPermiteEscritura(bas, "Bascula", "weighing-tickets", "POST", "/")).toBe(true);
    expect(moduloPermiteEscritura(bas, "Bascula", "weighing-tickets", "PUT", "/abc/accionista")).toBe(false);
    expect(moduloPermiteEscritura(bas, "Bascula", "lots", "PUT", "/abc/accionista")).toBe(false);
    expect(moduloPermiteEscritura(bas, "Bascula", "tickets", "POST", "/abc/link-farmer")).toBe(true);
    expect(moduloPermiteEscritura(["Bascula", "EDIT:Bascula", "SUB:Bascula:corregir"], "Bascula", "tickets", "POST", "/abc/link-farmer")).toBe(false);
    expect(moduloPermiteEscritura(["Bascula", "EDIT:Bascula", "SUB:Bascula:sync"], "Bascula", "tickets", "POST", "/refresh-firebase")).toBe(true);
  });

  it("El mensaje dice por qué se rechazó", () => {
    expect(rechazoDeEscritura(["Caja"], ["Caja"], "expenses", "POST", "/")).toContain("SOLO LECTURA");
    expect(rechazoDeEscritura(["Ventas"], ["Caja"], "expenses", "POST", "/")).toContain("no tiene permiso");
    expect(rechazoDeEscritura(["Caja", "EDIT:Caja", "SUB:Caja:anticipo"], ["Caja"], "expenses", "POST", "/")).toContain("No tienes acceso a Caja › resumen");
    expect(rechazoDeEscritura(["Nomina", "EDIT:Nomina", "RO:SUB:Nomina:pagos"], ["Nomina"], "labor", "POST", "/pay-worker")).toContain("SOLO LECTURA");
  });
});
