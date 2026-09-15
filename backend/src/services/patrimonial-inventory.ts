// Regla de negocio: aislamiento de Inventario Propio vs. Servicios.
//
// El inventario PATRIMONIAL de la empresa (stock de Cáscara / materia prima y de
// Producto Terminado) SOLO debe moverse cuando el lote es una COMPRA (grano
// propio). Los lotes de servicio a terceros — 'SECADO', 'PILADO' y
// 'SECADO_PILADO' (Servicio Completo) — procesan grano que pertenece al cliente:
// su materia prima y su producto terminado NO son de la empresa, así que NO
// deben generar entradas ni salidas en el inventario propio (Kardex).
//
// Excepción de subproductos: si la regla del negocio dicta que los subproductos
// (polvillo / arrocillo) sí se los queda la planta, esos SÍ entran como propios
// aunque provengan de un lote de servicio. Por eso el consumo de materia prima y
// el producto terminado se excluyen, pero los subproductos pueden conservarse
// (ver `loteGeneraSubproductoPropio`).

export function esLoteDeServicio(operationType: string | null | undefined): boolean {
  return String(operationType ?? "COMPRA").toUpperCase() !== "COMPRA";
}

// ¿El lote afecta el inventario patrimonial de materia prima / producto
// terminado? Solo las COMPRAS (grano propio). Los servicios se excluyen.
export function loteAfectaInventarioPropio(operationType: string | null | undefined): boolean {
  return !esLoteDeServicio(operationType);
}
