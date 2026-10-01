-- Repuestos: «Compatibilidad / Etiqueta» = familia de equipos a la que sirve la
-- pieza (GENERAL o un área de mantenimiento: PILADORA, SECADORA…), sin atarla a
-- una máquina concreta. Se elige al comprar en Caja → Repuestos y ordena el
-- buscador de «Añadir repuesto de bodega» del mantenimiento. Aditiva e idempotente.
ALTER TABLE repuestos ADD COLUMN IF NOT EXISTS compatibilidad TEXT;
