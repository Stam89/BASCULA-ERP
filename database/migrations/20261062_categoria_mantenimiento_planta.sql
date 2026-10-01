-- La categoría de Caja de mantenimiento se llama «Mantenimiento Planta»: en Caja
-- solo registra el dinero que se paga (mano de obra, técnico, taller). Los
-- repuestos se compran con «Repuestos» y las bajas de bodega se hacen en
-- Inventario. Solo cambia el nombre visible (el código sigue igual). Corre una vez.
UPDATE cash_categories
   SET nombre = 'Mantenimiento Planta'
 WHERE codigo = 'MANTENIMIENTO_EQUIPO' AND nombre IS DISTINCT FROM 'Mantenimiento Planta';
