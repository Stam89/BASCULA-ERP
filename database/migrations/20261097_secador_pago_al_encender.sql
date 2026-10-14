-- El trabajo del secador se devenga cuando el túnel enciende, no cuando termina.
-- Corrige únicamente pagos automáticos PENDIENTES; los pagos ya realizados son
-- históricos e inmutables. DISTINCT evita duplicar un túnel con carga mixta.

WITH tuneles_iniciados AS (
  SELECT btrim(d.operator_name) AS worker_name,
         COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) AS work_date,
         COUNT(DISTINCT d.tunnel_number)::int AS tunnels,
         MIN(d.dry_start_at) AS first_start
    FROM drying_tunnel_reports d
   WHERE d.dry_start_at IS NOT NULL
     AND COALESCE(d.dry_method, 'TUNEL') = 'TUNEL'
     AND d.tunnel_number IS NOT NULL
     AND btrim(COALESCE(d.operator_name, '')) <> ''
     AND EXTRACT(ISODOW FROM COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date)) BETWEEN 1 AND 5
   GROUP BY btrim(d.operator_name), COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date)
), tarifa AS (
  SELECT COALESCE(secador_guardiania, 0)::numeric AS guardiania,
         COALESCE(secador_per_tunel, 0)::numeric AS por_tunel
    FROM labor_rates
   WHERE socio_id IS NULL
   LIMIT 1
)
UPDATE worker_payments wp
   SET tunnels = ti.tunnels,
       base_amount = round(t.guardiania + t.por_tunel * ti.tunnels, 2),
       net_amount = GREATEST(0, round(t.guardiania + t.por_tunel * ti.tunnels, 2) - COALESCE(wp.discount, 0)),
       notes = 'Secado - Inicio: ' || to_char(ti.first_start AT TIME ZONE 'America/Guayaquil', 'DD/MM/YYYY HH24:MI')
               || ' · Guardianía + ' || ti.tunnels || ' túnel(es) iniciado(s)'
  FROM tuneles_iniciados ti
 CROSS JOIN tarifa t
 WHERE wp.worker_role = 'SECADOR'
   AND wp.status = 'PENDING'
   AND btrim(wp.worker_name) = ti.worker_name
   AND wp.work_date = ti.work_date
   AND (
     wp.tunnels IS DISTINCT FROM ti.tunnels
     OR wp.base_amount IS DISTINCT FROM round(t.guardiania + t.por_tunel * ti.tunnels, 2)
   );

-- DOWN manual: no se revierte un recálculo operativo; esta migración no cambia
-- esquema ni toca pagos PAID.
