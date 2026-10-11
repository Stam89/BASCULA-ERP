-- Sueldo administrativo distinto en la QUINCENA y a FIN DE MES (pedido del dueño 2026-10-11: un administrativo cobra
-- $250 el 15 y $300 a fin de mes). `base_salary` sigue siendo lo de la quincena; `salario_fin_mes` es lo de fin de
-- mes y, si queda vacío (NULL), es igual a la quincena (como hasta ahora). Aditiva e idempotente.
ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS salario_fin_mes NUMERIC(12,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_staff_salario_fin_mes_chk') THEN
    ALTER TABLE admin_staff ADD CONSTRAINT admin_staff_salario_fin_mes_chk CHECK (salario_fin_mes IS NULL OR salario_fin_mes >= 0);
  END IF;
END $$;
