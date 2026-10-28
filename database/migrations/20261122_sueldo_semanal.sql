-- 🗓️ Sueldo SEMANAL por día (pedido del dueño 2026-10-28: la cocinera trabaja hasta el sábado y se le paga por día,
-- cada viernes). En un empleado SEMANAL, base_salary es el PAGO POR DÍA y dias_semana los días que trabaja de lunes a
-- sábado (por defecto 6); el viernes se pueden cambiar los días. Los QUINCENA siguen igual. Aditiva e idempotente.
ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS periodicidad VARCHAR(10) NOT NULL DEFAULT 'QUINCENA';
ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS dias_semana INTEGER NOT NULL DEFAULT 6;
ALTER TABLE admin_salary_payments ADD COLUMN IF NOT EXISTS dias NUMERIC(5,2);
