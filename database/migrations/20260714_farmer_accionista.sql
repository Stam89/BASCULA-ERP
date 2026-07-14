-- Cada agricultor se asigna manualmente a un accionista. Como los 3 socios
-- comparten el mismo dispositivo de báscula, la atribución del ticket se define
-- por el agricultor: al vincular un ticket con un agricultor, el ticket toma el
-- accionista de ese agricultor. Nullable: un agricultor sin asignar cae al
-- accionista activo del usuario que vincula.

ALTER TABLE farmers ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
CREATE INDEX IF NOT EXISTS idx_farmers_accionista_id ON farmers(accionista_id);
