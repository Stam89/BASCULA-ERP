-- Ticket de báscula QUITADO de los pendientes (pedido del dueño 2026-10-15: «ya lo eliminé en la app y en el ERP sigue»).
-- El ERP nunca borraba un ticket que desaparecía de Firebase (la app también los purga al exportarlos a Excel, así
-- que su ausencia no prueba que se borró). Ahora:
--   · un ticket EN ESPERA que ya no está en Firebase (ni en espera ni completo) se marca quitado solo;
--   · cualquier pendiente se puede quitar a mano (con motivo) y restaurar.
-- No se borra nada: deja de contar como pendiente (ni para la cuadrilla) y sigue visible en «Todos».
-- Si la báscula lo vuelve a modificar después, vuelve solo.
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS quitado_at TIMESTAMPTZ;
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS quitado_motivo TEXT;
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS quitado_por UUID;
