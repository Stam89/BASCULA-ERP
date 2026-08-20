import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiGet, apiPost, apiPut, checkHealth, getActiveAccionistaId, setActiveAccionistaId } from "./api";
import { money, categoryLabel, stockGroupLabel } from "./format";
import type { Farmer, Product, Warehouse, Lot, MateriaPrimaEntry, MateriaPrimaCorreccion, PendingEntry } from "./types";
import { Metric, ReportTable, Input, Select, MedidorRow, DataList } from "./components/ui";

/** Etiqueta corta de un ingreso: el número de la báscula si se conoce. */
function entryLabel(entry: { numero_bascula?: string | null; ticket_number: string }): string {
  return entry.numero_bascula ? `Ticket #${entry.numero_bascula}` : entry.ticket_number;
}

type Dashboard = {
  active_farmers: number;
  tickets_today: number;
  owned_stock: number;
  pending_advances: number;
  pending_payables: number;
  sales_today: number;
  current_cash_register: { id: string; name: string; opening_balance: string; opening_balance_cash: string; opening_balance_bank: string } | null;
};

type Expense = {
  id: string;
  amount: string | number;
  description: string;
  paid_to: string | null;
  created_at: string;
};

type AuthUser = {
  id: string;
  username: string;
  name: string;
  role_id: string | null;
  role_name: string | null;
  allowed_modules?: string[] | null;
};

type Accionista = { id: string; name: string; code: string; tipo?: string; puede_envejecer?: boolean; allowed_modules?: string[] };

// Selección / envejecido de producto terminado (persona externa), por lotes.
type ExternalProvider = { id: string; name: string; identification: string | null; phone: string | null };
type SelectionRates = { seleccion_rate: number; envejecimiento_rate: number };
type SelectionLine = { product_id: string; product_name: string; quantity: number | string; is_reject?: boolean };
type SelectionBatch = {
  id: string;
  batch_number: string;
  service_date: string;
  service_type: "SELECCION" | "ENVEJECIMIENTO";
  status: "IN_PROCESS" | "COMPLETED" | "CANCELLED";
  input_qq: number | string;
  output_qq: number | string;
  merma_qq: number | string;
  rate_per_qq: number | string;
  total_cost: number | string;
  provider_name: string;
  warehouse_name: string;
  saldo: number;
  pago_estado: string;
  notes: string | null;
  inputs: SelectionLine[];
  outputs: SelectionLine[];
};

// Módulos asignables a un operador (deben coincidir con el backend).
// APP_MODULES (modulos asignables a operadores) se define mas abajo, DERIVADO
// de navGroups, para que al agregar una seccion nueva al Sidebar aparezca sola
// como permiso. Ver justo despues de `const tabs = ...`.

type AppSettings = {
  business_name: string;
  business_subtitle: string;
  ruc: string;
  phone: string;
  address: string;
  receipt_footer: string;
};

const defaultAppSettings: AppSettings = {
  business_name: "BASCULA ERP",
  business_subtitle: "Piladora de Arroz",
  ruc: "",
  phone: "",
  address: "",
  receipt_footer: ""
};

type AdminUser = {
  id: string;
  name: string;
  username: string;
  cedula?: string | null;
  is_active: boolean;
  created_at: string;
  role_name: string | null;
  allowed_modules: string[] | null;
  accionista_ids?: string[] | null;
  /** Módulos permitidos por accionista (permisos individuales por accionista). */
  accionista_modules?: Array<{ accionista_id: string; modules: string[] }> | null;
};

type AdminAccionista = { id: string; name: string; code: string; is_active: boolean; puede_envejecer?: boolean };

type AuditEntry = {
  id: string;
  username: string | null;
  action: string;
  table_name: string;
  summary: string | null;
  record_id: string | null;
  status_code: number | null;
  created_at: string;
};

type BasculaTicket = {
  id: string;
  farmer_id: string | null;
  farmer_name: string | null;
  gross_weight: string | number;
  tare_weight: string | number;
  net_weight: string | number;
  qualification: string | number;
  quintals: string | number;
  liquidated_at: string | null;
  lot_id: string | null;
  weighing_ticket_id?: string | null;
  en_espera?: boolean;
  numero: string | null;
  modo: string | null;
  fecha_app: string | null;
  placa: string | null;
  calidad: string | null;
};

type ReportSummary = {
  range: { from: string; to: string };
  sales: { total: number; cnt: number };
  liquidations: { net: number; gross: number; cnt: number };
  expenses: { total: number; cnt: number };
  cash: { income: number; expense: number; net: number };
  production: { input: number; cnt: number };
  receivable_outstanding: number;
  payable_outstanding: number;
};

type LaborRates = {
  pilador_per_qq: number;
  pilador_per_saca: number;
  estibador_per_qq: number;
  estibador_per_saca: number;
  estibador_per_arrocillo: number;
  /** El estibador cobra por tulas: $ por cada 3 tulas (proporcional). */
  estibador_por_3tulas: number;
  /** Pago por QQ de polvillo llenado (trabajador aparte). */
  polvillo_per_qq: number;
  secador_guardiania: number;
  secador_per_tunel: number;
  /** Precio fijo del gas por unidad de bombona (medidor). */
  precio_gas_bombona: number;
  /** Precio fijo de cada cilindro de gas. */
  precio_gas_cilindro: number;
  /** Precio fijo del diesel por unidad de medidor. */
  precio_diesel: number;
};

const defaultLaborRates: LaborRates = {
  pilador_per_qq: 0.15,
  pilador_per_saca: 0.15,
  estibador_per_qq: 0.1,
  estibador_per_saca: 0.25,
  estibador_per_arrocillo: 0.1,
  estibador_por_3tulas: 5,
  polvillo_per_qq: 0.25,
  secador_guardiania: 10,
  secador_per_tunel: 5,
  precio_gas_bombona: 0,
  precio_gas_cilindro: 0,
  precio_diesel: 0
};

type WorkerSummary = {
  worker_role: string;
  worker_name: string;
  cnt: number;
  qq: number;
  sacas: number;
  arrocillo: number;
  tulas: number;
  base_amount: number;
  net_amount: number;
  pending_amount: number | null;
  paid_amount: number | null;
  advances: number;
  to_pay: number;
};

type WorkerPaymentDetail = {
  id: string;
  worker_role: string;
  worker_name: string;
  work_date: string;
  qq: number;
  sacas: number;
  arrocillo: number;
  tulas: number;
  base_amount: number;
  net_amount: number;
  status: string;
  detail: {
    qq?: number; qq_rate?: number; qq_amount?: number;
    sacas?: number; saca_rate?: number; saca_amount?: number;
    arrocillo?: number; arrocillo_rate?: number; arrocillo_amount?: number;
    tulas?: number; tulas_rate?: number; tulas_amount?: number;
  } | null;
};

type CuadrillaActivity = { id: string; name: string; unit_rate: number; is_active: boolean };
type CuadrillaEntry = { id: string; work_date: string; activity_name: string; worker_name: string; quantity: number; unit_rate: number; subtotal: number };
type CuadrillaSummaryRow = { worker_name: string; entradas: number; total: number; anticipos: number; neto: number };
type CuadrillaAdvance = { id: string; worker_name: string; amount: number; balance: number; concept: string | null; status: string; issued_at: string };

type PiladoService = {
  id: string;
  service_date: string;
  cliente: string;
  quintals: number;
  rate_per_qq: number;
  total: number;
  saldo: number;
  estado: string;
  notes: string | null;
  detalle?: Array<{ presentacion: string; quintales: number; precio_total_qq: number; subtotal: number }> | null;
  created_at?: string;
};
type PiladoOutput = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit: string;
  presentation: string | null;
  sack_weight_lb: number | null;
  is_byproduct: boolean;
};

type PiladoYield = {
  input_paddy_kg: number;
  white_rice_qty: number;
  white_rice_unit: string;
  broken_rice_qty: number;
  fine_broken_rice_qty: number;
  bran_qty: number;
  total_output_kg: number;
  process_loss_kg: number;
  yield_percent: number;
  qq_de_tulas: number;
};

type PiladoServiceDetail = PiladoService & {
  outputs?: PiladoOutput[] | null;
  yield?: PiladoYield | null;
};
type PiladoBalance = { id: string; name: string; saldo: number };

type PanelAccionista = {
  id: string; name: string;
  compras_total: number; compras_qq: number; compras_cnt: number;
  ventas_total: number; ventas_qq: number; ventas_cnt: number;
  inventario_qq: number; inventario_valor: number;
  cascara_011: number; cascara_corriente: number;
  seco_011: number; seco_corriente: number;
  producto_011: number; producto_corriente: number;
  arrocillo_34: number; arrocillo_fino: number;
  polvillo: number;
  banco_balance: number;
};
type PanelData = {
  month: string;
  kpis: { compras: number; ventas: number; utilidad: number; margen: number; bancos: number; saldo_general: number };
  per_accionista: PanelAccionista[];
  totales: { compras_qq: number; ventas_qq: number; inventario_qq: number; inventario_valor: number; compras_cnt: number; ventas_cnt: number; cascara_011: number; cascara_corriente: number; seco_011: number; seco_corriente: number; producto_011: number; producto_corriente: number; arrocillo_34: number; arrocillo_fino: number; polvillo: number; };
  serie: Array<{ month: string; compras: number; ventas: number }>;
  por_cobrar: { total: number; cnt: number };
  por_pagar: { total: number; cnt: number };
  prestamos: { total: number; cnt: number };
  servicios_pilado?: { facturado: number; pendiente: number; cobrado: number; cnt: number };
  costo_operativo?: { total: number; qq: number; por_qq: number };
  alertas: string[];
};

type ReportKind = "resumen" | "ventas" | "liquidaciones" | "gastos" | "produccion" | "combustible" | "porcobrar" | "arianos";

const reportEndpoint: Record<Exclude<ReportKind, "resumen">, string> = {
  ventas: "sales",
  liquidaciones: "liquidations",
  gastos: "expenses",
  produccion: "production",
  combustible: "fuel",
  porcobrar: "receivable-aging",
  arianos: "arianos"
};

const authStorageKey = "bascula-erp:auth";

function loadStoredAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem(authStorageKey);
    if (!raw) return null;
    return (JSON.parse(raw) as { user?: AuthUser }).user ?? null;
  } catch {
    return null;
  }
}

function loadStoredAccionistas(): Accionista[] {
  try {
    const raw = localStorage.getItem(authStorageKey);
    if (!raw) return [];
    return (JSON.parse(raw) as { accionistas?: Accionista[] }).accionistas ?? [];
  } catch {
    return [];
  }
}

// Si el accionista guardado ya no es válido para esta sesión (o no hay ninguno
// guardado), selecciona el primero disponible para que la app tenga uno activo.
function ensureActiveAccionista(accionistas: Accionista[]): void {
  if (accionistas.length === 0) return;
  const current = getActiveAccionistaId();
  if (current && accionistas.some((a) => a.id === current)) return;
  setActiveAccionistaId(accionistas[0].id);
}

type StockRow = {
  product_id?: string;
  warehouse_id?: string;
  code?: string;
  product_name: string;
  product_type?: string;
  warehouse_name: string;
  ownership: string;
  quantity: string | number;
  unit: string;
};

type NegativeStockMovement = {
  created_at: string;
  movement: string;
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  lot_id: string | null;
};

type NegativeStockRow = {
  product_id: string;
  code: string;
  product_name: string;
  unit: string;
  warehouse_id: string;
  warehouse_name: string;
  ownership: string;
  quantity: number;
  movements: NegativeStockMovement[];
};

type DiscountBreakdown = {
  fomento: number;
  bascula: number;
  flete: number;
  cosechadora: number;
};

type LiqRecord = {
  id: string;
  liquidation_number: string;
  farmer_id: string;
  farmer_name: string;
  lot_code: string | null;
  rice_type: string | null;
  quintals: number;
  price_per_quintal: number;
  gross_amount: number;
  advances_discount: number;
  other_discounts: number;
  discount_breakdown: DiscountBreakdown | null;
  net_amount: number;
  pending_balance: number;
  batch_id: string | null;
  created_at: string;
  /** true = un administrador la desbloqueó y se puede editar precio/descuentos. */
  edit_unlocked?: boolean;
};

type Insumo = {
  id: string;
  nombre: string;
  stock_actual: string | number;
  nivel_critico: string | number;
  unidad: string;
  is_critical: boolean;
};

type ProductionResult = {
  yield: {
    input_paddy_kg: string | number;
    white_rice_qty: string | number;
    white_rice_unit: string;
    broken_rice_qty: string | number;
    broken_rice_unit: string;
    fine_broken_rice_qty?: string | number;
    fine_broken_rice_unit?: string;
    bran_qty: string | number;
    bran_unit: string;
    total_output_kg: string | number;
    process_loss_kg: string | number;
    yield_percent: string | number;
    sacks_used: string | number;
    service_amount: string | number;
  };
  packagingAlert: null | {
    nombre: string;
    stockActual: number;
    nivelCritico: number;
    isCritical: boolean;
  };
  maquila: null | {
    serviceQuantityQq: number;
    serviceRatePerQq: number;
    serviceAmount: number;
    receivableId: string;
  };
  // Cobro de pilado generado al finalizar (a otro accionista o cliente externo).
  servicio_pilado: null | {
    cliente: string;
    es_accionista: boolean;
    quintales: number;
    total: number;
    detalle: Array<{ presentacion: string; quintales: number; precio_total_qq: number; subtotal: number }>;
  };
  custodyMode: boolean;
};

type ProcessReport = {
  id: string;
  stage: string;
  sequence: number;
  report_title: string;
  reference_type: string | null;
  notes: string | null;
  created_at: string;
};

type DryingTunnelReport = {
  id: string;
  lot_id: string;
  tunnel_number: number;
  rice_type: string;
  input_weight_kg: string | number;
  total_quintals: string | number;
  moisture_before: string | number | null;
  drying_hours: string | number | null;
  filled_at: string | null;
  dry_start_at: string | null;
  dry_end_at: string | null;
  gas_used: string | number;
  gas_bombona_inicio?: string | number;
  gas_bombona_fin?: string | number;
  gas_bombona_costo?: string | number;
  gas_cilindro_cantidad?: string | number;
  gas_cilindro_costo?: string | number;
  gas_costo_total?: string | number;
  diesel_used: string | number;
  dryer_name: string | null;
  status: string;
  operator_name: string | null;
  notes: string | null;
  is_processed?: boolean;
  apartado_arianos?: boolean;
  lots: DryingTunnelLot[];
};

type DryingTunnelLot = {
  lot_id: string;
  lot_code: string;
  farmer_name: string | null;
  net_weight_kg: string | number;
  quintals: string | number;
};

/** Secado activo de un motor (puede ser de cualquier accionista). */
type MotorActiveReport = {
  id: string;
  tunnel_number: number;
  dryer_name: string | null;
  total_quintals: string | number;
  rice_type: string | null;
  lot_code: string;
  accionista_name: string | null;
  dry_start_at: string | null;
};

/** Túnel ocupado por OTRO accionista (secado en curso): se bloquea en el formulario. */
type TunnelStatusRow = {
  tunnel_number: number;
  accionista_name: string;
};

type ProcessFlow = {
  lot: Lot & { print_batch_code: string; is_maquila: boolean };
  reports: ProcessReport[];
  links: Array<{ from_report_id: string; to_report_id: string; link_type: string }>;
  tunnels: DryingTunnelReport[];
};

type CashMovement = {
  id: string;
  cash_register_id: string;
  movement: "INCOME" | "EXPENSE";
  category: string;
  amount: string | number;
  description: string | null;
  reference_type: string | null;
  created_at: string;
  reversal_of?: string | null;
  reversed_at?: string | null;
  reversed_reason?: string | null;
};

type CashSummary = {
  id: string;
  name: string;
  status: string;
  opening_balance: string | number;
  opening_balance_cash: string | number;
  opening_balance_bank: string | number;
  total_income: number;
  total_expense: number;
  current_balance: number;
  opened_at: string;
};

type AccountPayable = {
  id: string;
  farmer_id: string;
  farmer_name: string;
  liquidation_number: string | null;
  batch_id: string | null;
  amount: string | number;
  balance: string | number;
  status: string;
  created_at: string;
};

type ProductionPackageKey = "whiteRice" | "broken34" | "fineBroken" | "bran";

type ProductionPackageState = Record<ProductionPackageKey, {
  qq: number;
  pounds: number;
}>;

type OrderPackageState = {
  qq: number;
  pounds: number;
  sackWeightLb: number;
};

type DryerControlEntry = {
  id: string;
  dryer: string;
  producer: string;
  weightQq: number;
};

type MillingReportState = {
  broken34: string;
  fineBroken: string;
  polvillo: string;
  /** N.º de tulas del proceso: base del pago al estibador. */
  tulas: string;
  /** QQ totales de las tulas: base INDEPENDIENTE para pagar al pilador. */
  qqTulas: string;
};

type MillingYieldResult = {
  pilado: number;
  arrocillo: number;
  polvillo: number;
};

type MillingPiladoEntry = {
  id: string;
  presentation: string;
  quantityQq: number;
};

/** Pilado guardado a medias en el servidor (proceso en curso), por túnel. */
type MillingDraft = {
  drying_report_id: string;
  report: Record<string, unknown>;
  pilado_entries: MillingPiladoEntry[];
  saved_at: string;
  tunnel_number?: number;
  total_quintals?: string | number;
  rice_type?: string;
  lot_code?: string;
  /** Si true, ya existe un processing_batch abierto para este túnel. */
  has_open_batch?: boolean;
};

/** Estados financieros: todo se calcula en el servidor desde la operación. */
type FinanzasData = {
  periodo: { desde: string; hasta: string };
  kpis: {
    total_activos: number; total_pasivos: number; patrimonio: number; liquidez: number;
    ventas: number; compras: number; utilidad: number; bancos: number; efectivo: number;
    inventario: number; por_cobrar: number; por_pagar: number; flujo_neto: number;
  };
  balance: {
    fecha: string;
    activo: {
      corriente: {
        efectivo: number; bancos: number; cuentas_por_cobrar: number;
        anticipos_agricultores: number; inventario: number; total: number;
        inventario_detalle: { materia_prima: number; producto_terminado: number; subproductos: number; costo_qq_materia_prima: number; costo_qq_terminado: number };
      };
      no_corriente: { activos_fijos: number; depreciacion_acumulada: number; total: number };
      total: number;
    };
    pasivo: { corriente: { cuentas_por_pagar: number; total: number }; total: number };
    patrimonio: { capital_social: number; resultados_acumulados: number; resultado_ejercicio: number; ajuste_apertura: number; total: number };
    cuadre: number;
  };
  resultados: {
    ingresos: { ventas: number; servicio_pilado: number; total: number };
    costo_ventas: { mercaderia_vendida: number; combustible_secado: number; total: number };
    utilidad_bruta: number; margen_bruto_pct: number;
    gastos_operativos: { gastos_generales: number; mano_obra: number; depreciacion: number; total: number };
    utilidad_neta: number; margen_neto_pct: number;
  };
  flujo: {
    entradas: Array<{ concepto: string; valor: number }>;
    salidas: Array<{ concepto: string; valor: number }>;
    total_entradas: number; total_salidas: number; flujo_neto: number;
    saldo_actual: number; efectivo: number; bancos: number;
  };
  indicadores: Record<string, { valor: number; meta: string; ok: boolean }>;
};

/** Activo fijo (equipo) con su depreciación en línea recta. */
type ActivoFijo = {
  id: string; nombre: string; tipo: string | null; costo: number;
  fecha_compra: string | null; vida_util: number;
  depreciacion_anual: number; depreciacion_acumulada: number; valor_libros: number;
};
type ActivosFijosData = {
  items: ActivoFijo[];
  costo_total: number; depreciacion_acumulada: number; valor_libros: number; depreciacion_anual: number;
};

/** Cuenta bancaria (caja tipo BANCO) y su conciliación. */
type CuentaBancaria = {
  id: string; name: string; banco: string | null; numero_cuenta: string | null;
  saldo_libros: string | number; extractos: number;
};
type PartidaConciliacion = { id: string; fecha: string; descripcion: string; referencia: string | null; monto: number };
type Conciliacion = {
  extracto: {
    id: string; caja: string; banco: string | null; numero_cuenta: string | null;
    periodo_desde: string; periodo_hasta: string; saldo_inicial: number; saldo_final: number;
  };
  lineas_cruzadas: number; lineas_totales: number;
  segun_libros: {
    saldo: number; notas_credito: PartidaConciliacion[]; total_notas_credito: number;
    notas_debito: PartidaConciliacion[]; total_notas_debito: number; saldo_ajustado: number;
  };
  segun_banco: {
    saldo: number; depositos_transito: PartidaConciliacion[]; total_depositos_transito: number;
    cheques_no_cobrados: PartidaConciliacion[]; total_cheques_no_cobrados: number; saldo_ajustado: number;
  };
  diferencia: number; conciliado: boolean;
};

/** Pedido de venta (preventa): promesa al cliente que al despacharse se vuelve venta. */
type SalesOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string | null;
  status: "PENDING" | "DELIVERED" | "CANCELLED";
  delivery_date: string | null;
  notes: string | null;
  total_amount: string | number;
  sale_number: string | null;
  created_at: string;
  items: Array<{ product_name: string; presentation_name: string | null; quantity: string | number; unit_price: string | number; total: string | number }>;
};

/** Resultado de pasar un lote a otro accionista, con la deuda que genera. */
type LotTransferResult = {
  lot_code: string;
  accionista_name: string;
  traspaso?: {
    de: string;
    para: string;
    ya_cancelado: number;
    pendiente_agricultor: number;
  };
};

/** Pilado ya cerrado, con su rendimiento. Alimenta el historial de Producción. */
type ProductionHistoryItem = {
  id: string;
  batch_number: string | null;
  finished_at: string;
  pilador_name: string | null;
  estibador_name: string | null;
  polvillo_worker_name: string | null;
  lot_code: string;
  tunnel_number: number | null;
  rice_type: string | null;
  input_paddy_kg: string | number | null;
  white_rice_qty: string | number | null;
  broken_rice_qty: string | number | null;
  fine_broken_rice_qty: string | number | null;
  bran_qty: string | number | null;
  process_loss_kg: string | number | null;
  yield_percent: string | number | null;
  qq_de_tulas?: string | number | null;
  presentaciones: Array<{
    presentation: string | null;
    sack_weight_lb: string | number | null;
    quantity: string | number;
    unit: string;
  }>;
  /** Si es true, este registro es un servicio de pilado (no una producción propia). */
  is_service?: boolean;
  service_rate?: string | number | null;
  service_total?: string | number | null;
  client_name?: string | null;
};

type SackInventory = {
  id: string;
  tipo: string;
  stock: number;
  updated_at: string;
};

type SackMovement = {
  id: string;
  sack_id: string;
  tipo: string;
  movement: "ENTRADA" | "SALIDA";
  cantidad: number;
  concepto: string | null;
  created_at: string;
};

type Customer = {
  id: string;
  identification: string | null;
  full_name: string;
  phone: string | null;
  address: string | null;
  customer_type: "NATURAL" | "EMPRESA";
  created_at: string;
};

type Sale = {
  id: string;
  sale_number: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  cash_register_id: string | null;
  total_amount: number;
  payment_status: "PAID" | "CONFIRMED" | "PARTIAL";
  sale_status: string;
  created_at: string;
  items_count?: number;
};

type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  warehouse_id: string;
  quantity: number;
  unit_price: number;
  total: number;
};

type AccountsReceivable = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  sale_id: string | null;
  sale_number: string | null;
  description: string | null;
  amount: number;
  balance: number;
  status: "PAID" | "CONFIRMED" | "PARTIAL";
  created_at: string;
};

type Fomento = {
  id: string;
  farmer_name: string;
  farmer_id: string | null;
  cuadras: number;
  inicio: string;
  cosecha: string | null;
  renta: number;
  status: "ACTIVOS" | "NO ACTIVOS" | "APROBADOS";
  notes: string | null;
  created_at: string;
  paradas: number;
  monto_limite: number;
  total_pedido: number;
  gasto_adm: number;
  falta_por_pedir: number;
  deuda_total: number;
  total_pagado: number;
  estado_credito: "HABILITADO" | "DESABILITADO";
};

type FomentoEntrega = {
  id: string;
  fomento_id: string;
  fecha: string;
  valor: number;
  concepto: string | null;
  interes: number;
  suman: number;
  created_at: string;
};

type FomentoPago = {
  id: string;
  fomento_id: string;
  cash_register_id: string | null;
  fecha: string;
  valor: number;
  concepto: string | null;
  created_at: string;
};

type FomentoDetalle = Fomento & { entregas: FomentoEntrega[]; pagos: FomentoPago[]; deuda_total: number; total_pagado: number; };

type Equipment = {
  id: string;
  name: string;
  type: "PILADORA" | "SECADORA" | "OTRO";
  branch_id: string | null;
  status: "ACTIVA" | "MANTENIMIENTO" | "FUERA_SERVICIO";
  created_at: string;
};

type EquipmentMaintenance = {
  id: string;
  equipment_id: string;
  equipment_name: string;
  maintenance_type: "REPUESTO" | "MANO_OBRA" | "PREVENTIVO" | "CORRECTIVO";
  description: string;
  provider: string | null;
  invoice_number: string | null;
  receipt_photo_url: string | null;
  amount: number;
  created_by: string | null;
  created_at: string;
};

type Supplier = {
  id: string;
  name: string;
  identification: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

const navGroups: Array<{ label: string; tabs: string[] }> = [
  { label: "Principal", tabs: ["Dashboard"] },
  { label: "Operación", tabs: ["Bascula", "Secadoras", "Produccion", "Inventario", "Seleccion"] },
  { label: "Comercial", tabs: ["Ventas", "Compras", "Caja"] },
  { label: "Cuentas", tabs: ["Por Cobrar", "Por Pagar"] },
  { label: "Finanzas", tabs: ["Liquidaciones", "Fomentos", "Agricultores", "Nomina", "Cuadrilla", "Servicio Pilado"] },
  { label: "Contabilidad", tabs: ["Estados Financieros"] },
  { label: "Sistema", tabs: ["Reportes", "Configuracion"] }
];
const tabs = navGroups.flatMap((group) => group.tabs);
// Modulos asignables a un operador = TODAS las pestanas del Sidebar excepto
// Configuracion (solo-admin). Fuente unica: navGroups. Si manana se agrega una
// seccion nueva al Sidebar, aparece SOLA como permiso, sin tocar esta lista.
const APP_MODULES: string[] = tabs.filter((t) => t !== "Configuracion");

function NavIcon({ tab }: { tab: string }) {
  switch (tab) {
    case "Dashboard":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>;
    case "Bascula":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="8" y1="2" x2="8" y2="14"/><line x1="5" y1="14" x2="11" y2="14"/><line x1="3" y1="4" x2="13" y2="4"/><path d="M3 4 L2 8 Q2 10 4.5 10 Q7 10 7 8 L6 4"/><path d="M13 4 L14 8 Q14 10 11.5 10 Q9 10 9 8 L10 4"/></svg>;
    case "Secadoras":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1C8 1 3.5 5 3.5 9a4.5 4.5 0 009 0C12.5 5 8 1 8 1zm0 11.5a2.5 2.5 0 01-2.5-2.5c0-1.6 1.3-3.5 2.5-5 1.2 1.5 2.5 3.4 2.5 5a2.5 2.5 0 01-2.5 2.5z"/></svg>;
    case "Agricultores":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5.5" r="3"/><path d="M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5H2z"/></svg>;
    case "Inventario":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1L14 4.5v7L8 15 2 11.5v-7L8 1z"/><line x1="8" y1="1" x2="8" y2="8.5"/><line x1="2" y1="4.5" x2="8" y2="8.5"/><line x1="14" y1="4.5" x2="8" y2="8.5"/></svg>;
    case "Produccion":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4"/></svg>;
    case "Pedidos":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="1" width="10" height="14" rx="1.5"/><line x1="5.5" y1="5.5" x2="10.5" y2="5.5"/><line x1="5.5" y1="8.5" x2="10.5" y2="8.5"/><line x1="5.5" y1="11.5" x2="8.5" y2="11.5"/></svg>;
    case "Caja":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="5" width="14" height="10" rx="1.5"/><path d="M1 9h14"/><path d="M5 5V3.5a3 3 0 016 0V5"/><circle cx="8" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>;
    case "Liquidaciones":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h8a1 1 0 011 1v13l-4.5-2L4 15V2a1 1 0 011-1z"/><line x1="6" y1="6" x2="10" y2="6"/><line x1="6" y1="9" x2="10" y2="9"/></svg>;
    case "Fomentos":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 14V8"/><path d="M5 11l3-3 3 3"/><path d="M2 14h12"/><path d="M4 8C4 5 6 2 8 2s4 3 4 6"/></svg>;
    case "Ventas":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5h12M2 9h12"/><circle cx="8" cy="13" r="1"/><path d="M3 2h10v11H3z"/></svg>;
    case "Compras":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="14" r="1"/><circle cx="12" cy="14" r="1"/><path d="M1 1h2l2 9h8l2-6H4"/></svg>;
    case "Por Cobrar":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h12v8H2z"/><circle cx="8" cy="8" r="2"/><path d="M13 6.5l1.5-1.5M3 9.5L1.5 11"/><path d="M8 1.5V3M8 13v1.5"/></svg>;
    case "Por Pagar":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h12v8H2z"/><path d="M5 8h6M5 8l2-2M5 8l2 2"/></svg>;
    case "Nomina":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="5" r="2.5"/><path d="M3 14c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5"/><circle cx="12.5" cy="4" r="2" fill="currentColor" stroke="none"/></svg>;
    case "Cuadrilla":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="2"/><circle cx="11" cy="5" r="2"/><path d="M1.5 13c0-2 1.5-3.2 3.5-3.2S8.5 11 8.5 13"/><path d="M7.5 13c0-2 1.5-3.2 3.5-3.2s3.5 1.2 3.5 3.2"/></svg>;
    case "Servicio Pilado":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4"/></svg>;
    case "Seleccion":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3a5 5 0 100 10"/><path d="M13 5.5l-3 2.5-1.5-1.5"/><circle cx="5" cy="8" r="1" fill="currentColor" stroke="none"/></svg>;
    case "Estados Financieros":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 13h12"/><rect x="3" y="8" width="2.5" height="5"/><rect x="6.75" y="5" width="2.5" height="8"/><rect x="10.5" y="2" width="2.5" height="11"/></svg>;
    case "Reportes":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="5" y1="11" x2="5" y2="8"/><line x1="8" y1="11" x2="8" y2="5"/><line x1="11" y1="11" x2="11" y2="7"/></svg>;
    case "Configuracion":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="4" x2="14" y2="4"/><circle cx="6" cy="4" r="1.7" fill="currentColor" stroke="none"/><line x1="2" y1="8" x2="14" y2="8"/><circle cx="10.5" cy="8" r="1.7" fill="currentColor" stroke="none"/><line x1="2" y1="12" x2="14" y2="12"/><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg>;
    default:
      return null;
  }
}
// CEYRO es el accionista principal (la piladora, dueño del negocio). Id sembrado.
const CEYRO_ID = "00000000-0000-0000-0000-000000000001";

const SECCIONES_POR_AREA: Record<string, string[]> = {
  SECADORA: ["MOTOR 1", "MOTOR 2", "TÚNEL 1", "TÚNEL 2", "TÚNEL 3"],
  PILADORA: ["MOTOR", "CILINDRO 1", "CILINDRO 2", "PLAN SISTER", "MOTOR PLAN SISTER", "DESCASCARADOR", "PULIDOR 1", "PULIDOR 2", "BANDEJAS PEQUEÑA", "COSEDORAS", "OTROS"],
  ADMINISTRATIVO: ["AIRE ACONDICIONADO", "COMPUTADORAS", "NEVERA PEQUEÑA", "NEVERA GRANDE", "HELERA", "IMPRESORAS", "BÁSCULA"],
  MONTACARGA: ["MOTOR", "RADIADOR", "BATERÍA", "TRANSMISIÓN", "OTROS"]
};

// Catálogo de categorías de caja por tipo de entidad (MATRIZ=CEYRO, SOCIO=ROVINSON/STALYN).
// El código de categoría se guarda como string en cash_movements (sin tocar esa tabla).
// `reuse` marca las que deben registrarse por su flujo dedicado (no como movimiento crudo).
type CashCat = { code: string; label: string; movement: "INCOME" | "EXPENSE"; tipo: "MATRIZ" | "SOCIO" | "AMBOS"; reuse?: "pilado" | "agricultor" | "fomento" };
const CASH_CATEGORIES: CashCat[] = [
  // MATRIZ (CEYRO) — mantiene sus categorías actuales (retrocompatible)
  { code: "GASTO_OPERATIVO", label: "Gasto operativo", movement: "EXPENSE", tipo: "MATRIZ" },
  { code: "GASTO_OFICINA", label: "Gasto de oficina", movement: "EXPENSE", tipo: "MATRIZ" },
  { code: "SERVICIOS_BASICOS", label: "Servicios básicos", movement: "EXPENSE", tipo: "MATRIZ" },
  { code: "PAGO_MANO_OBRA", label: "Pago mano de obra", movement: "EXPENSE", tipo: "MATRIZ" },
  { code: "ANTICIPO_AGRICULTOR", label: "Anticipo agricultor", movement: "EXPENSE", tipo: "MATRIZ" },
  { code: "VENTA_CONTADO", label: "Venta contado", movement: "INCOME", tipo: "MATRIZ" },
  { code: "COBRO_MAQUILA", label: "Cobro maquila", movement: "INCOME", tipo: "MATRIZ" },
  { code: "OTRO_INGRESO", label: "Otro ingreso", movement: "INCOME", tipo: "MATRIZ" },
  // SOCIOS (ROVINSON / STALYN) — operación comercial
  { code: "VENTA_MAYOR", label: "Venta al por mayor", movement: "INCOME", tipo: "SOCIO" },
  { code: "VENTA_DETALLE", label: "Venta al detalle", movement: "INCOME", tipo: "SOCIO" },
  { code: "COBRO_CLIENTE", label: "Cobro cuentas por cobrar (clientes)", movement: "INCOME", tipo: "SOCIO" },
  { code: "APORTE_CAPITAL", label: "Aporte / inyección de capital", movement: "INCOME", tipo: "SOCIO" },
  { code: "OTRO_INGRESO_COMERCIAL", label: "Otro ingreso comercial", movement: "INCOME", tipo: "SOCIO" },
  { code: "PAGO_AGRICULTOR", label: "Pago a agricultor (compra de cáscara)", movement: "EXPENSE", tipo: "SOCIO", reuse: "agricultor" },
  { code: "FOMENTOS", label: "Fomentos / anticipos a agricultores", movement: "EXPENSE", tipo: "SOCIO", reuse: "fomento" },
  { code: "PAGO_SERVICIO_PILADO", label: "Pago servicio de pilado (a CEYRO)", movement: "EXPENSE", tipo: "SOCIO", reuse: "pilado" },
  { code: "FLETE", label: "Servicio de flete / movilización", movement: "EXPENSE", tipo: "SOCIO" },
  { code: "ANTICIPO_CLIENTE_PROV", label: "Anticipo a cliente / proveedor", movement: "EXPENSE", tipo: "SOCIO" },
  { code: "GASTO_COMERCIALIZACION", label: "Gasto operativo de comercialización", movement: "EXPENSE", tipo: "SOCIO" },
  { code: "OTRO_EGRESO", label: "Otro egreso", movement: "EXPENSE", tipo: "SOCIO" }
];
const LB_TO_KG = 0.45359237;
const QQ_TO_LB = 100;
const millingDraftStorageKey = "bascula-erp:milling-report-draft";
const round2 = (n: number) => Math.round(n * 100) / 100;
// crypto.randomUUID solo existe en orígenes "seguros" (https o localhost).
// Desde otra PC por http://IP:4000 —o dentro de una app Android— no está, y
// liquidar reventaría. Este generador funciona en cualquier entorno.
function safeUUID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
// Motor 1 mueve las Secadoras 1 y 2; Motor 2 la Secadora 3. El combustible es
// del motor: se anota una vez y se reparte por QQ entre sus secados activos.
const MOTOR_SECADORAS: Record<1 | 2, string[]> = {
  1: ["Secadora 1", "Secadora 2"],
  2: ["Secadora 3"]
};
const motorDeSecadora = (name?: string | null): 1 | 2 => (String(name ?? "").includes("3") ? 2 : 1);
const dryerOptions = MOTOR_SECADORAS[1].concat(MOTOR_SECADORAS[2]);
// La secadora N seca en el túnel N (mismo número).
const tunelDeSecadora = (name: string) => Number(String(name).replace(/[^\d]/g, "")) || 1;
const secadorStorageKey = (tunnel: number) => `bascula-erp:secador-name:${tunnel}`;
function getSavedSecadorName(tunnel: number): string | undefined {
  try { return localStorage.getItem(secadorStorageKey(tunnel)) || undefined; } catch { return undefined; }
}
function saveSecadorName(tunnel: number, name: string) {
  try { if (name.trim()) localStorage.setItem(secadorStorageKey(tunnel), name.trim()); } catch { /* ignore */ }
}
const piladoPresentations = ["10 LB", "25 LB", "50 LB", "98 LB", "100 LB"];

// Junta las cuentas por pagar de una misma liquidación (mismo batch_id) para
// que no salgan como 3 filas sueltas cuando fue una sola liquidación. Las que
// no tienen batch (traspasos, pilado) quedan cada una en su grupo.
function groupPayables(payables: AccountPayable[]): Array<{ key: string; items: AccountPayable[] }> {
  const grupos = new Map<string, AccountPayable[]>();
  for (const ap of payables) {
    const key = ap.batch_id ? `batch:${ap.batch_id}` : `ap:${ap.id}`;
    const arr = grupos.get(key);
    if (arr) arr.push(ap); else grupos.set(key, [ap]);
  }
  return [...grupos.entries()].map(([key, items]) => ({ key, items }));
}

// "100 LB" -> 100. Sirve para guardar el peso del saco como número.
function sackWeightLbOf(presentation: string): number | undefined {
  const lb = Number(String(presentation).replace(/[^\d.]/g, ""));
  return Number.isFinite(lb) && lb > 0 ? lb : undefined;
}

const defaultProductionPackages: ProductionPackageState = {
  whiteRice: { qq: 0, pounds: 0 },
  broken34: { qq: 0, pounds: 0 },
  fineBroken: { qq: 0, pounds: 0 },
  bran: { qq: 0, pounds: 0 }
};

const defaultOrderPackage: OrderPackageState = {
  qq: 0,
  pounds: 0,
  sackWeightLb: 100
};

const defaultMillingReport: MillingReportState = {
  broken34: "",
  fineBroken: "",
  polvillo: "",
  tulas: "",
  /** QQ totales de las tulas: base INDEPENDIENTE para pagar al pilador. */
  qqTulas: ""
};

const emptyDashboard: Dashboard = {
  active_farmers: 0,
  tickets_today: 0,
  owned_stock: 0,
  pending_advances: 0,
  pending_payables: 0,
  sales_today: 0,
  current_cash_register: null
};

export function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    const user = loadStoredAuth();
    if (user) ensureActiveAccionista(loadStoredAccionistas());
    return user;
  });
  const [accionistas, setAccionistas] = useState<Accionista[]>(() => loadStoredAccionistas());
  const [activeAccionistaId, setActiveAccionistaIdState] = useState<string | null>(() => getActiveAccionistaId());

  function switchAccionista(accionistaId: string) {
    setActiveAccionistaId(accionistaId);
    setActiveAccionistaIdState(accionistaId);
    window.location.reload();
  }

  // Tras iniciar sesión, poblar la lista de accionistas y el activo desde el
  // login recién guardado (evita que queden vacíos hasta recargar la página).
  function handleLogin(user: AuthUser) {
    const accs = loadStoredAccionistas();
    setAccionistas(accs);
    ensureActiveAccionista(accs);
    setActiveAccionistaIdState(getActiveAccionistaId());
    setAuthUser(user);
  }
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("bascula-erp:nav-collapsed") || "[]") as string[]); }
    catch { return new Set(); }
  });
  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      localStorage.setItem("bascula-erp:nav-collapsed", JSON.stringify([...next]));
      return next;
    });
  }
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Listo");
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [panelData, setPanelData] = useState<PanelData | null>(null);
  const [panelMonth, setPanelMonth] = useState(new Date().toISOString().slice(0, 7));
  const [dashView, setDashView] = useState<"panel" | "resumen">("panel");
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [availableDryingLots, setAvailableDryingLots] = useState<MateriaPrimaEntry[]>([]);
  const [dryingReports, setDryingReports] = useState<DryingTunnelReport[]>([]);
  const [liquidacionesList, setLiquidacionesList] = useState<LiqRecord[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [productionResult, setProductionResult] = useState<ProductionResult | null>(null);
  const [traceLotId, setTraceLotId] = useState("");
  const [processFlow, setProcessFlow] = useState<ProcessFlow | null>(null);
  // Cada secadora arma su propio lote: selección de ingresos POR secadora.
  const [dryingSelections, setDryingSelections] = useState<Record<string, string[]>>({});
  const [dryingEntryPick, setDryingEntryPick] = useState<Record<string, string>>({});
  // Tipo de arroz seleccionado por túnel (para filtrar ingresos de materia prima).
  const [dryingRiceType, setDryingRiceType] = useState<Record<string, "0.11" | "CORRIENTE">>({});
  // Motor activo en pantalla: el 1 mueve las Secadoras 1 y 2; el 2, la 3.
  const [motorActivo, setMotorActivo] = useState<1 | 2>(1);
  // Secados sin finalizar del motor (de TODOS los accionistas: el motor es
  // compartido); entre ellos se reparte el combustible según sus QQ.
  const [motorActiveReports, setMotorActiveReports] = useState<MotorActiveReport[]>([]);
  // Túneles ocupados por OTROS accionistas (secado en curso): túnel → nombre del
  // accionista que lo usa. El formulario de llenado bloquea esas secciones.
  const [occupiedTunnels, setOccupiedTunnels] = useState<Record<number, string>>({});
  // Combustible DEL MOTOR: bombona y diesel por medidor (inicio - fin), y
  // cilindros por unidad. Se registra una vez y se reparte.
  const [gasForm, setGasForm] = useState({ bombona_inicio: "", bombona_fin: "", cilindro_cantidad: "", diesel_inicio: "", diesel_fin: "" });
  const [editingDryingReport, setEditingDryingReport] = useState<DryingTunnelReport | null>(null);
  const [productionDryingId, setProductionDryingId] = useState("");
  // Procesos de pilado guardados en el servidor (en curso).
  const [millingDrafts, setMillingDrafts] = useState<MillingDraft[]>([]);
  const [productionHistory, setProductionHistory] = useState<ProductionHistoryItem[]>([]);
  const [productionHistoryOpen, setProductionHistoryOpen] = useState(false);
  const [productionPackages, setProductionPackages] = useState<ProductionPackageState>(defaultProductionPackages);
  const [orderPackage, setOrderPackage] = useState<OrderPackageState>(defaultOrderPackage);
  const [weighingRiceType, setWeighingRiceType] = useState<"0.11" | "CORRIENTE">("0.11");

  // ── Tickets sincronizados de la app de báscula ──────────────────────────────
  const [basculaTickets, setBasculaTickets] = useState<BasculaTicket[]>([]);
  // Ingresos de materia prima sin lote (de todos los accionistas) + su búsqueda,
  // para corregir el accionista cuando se registró con el equivocado.
  const [materiaPrimaEntries, setMateriaPrimaEntries] = useState<MateriaPrimaCorreccion[]>([]);
  const [materiaPrimaSearch, setMateriaPrimaSearch] = useState("");
  const [ticketFilter, setTicketFilter] = useState<"pending" | "liquidated" | "all">("pending");
  const [ticketSearch, setTicketSearch] = useState("");
  const [linkTicket, setLinkTicket] = useState<BasculaTicket | null>(null);
  const [linkFarmerId, setLinkFarmerId] = useState("");
  const [lotTicket, setLotTicket] = useState<BasculaTicket | null>(null);
  const [lotForm, setLotForm] = useState({ rice_type: "0.11" as "0.11" | "CORRIENTE", ownership: "OWNED" as "OWNED" | "MAQUILA", accionista_id: "", product_id: "", warehouse_id: "" });
  const [liqTicket, setLiqTicket] = useState<BasculaTicket | null>(null);
  const [liqPrecio, setLiqPrecio] = useState("");
  const [liqPreview, setLiqPreview] = useState<{ quintals: number; grossPayable: number; advancesDiscount: number; netPayable: number } | null>(null);
  const [selectedDryer, setSelectedDryer] = useState(dryerOptions[0]);
  const [dryerProducer, setDryerProducer] = useState("");
  const [dryerWeightQq, setDryerWeightQq] = useState("");
  const [dryerEntries, setDryerEntries] = useState<DryerControlEntry[]>([]);
  const [millingReport, setMillingReport] = useState<MillingReportState>(defaultMillingReport);
  const [millingPiladoEntries, setMillingPiladoEntries] = useState<MillingPiladoEntry[]>([]);
  const [millingPiladoPresentation, setMillingPiladoPresentation] = useState(piladoPresentations[4]);
  const [millingPiladoQq, setMillingPiladoQq] = useState("");
  const [millingDraftSavedAt, setMillingDraftSavedAt] = useState<string | null>(null);
  const [millingYields, setMillingYields] = useState<MillingYieldResult | null>(null);

  const [toasts, setToasts] = useState<Array<{ id: number; text: string; type?: "success" | "error" | "warn" }>>([]);

  type LiqLine = { lot_id: string; quintals: string; price: string };
  type LiqResultItem = {
    lot_code: string; rice_type: string | null;
    quintals: number; price_per_quintal: number;
    gross_amount: number; advances_discount: number; other_discounts: number; net_amount: number;
  };
  const [liqFarmerId, setLiqFarmerId] = useState("");
  const [liqLines, setLiqLines] = useState<LiqLine[]>([{ lot_id: "", quintals: "", price: "" }]);
  // Ingresos de materia prima que aún no se le han pagado al agricultor.
  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);
  const [discountsOpen, setDiscountsOpen] = useState(false);
  const [liqDiscounts, setLiqDiscounts] = useState({ fomento: "", bascula: "", flete: "", cosechadora: "" });
  const [liqResult, setLiqResult] = useState<LiqResultItem[] | null>(null);

  // ── Caja ──────────────────────────────────────────────────────────────────
  const [cajaSubTab, setCajaSubTab] = useState<"resumen" | "anticipo" | "movimiento" | "gastos" | "sacos" | "mantenimiento" | "equipos" | "venta_detalle" | "cuentas" | "fomentos">("resumen");
  const [movCategory, setMovCategory] = useState("");
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [cashSummary, setCashSummary] = useState<CashSummary | null>(null);
  const [cashPayables, setCashPayables] = useState<AccountPayable[]>([]);
  const [anticipoFarmerId, setAnticipoFarmerId] = useState("");
  const [newCajaTipo, setNewCajaTipo] = useState<"EFECTIVO" | "BANCO">("EFECTIVO");
  const [newCajaName, setNewCajaName] = useState("Caja Principal");
  const [newCajaCash, setNewCajaCash] = useState("0");
  const [newCajaBank, setNewCajaBank] = useState("0");
  const [editOpeningBalance, setEditOpeningBalance] = useState(false);

  // ── Gastos ────────────────────────────────────────────────────────────────
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseForm, setExpenseForm] = useState({ amount: "", description: "", paid_to: "" });
  const [laborForm, setLaborForm] = useState({ worker_group: "", sacks_moved: "", price_per_sack: "" });

  // ── Configuración ─────────────────────────────────────────────────────────
  const [configSubTab, setConfigSubTab] = useState<"negocio" | "usuarios" | "accionistas" | "tarifas" | "actividad" | "datos">("negocio");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [laborRatesForm, setLaborRatesForm] = useState<LaborRates>(defaultLaborRates);

  // ── Nómina (pagos de trabajadores) ────────────────────────────────────────
  const nominaToday = new Date().toISOString().slice(0, 10);
  const nominaMonday = (() => { const d = new Date(); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); })();
  const [nominaFrom, setNominaFrom] = useState(nominaMonday);
  const [nominaTo, setNominaTo] = useState(nominaToday);
  const [nominaRows, setNominaRows] = useState<WorkerSummary[]>([]);
  const [nominaBusy, setNominaBusy] = useState(false);
  const [nominaPaymentDetail, setNominaPaymentDetail] = useState<{ open: boolean; row: WorkerSummary | null; payments: WorkerPaymentDetail[]; loading: boolean }>({
    open: false, row: null, payments: [], loading: false
  });
  const [secadorSugg, setSecadorSugg] = useState<Array<{ worker_name: string; work_date: string; tunnels: number; suggested_amount: number; already_generated: boolean }> | null>(null);
  const [nominaView, setNominaView] = useState<"semana" | "historial">("semana");
  const nomina60Ago = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0, 10); })();
  const [histFrom, setHistFrom] = useState(nomina60Ago);
  const [histTo, setHistTo] = useState(nominaToday);
  const [histRows, setHistRows] = useState<Array<{ worker_role: string; worker_name: string; week_start: string; cnt: number; qq: number; sacas: number; arrocillo: number; earned: number; advances_applied: number; paid_at: string }>>([]);

  // ── Cuadrilla (nómina por actividad) ──────────────────────────────────────
  const [cuadFrom, setCuadFrom] = useState(nominaMonday);
  const [cuadTo, setCuadTo] = useState(nominaToday);
  const [cuadActivities, setCuadActivities] = useState<CuadrillaActivity[]>([]);
  const [cuadEntries, setCuadEntries] = useState<CuadrillaEntry[]>([]);
  const [cuadEntriesTotal, setCuadEntriesTotal] = useState(0);
  const [cuadSummary, setCuadSummary] = useState<{ rows: CuadrillaSummaryRow[]; total_general: number; total_anticipos: number; total_neto: number } | null>(null);
  const [cuadAdvances, setCuadAdvances] = useState<CuadrillaAdvance[]>([]);
  const [cuadView, setCuadView] = useState<"registro" | "resumen" | "actividades">("registro");
  const [cuadEntryForm, setCuadEntryForm] = useState({ work_date: nominaToday, activity_id: "", worker_name: "", quantity: "" });
  const [cuadAdvanceForm, setCuadAdvanceForm] = useState({ worker_name: "", amount: "", concept: "" });
  const [newActivityForm, setNewActivityForm] = useState({ name: "", unit_rate: "" });

  // ── Servicio de pilado (CEYRO a otros accionistas) ────────────────────────
  const [piladoServices, setPiladoServices] = useState<PiladoService[]>([]);
  const [piladoBalances, setPiladoBalances] = useState<PiladoBalance[]>([]);
  const [piladoForm, setPiladoForm] = useState({ client_kind: "accionista" as "accionista" | "externo", client_accionista_id: "", client_name: "", quintals: "", rate_per_qq: localStorage.getItem("bascula-erp:pilado-rate") ?? "", service_date: nominaToday });
  const [piladoReport, setPiladoReport] = useState<PiladoServiceDetail | null>(null);
  const [tarifaVigenteHint, setTarifaVigenteHint] = useState<string>("");
  const [servicioTarifas, setServicioTarifas] = useState<any[]>([]);
  const [tarifaForm, setTarifaForm] = useState({ socio_id: "", servicio: "PILADO", precio_por_qq: "", fecha_vigencia: nominaToday });
  const [costos, setCostos] = useState<any[]>([]);
  const [costoBatches, setCostoBatches] = useState<any[]>([]);
  const [costoForm, setCostoForm] = useState({ processing_batch_id: "", fecha: nominaToday, qq_producidos: "", luz: "", mantenimiento: "", mano_obra: "", combustible: "", desgaste: "", otros: "" });

  // ── Selección / envejecido por lotes (persona externa) ─────────────────────
  const [selectionBatches, setSelectionBatches] = useState<SelectionBatch[]>([]);
  const [selectionProviders, setSelectionProviders] = useState<ExternalProvider[]>([]);
  const [selectionRates, setSelectionRates] = useState<SelectionRates>({ seleccion_rate: 1.25, envejecimiento_rate: 3.5 });
  type LineDraft = { product_id: string; quantity: string; is_reject?: boolean };
  const emptyLine: LineDraft = { product_id: "", quantity: "" };
  // Fase 1: lo que se manda a selectar (varias líneas de producto).
  const [selectionForm, setSelectionForm] = useState({
    service_type: "SELECCION" as "SELECCION" | "ENVEJECIMIENTO",
    provider_id: "",
    warehouse_id: "",
    rate_per_qq: "",
    service_date: nominaToday,
    notes: "",
    inputs: [{ ...emptyLine }] as LineDraft[]
  });
  // Fase 2: al recibir, las salidas de un lote en proceso (por lote id).
  const [finishingBatchId, setFinishingBatchId] = useState<string | null>(null);
  const [finishOutputs, setFinishOutputs] = useState<LineDraft[]>([{ ...emptyLine }]);
  const [newProviderForm, setNewProviderForm] = useState({ name: "", identification: "", phone: "" });
  const [selectionRatesForm, setSelectionRatesForm] = useState({ seleccion_rate: "", envejecimiento_rate: "" });

  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [settingsForm, setSettingsForm] = useState<AppSettings>(defaultAppSettings);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [newUserForm, setNewUserForm] = useState({ name: "", username: "", cedula: "", password: "", role: "OPERADOR" as "ADMINISTRADOR" | "OPERADOR", modules: [] as string[], accionistas: [] as string[] });
  const [permsEditor, setPermsEditor] = useState<{ user: AdminUser; modules: string[] } | null>(null);
  const [adminAccionistas, setAdminAccionistas] = useState<AdminAccionista[]>([]);
  const [newAccionistaForm, setNewAccionistaForm] = useState({ name: "", code: "" });
  const [accionistaEditor, setAccionistaEditor] = useState<{ user: AdminUser; items: Array<{ accionista_id: string; access: boolean; modules: string[] }> } | null>(null);
  // Edición de datos de un usuario registrado (nombre, usuario, clave, rol).
  const [userEditor, setUserEditor] = useState<{ user: AdminUser; name: string; username: string; cedula: string; password: string; role: "ADMINISTRADOR" | "OPERADOR" } | null>(null);
  const [renameAccionista, setRenameAccionista] = useState<{ id: string; name: string; code: string } | null>(null);
  const [resetForm, setResetForm] = useState({ password: "", confirm: "" });
  const [backupInfo, setBackupInfo] = useState<{ directory: string; backups: Array<{ name: string; size_kb: number; created_at: string }> } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  // ── Reportes ──────────────────────────────────────────────────────────────
  const todayIso = new Date().toISOString().slice(0, 10);
  const firstOfMonthIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [reportKind, setReportKind] = useState<ReportKind>("resumen");
  const [reportFrom, setReportFrom] = useState(firstOfMonthIso);
  const [reportTo, setReportTo] = useState(todayIso);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);
  const [reportRows, setReportRows] = useState<{ kind: ReportKind; data: any } | null>(null);
  const [arianosUbic, setArianosUbic] = useState<Record<string, string>>({});
  const [navSearch, setNavSearch] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  // ── Fomentos ──────────────────────────────────────────────────────────────
  const [fomentos, setFomentos] = useState<Fomento[]>([]);
  const [fomentoDetalle, setFomentoDetalle] = useState<FomentoDetalle | null>(null);
  const [fomentoForm, setFomentoForm] = useState({ farmer_name: "", cuadras: "", inicio: new Date().toISOString().slice(0,10), status: "ACTIVOS" as "ACTIVOS"|"NO ACTIVOS"|"APROBADOS", notes: "" });
  const [fomentoEntregaForm, setFomentoEntregaForm] = useState({ fecha: new Date().toISOString().slice(0,10), valor: "", concepto: "" });
  const [fomentoFilter, setFomentoFilter] = useState<"TODOS"|"ACTIVOS"|"NO ACTIVOS"|"APROBADOS">("TODOS");
  const [fomentoEditingRenta, setFomentoEditingRenta] = useState<string | null>(null);
  const [fomentoRentaInput, setFomentoRentaInput] = useState("");
  const [fomentoPagoForm, setFomentoPagoForm] = useState({ fecha: new Date().toISOString().slice(0,10), valor: "", concepto: "" });
  const [fomentoImporting, setFomentoImporting] = useState(false);
  const [fomentoImportModal, setFomentoImportModal] = useState<{ open: boolean; title: string; message: string; isError: boolean } | null>(null);
  // ── Pilador / Estibador en Producción ────────────────────────────────────
  const [piladorName, setPiladorName] = useState(() => {
    try { return localStorage.getItem("bascula-erp:pilador-name") || ""; } catch { return ""; }
  });
  const [estibadorName, setEstibadorName] = useState(() => {
    try { return localStorage.getItem("bascula-erp:estibador-name") || ""; } catch { return ""; }
  });
  const [polvilloWorkerName, setPolvilloWorkerName] = useState(() => {
    try { return localStorage.getItem("bascula-erp:polvillo-worker-name") || ""; } catch { return ""; }
  });

  // Guardar automáticamente los nombres de pilador, estibador y encargado de
  // polvillo para no tener que tipearlos en cada pilada.
  useEffect(() => {
    try { if (piladorName.trim()) localStorage.setItem("bascula-erp:pilador-name", piladorName.trim()); } catch { /* ignore */ }
  }, [piladorName]);
  useEffect(() => {
    try { if (estibadorName.trim()) localStorage.setItem("bascula-erp:estibador-name", estibadorName.trim()); } catch { /* ignore */ }
  }, [estibadorName]);
  useEffect(() => {
    try { if (polvilloWorkerName.trim()) localStorage.setItem("bascula-erp:polvillo-worker-name", polvilloWorkerName.trim()); } catch { /* ignore */ }
  }, [polvilloWorkerName]);

  // ── Inventario de Sacos ───────────────────────────────────────────────────
  const [sackInventory, setSackInventory] = useState<SackInventory[]>([]);
  const [sackMovements, setSackMovements] = useState<SackMovement[]>([]);
  const [sackMovForm, setSackMovForm] = useState({ sack_id: "", movement: "ENTRADA" as "ENTRADA"|"SALIDA", cantidad: "", concepto: "" });
  // ── Diagnóstico de stocks negativos ────────────────────────────────────────
  const [negativeStock, setNegativeStock] = useState<NegativeStockRow[]>([]);
  const [negativeStockOpen, setNegativeStockOpen] = useState(false);

  // ── Clientes y Ventas ──────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [accountsReceivable, setAccountsReceivable] = useState<AccountsReceivable[]>([]);
  const [newCustomerForm, setNewCustomerForm] = useState({ full_name: "", phone: "", address: "", customer_type: "NATURAL" as "NATURAL"|"EMPRESA" });

  // ── Buscador de clientes en formulario de venta ──
  const [customerSearch, setCustomerSearch] = useState("");
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [showQuickNewCustomer, setShowQuickNewCustomer] = useState(false);
  const [quickNewCustomerForm, setQuickNewCustomerForm] = useState({ full_name: "", phone: "" });

  // ── Presentaciones dinámicas en venta ──
  const [saleProductPresentations, setSaleProductPresentations] = useState<any[]>([]);
  const [selectedPresentationId, setSelectedPresentationId] = useState("");

  // ── Carrito de pedido (múltiples líneas) ──
  type SaleLineItem = {
    id: string; // temp ID para UI
    product_id: string;
    presentation_id: string;
    presentation_name: string; // Para mostrar en tabla
    /** Libras por saco de la presentación: permite mostrar QQ y validar stock. */
    weight_lb: number | null;
    quantity: number;
    unit_price: number;
  };
  const [saleLineItems, setSaleLineItems] = useState<SaleLineItem[]>([]);
  // Pedidos de venta (preventa) y forma de pago elegida al despachar cada uno.
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  // Estados financieros: se piden al servidor, que los calcula desde la operación.
  const [finanzas, setFinanzas] = useState<FinanzasData | null>(null);
  const [finanzasDesde, setFinanzasDesde] = useState(`${new Date().getFullYear()}-01-01`);
  const [finanzasHasta, setFinanzasHasta] = useState(new Date().toISOString().slice(0, 10));
  // Conciliación bancaria
  const [cuentasBanco, setCuentasBanco] = useState<CuentaBancaria[]>([]);
  const [conciliacion, setConciliacion] = useState<Conciliacion | null>(null);
  const [extractoForm, setExtractoForm] = useState({ cash_register_id: "", saldo_final: "", texto: "" });
  // Activos fijos: los equipos ya existen; aquí se cargan sus datos contables.
  const [activosFijos, setActivosFijos] = useState<ActivosFijosData | null>(null);
  const [activoEdit, setActivoEdit] = useState<Record<string, { costo: string; fecha: string; vida: string }>>({});
  const [orderPayMethod, setOrderPayMethod] = useState<Record<string, string>>({});
  /** Pedido que se está editando (sus líneas vuelven al carrito). */
  const [pedidoEditando, setPedidoEditando] = useState<string | null>(null);
  const [saleLineForm, setSaleLineForm] = useState({
    product_id: "",
    presentation_id: "",
    quantity: "",
    unit_price: ""
  });

  // Sub-tab Fomentos en Caja
  const [cajaFomentoId, setCajaFomentoId] = useState("");
  const [cajaFomentoAccion, setCajaFomentoAccion] = useState<"entrega"|"pago">("entrega");
  const [cajaFomentoMonto, setCajaFomentoMonto] = useState("");
  const [cajaFomentoConcepto, setCajaFomentoConcepto] = useState("");

  // ── Compra de Sacos en Caja ────────────────────────────────────────────
  const [sackBuyForm, setSackBuyForm] = useState({ sack_id: "", cantidad: "", precio: "" });

  // ── Venta Detalle (por libra) en Caja ──────────────────────────────────
  const [ventaDetalleForm, setVentaDetalleForm] = useState({
    product_id: "",
    cantidad_libras: "",
    precio_por_libra: "",
    customer_id: ""
  });

  // ── Mantenimiento de Equipos ───────────────────────────────────────────
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [maintenanceForm, setMaintenanceForm] = useState({
    area: "",
    section: "",
    maintenance_type: "CORRECTIVO" as "REPUESTO" | "MANO_OBRA" | "PREVENTIVO" | "CORRECTIVO",
    description: "",
    provider: "",
    invoice_number: "",
    receipt_photo_url: "",
    amount: ""
  });
  const [maintenanceHistory, setMaintenanceHistory] = useState<any[]>([]);
  const [maintFilter, setMaintFilter] = useState({ from: "", to: "", area: "", type: "" });
  const [newEquipmentForm, setNewEquipmentForm] = useState({
    name: "",
    type: "PILADORA" as "PILADORA" | "SECADORA" | "MOTOR" | "OTRO",
    status: "ACTIVA" as "ACTIVA" | "MANTENIMIENTO" | "FUERA_SERVICIO",
    code: "",
    brand: "",
    model: "",
    serial: "",
    location: ""
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierForm, setSupplierForm] = useState({ name: "", identification: "", phone: "", email: "", address: "", notes: "" });
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierEdit, setSupplierEdit] = useState({ name: "", identification: "", phone: "", email: "", address: "", notes: "" });
  const [purchases, setPurchases] = useState<any[]>([]);
  const [purchaseFilter, setPurchaseFilter] = useState({ from: "", to: "", supplier_id: "", payment_type: "" });
  const [invMovs, setInvMovs] = useState<any[]>([]);
  const [invFilter, setInvFilter] = useState({ from: "", to: "", movement: "" });
  const [purchaseForm, setPurchaseForm] = useState({
    supplier_id: "",
    payment_type: "CASH" as "CASH" | "CREDIT",
    due_date: "",
    invoice_number: "",
    notes: ""
  });
  const [purchaseItems, setPurchaseItems] = useState<Array<{
    item_type: "INSUMO" | "PRODUCT";
    insumo_id: string;
    product_id: string;
    warehouse_id: string;
    quantity: string;
    unit_price: string;
  }>>([{ item_type: "INSUMO", insumo_id: "", product_id: "", warehouse_id: "", quantity: "", unit_price: "" }]);

  const addToast = useCallback((text: string, type?: "success" | "error" | "warn") => {
    const id = Date.now();
    setToasts((prev) => [...prev.slice(-4), { id, text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  useEffect(() => {
    if (!message || message === "Listo") return;
    const isError = /error|falla|falt[ao]|no se pudo|inv[aá]lido|seleccione|ingrese/i.test(message);
    addToast(message, isError ? "error" : "success");
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps

  const rawProduct = useMemo(
    () => products.find((product) => product.code === "CASCARA-011") ?? products.find((product) => product.code === "ARROZ-CASCARA") ?? products[0],
    [products]
  );
  const rawProduct011 = useMemo(
    () => products.find((product) => product.code === "CASCARA-011") ?? rawProduct,
    [products, rawProduct]
  );
  const rawProductCorriente = useMemo(
    () => products.find((product) => product.code === "CASCARA-CORRIENTE") ?? rawProduct,
    [products, rawProduct]
  );
  const rawWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.type === "RAW_MATERIAL") ?? warehouses[0],
    [warehouses]
  );
  const finishedWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.type === "FINISHED_GOODS") ?? warehouses[0],
    [warehouses]
  );
  const whiteRiceProduct = useMemo(
    () =>
      products.find((product) => product.code === "ARROZ-PILADO-011") ??
      products.find((product) => product.code.includes("BLANCO") || product.name.toUpperCase().includes("BLANCO")) ??
      products[0],
    [products]
  );
  const whiteRiceCorrienteProduct = useMemo(
    () => products.find((product) => product.code === "ARROZ-PILADO-CORRIENTE") ?? whiteRiceProduct,
    [products, whiteRiceProduct]
  );
  const broken34Product = useMemo(
    () => products.find((product) => product.code === "ARROCILLO-34") ?? products.find((product) => product.name.toUpperCase().includes("ARROCILLO")) ?? products[0],
    [products]
  );
  const fineBrokenProduct = useMemo(
    () => products.find((product) => product.code === "ARROCILLO-FINO") ?? products.find((product) => product.name.toUpperCase().includes("ARROCILLO")) ?? products[0],
    [products]
  );
  const branProduct = useMemo(
    () =>
      products.find(
        (product) =>
          product.code.includes("POLVILLO") ||
          product.name.toUpperCase().includes("POLVILLO") ||
          product.name.toUpperCase().includes("AFRECHO")
      ) ?? products[0],
    [products]
  );
  const sacksSupply = useMemo(
    () => insumos.find((item) => item.nombre.toUpperCase().includes("SACO")) ?? insumos[0],
    [insumos]
  );
  const currentInventoryProducts = useMemo(
    () => products.filter(isCurrentStockProduct),
    [products]
  );
  const visibleInventoryProducts = useMemo(
    () => (currentInventoryProducts.length > 0 ? currentInventoryProducts : products.filter((product) => product.product_type !== "SUPPLY")),
    [currentInventoryProducts, products]
  );
  const saleProducts = useMemo(
    () => visibleInventoryProducts.filter((product) => ["FINISHED_GOOD", "BYPRODUCT"].includes(product.product_type)),
    [visibleInventoryProducts]
  );
  const inventoryAdjustmentProducts = useMemo(
    () => visibleInventoryProducts.filter((product) => product.product_type !== "SUPPLY"),
    [visibleInventoryProducts]
  );
  const rawStockRows = useMemo(
    () =>
      buildDisplayStockRows(
        visibleInventoryProducts.filter((product) => product.code.startsWith("CASCARA")),
        stock,
        rawWarehouse?.name ?? "Bodega Materia Prima"
      ),
    [rawWarehouse?.name, stock, visibleInventoryProducts]
  );
  const finishedStockRows = useMemo(
    () =>
      buildDisplayStockRows(
        visibleInventoryProducts.filter((product) => product.code.startsWith("ARROZ-PILADO")),
        stock,
        finishedWarehouse?.name ?? "Bodega Producto Terminado"
      ),
    [finishedWarehouse?.name, stock, visibleInventoryProducts]
  );
  const byproductStockRows = useMemo(
    () =>
      buildDisplayStockRows(
        visibleInventoryProducts.filter((product) => ["ARROCILLO-34", "ARROCILLO-FINO", "POLVILLO"].includes(product.code)),
        stock,
        finishedWarehouse?.name ?? "Bodega Producto Terminado"
      ),
    [finishedWarehouse?.name, stock, visibleInventoryProducts]
  );
  const otherStockRows = useMemo(
    () => stock.filter((row) => !["Cascara", "Producto", "Subproducto"].includes(stockGroupLabel(row))),
    [stock]
  );
  const criticalSupplies = useMemo(
    () => insumos.filter((item) => item.is_critical),
    [insumos]
  );
  const materiaPrimaFiltrada = useMemo(() => {
    const q = materiaPrimaSearch.trim().toLowerCase();
    if (!q) return materiaPrimaEntries;
    return materiaPrimaEntries.filter((e) =>
      `${e.numero_bascula ?? ""} ${e.ticket_number} ${e.farmer_name ?? ""} ${e.accionista_name ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [materiaPrimaEntries, materiaPrimaSearch]);
  // ── Selección de ingresos POR SECADORA (cada una arma su propio lote) ──────
  const seleccionDe = (secadora: string) => dryingSelections[secadora] ?? [];
  // Un ingreso agregado en una secadora no debe aparecer en la otra.
  const idsUsados = new Set(Object.values(dryingSelections).flat());
  const entradasLibres = availableDryingLots.filter((lot) => !idsUsados.has(lot.id));
  // Se compara por número ("Secador 1" viejo y "Secadora 1" son la misma).
  const editandoEnSecadora = (secadora: string) =>
    editingDryingReport && tunelDeSecadora(editingDryingReport.dryer_name ?? "1") === tunelDeSecadora(secadora)
      ? editingDryingReport
      : null;
  const lotesDe = (secadora: string): DryingTunnelLot[] => {
    const editando = editandoEnSecadora(secadora);
    if (editando) return editando.lots;
    return availableDryingLots
      .filter((entry) => seleccionDe(secadora).includes(entry.id))
      .map((entry) => ({
        lot_id: entry.id,
        lot_code: entryLabel(entry),
        farmer_name: entry.farmer_name,
        net_weight_kg: entry.net_weight ?? 0,
        quintals: entry.quintals ?? 0
      }));
  };
  const qqDe = (secadora: string) => lotesDe(secadora).reduce((s, l) => s + Number(l.quintals ?? 0), 0);
  const kgDe = (secadora: string) => lotesDe(secadora).reduce((s, l) => s + Number(l.net_weight_kg ?? 0), 0);

  // ── Combustible DEL MOTOR, calculado en vivo (el backend lo recalcula al
  // guardar). Los medidores marcan lo que queda: inicio − fin es lo consumido.
  // El costo se reparte entre los secados activos del motor según sus QQ.
  const gasBombonaTotal = Math.max(0, Number(gasForm.bombona_inicio || 0) - Number(gasForm.bombona_fin || 0));
  const gasBombonaCosto = round2(gasBombonaTotal * Number(laborRatesForm.precio_gas_bombona || 0));
  const gasCilindroCosto = round2(Number(gasForm.cilindro_cantidad || 0) * Number(laborRatesForm.precio_gas_cilindro || 0));
  const dieselTotal = Math.max(0, Number(gasForm.diesel_inicio || 0) - Number(gasForm.diesel_fin || 0));
  const dieselCosto = round2(dieselTotal * Number(laborRatesForm.precio_diesel || 0));
  const gasCostoTotal = round2(gasBombonaCosto + gasCilindroCosto);
  const combustibleTotal = round2(gasCostoTotal + dieselCosto);
  // QQ que están secándose con este motor (todos los accionistas juntos).
  // QQ entre los que se repartirá el combustible: las secadoras que se están
  // llenando ahora (aunque no estén guardadas todavía) MÁS los secados del
  // motor que ya estaban activos de antes y no se repiten en el formulario.
  const tunelesEnForm = new Set(
    MOTOR_SECADORAS[motorActivo].filter((s) => qqDe(s) > 0).map((s) => tunelDeSecadora(s))
  );
  const qqEnForm = MOTOR_SECADORAS[motorActivo].reduce((s, sec) => s + qqDe(sec), 0);
  const qqPreviosMotor = motorActiveReports
    .filter((r) => !tunelesEnForm.has(r.tunnel_number))
    .reduce((s, r) => s + Number(r.total_quintals ?? 0), 0);
  const qqMotor = round2(qqEnForm + qqPreviosMotor);
  const combustiblePorQq = qqMotor > 0 ? round2(combustibleTotal / qqMotor) : 0;
  // Por separado (gas = bombona + cilindro; diésel = medidor).
  const gasPorQq = qqMotor > 0 ? round2(gasCostoTotal / qqMotor) : 0;
  const dieselPorQq = qqMotor > 0 ? round2(dieselCosto / qqMotor) : 0;
  const productionDryingReports = useMemo(
    () => dryingReports.filter((report) => report.status === "COMPLETED" && !report.is_processed && !report.apartado_arianos),
    [dryingReports]
  );
  const selectedProductionDrying = useMemo(
    () => dryingReports.find((report) => report.id === productionDryingId) ?? null,
    [dryingReports, productionDryingId]
  );
  const millingPiladoTotalQq = useMemo(
    () => (Array.isArray(millingPiladoEntries) ? millingPiladoEntries : []).reduce((sum, entry) => sum + entry.quantityQq, 0),
    [millingPiladoEntries]
  );
  const productionTotalQq = useMemo(
    () => Object.values(productionPackages ?? defaultProductionPackages).reduce((sum, item) => sum + qqAndPoundsToQq(item), 0),
    [productionPackages]
  );
  const productionOutputKg = useMemo(
    () =>
      Object.values(productionPackages ?? defaultProductionPackages).reduce((sum, item) => sum + qqAndPoundsToKg(item), 0),
    [productionPackages]
  );
  const orderQuantityQq = useMemo(() => qqAndPoundsToQq(orderPackage), [orderPackage]);
  const orderSacksUsed = useMemo(() => sacksNeededForOrder(orderPackage), [orderPackage]);
  const selectedDryerEntries = useMemo(
    () => dryerEntries.filter((entry) => entry.dryer === selectedDryer),
    [dryerEntries, selectedDryer]
  );
  const safeMillingPiladoEntries = useMemo(
    () => (Array.isArray(millingPiladoEntries) ? millingPiladoEntries : []),
    [millingPiladoEntries]
  );
  const selectedDryerTotalQq = useMemo(
    () => (Array.isArray(selectedDryerEntries) ? selectedDryerEntries : []).reduce((sum, entry) => sum + entry.weightQq, 0),
    [selectedDryerEntries]
  );
  // Se liquida el ingreso de materia prima (lo que el agricultor entregó), no
  // el lote: el lote se forma en la secadora y puede juntar varios agricultores.
  const farmerLots = useMemo(
    () => liqFarmerId ? pendingEntries.filter((e) => e.farmer_id === liqFarmerId) : [],
    [pendingEntries, liqFarmerId]
  );

  const liqGrossTotal = useMemo(() =>
    liqLines.reduce((sum, line) => {
      if (!line.lot_id || !line.price) return sum;
      const lot = lots.find((l) => l.id === line.lot_id);
      const qq = Number(line.quintals) || Number(lot?.quintals ?? 0);
      return sum + qq * Number(line.price);
    }, 0),
    [liqLines, lots]
  );

  const liqQqTotal = useMemo(() =>
    liqLines.reduce((sum, line) => {
      if (!line.lot_id) return sum;
      const lot = lots.find((l) => l.id === line.lot_id);
      return sum + (Number(line.quintals) || Number(lot?.quintals ?? 0));
    }, 0),
    [liqLines, lots]
  );

  const farmersWithLots = useMemo(
    () => farmers.filter((f) => pendingEntries.some((e) => e.farmer_id === f.id)),
    [farmers, pendingEntries]
  );

  const farmersWithAdvances = useMemo(
    () => farmers.filter((f) => Number(f.pending_advance_balance) > 0),
    [farmers]
  );

  const farmersForAnticipo = useMemo(() =>
    farmers
      .map((f) => ({
        id: f.id,
        full_name: f.full_name,
        pendingQq: pendingEntries
          .filter((e) => e.farmer_id === f.id)
          .reduce((s, e) => s + Number(e.quintals ?? 0), 0),
      }))
      .filter((f) => f.pendingQq > 0),
    [farmers, pendingEntries]
  );

  // Agricultores con saldo pendiente en liquidaciones (para anticipo en tab Liquidaciones)
  const farmersWithPendingLiq = useMemo(() => {
    const pendingByFarmer = new Map<string, { name: string; pending: number }>();
    for (const r of liquidacionesList) {
      const bal = Number(r.pending_balance ?? 0);
      if (bal > 0) {
        const prev = pendingByFarmer.get(r.farmer_id);
        pendingByFarmer.set(r.farmer_id, {
          name: r.farmer_name,
          pending: (prev?.pending ?? 0) + bal
        });
      }
    }
    return Array.from(pendingByFarmer.entries()).map(([id, v]) => ({
      id,
      full_name: v.name,
      pending_advance_balance: v.pending
    }));
  }, [liquidacionesList]);

  type LiqBatch = {
    key: string;
    batch_id: string | null;
    liquidation_ids: string[];
    farmer_name: string;
    farmer_id: string;
    created_at: string;
    lots: Array<{ lot_code: string | null; rice_type: string | null; quintals: number; price_per_quintal: number }>;
    gross_total: number;
    advances_total: number;
    other_disc_total: number;
    discount_breakdown: DiscountBreakdown;
    net_total: number;
    pending_total: number;
    /** true solo si TODAS las liquidaciones del grupo están desbloqueadas. */
    unlocked: boolean;
  };
  const liqBatches = useMemo((): LiqBatch[] => {
    // Ordenar de más reciente a más antiguo para mostrar así
    const sorted = [...liquidacionesList].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const batches: LiqBatch[] = [];

    for (const r of sorted) {
      const rTime = new Date(r.created_at).getTime();

      // 1) Si tiene batch_id → buscar batch existente con mismo batch_id
      if (r.batch_id) {
        const existing = batches.find((b) => b.batch_id === r.batch_id);
        if (existing) {
          existing.liquidation_ids.push(r.id);
          existing.lots.push({ lot_code: r.lot_code, rice_type: r.rice_type, quintals: Number(r.quintals), price_per_quintal: Number(r.price_per_quintal) });
          existing.gross_total    += Number(r.gross_amount);
          existing.advances_total += Number(r.advances_discount);
          existing.other_disc_total += Number(r.other_discounts);
          existing.net_total      += Number(r.net_amount);
          existing.pending_total  += Number(r.pending_balance);
          existing.unlocked = existing.unlocked && (r.edit_unlocked ?? false);
          continue;
        }
      } else {
        // 2) Sin batch_id → agrupar por agricultor + ventana de 15 segundos
        const existing = batches.find(
          (b) =>
            b.batch_id === null &&
            b.farmer_name === r.farmer_name &&
            Math.abs(new Date(b.created_at).getTime() - rTime) <= 15000
        );
        if (existing) {
          existing.liquidation_ids.push(r.id);
          existing.lots.push({ lot_code: r.lot_code, rice_type: r.rice_type, quintals: Number(r.quintals), price_per_quintal: Number(r.price_per_quintal) });
          existing.gross_total    += Number(r.gross_amount);
          existing.advances_total += Number(r.advances_discount);
          existing.other_disc_total += Number(r.other_discounts);
          existing.net_total      += Number(r.net_amount);
          existing.pending_total  += Number(r.pending_balance);
          existing.unlocked = existing.unlocked && (r.edit_unlocked ?? false);
          continue;
        }
      }

      const bd = r.discount_breakdown ?? { fomento: 0, bascula: 0, flete: 0, cosechadora: 0 };
      // 3) Crear nuevo batch
      batches.push({
        key: r.batch_id ?? r.id,
        batch_id: r.batch_id,
        liquidation_ids: [r.id],
        farmer_name: r.farmer_name,
        farmer_id: r.farmer_id,
        created_at: r.created_at,
        lots: [{ lot_code: r.lot_code, rice_type: r.rice_type, quintals: Number(r.quintals), price_per_quintal: Number(r.price_per_quintal) }],
        gross_total:        Number(r.gross_amount),
        advances_total:     Number(r.advances_discount),
        other_disc_total:   Number(r.other_discounts),
        discount_breakdown: { fomento: Number(bd.fomento), bascula: Number(bd.bascula), flete: Number(bd.flete), cosechadora: Number(bd.cosechadora) },
        net_total:          Number(r.net_amount),
        pending_total:      Number(r.pending_balance),
        unlocked:           r.edit_unlocked ?? false,
      });
    }

    return batches;
  }, [liquidacionesList]);

  const [liqEdit, setLiqEdit] = useState<LiqBatch | null>(null);
  const [liqEditRows, setLiqEditRows] = useState<Array<{ id: string; lot_code: string | null; price: string; other: string }>>([]);

  const liqDiscountsTotal = useMemo(() =>
    Object.values(liqDiscounts).reduce((sum, v) => sum + Number(v || 0), 0),
    [liqDiscounts]
  );

  // Deuda de fomento ACTIVA de un agricultor: al liquidarlo, este valor se
  // carga automáticamente como descuento "Fomento" (último apartado del
  // módulo Liquidación). Coincide por farmer_id y, como respaldo, por nombre
  // (los fomentos antiguos no siempre traen farmer_id). Si no hay, null.
  const fomentoDeudaDeAgricultor = useMemo(() => {
    const norm = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();
    const acumular = (mapa: Map<string, { deuda: number; nombres: string[] }>, clave: string, deuda: number, nombre: string) => {
      const cur = mapa.get(clave) ?? { deuda: 0, nombres: [] };
      cur.deuda += deuda;
      if (!cur.nombres.includes(nombre)) cur.nombres.push(nombre);
      mapa.set(clave, cur);
    };
    const mapa = new Map<string, { deuda: number; nombres: string[] }>();
    for (const f of fomentos) {
      if (f.status !== "ACTIVOS") continue;
      const deuda = Number(f.deuda_total ?? 0);
      if (deuda <= 0) continue;
      if (f.farmer_id) acumular(mapa, `id:${f.farmer_id}`, deuda, f.farmer_name);
      if (norm(f.farmer_name)) acumular(mapa, `nm:${norm(f.farmer_name)}`, deuda, f.farmer_name);
    }
    for (const v of mapa.values()) v.deuda = round2(v.deuda);
    return mapa;
  }, [fomentos]);
  const liqFomentoAuto = useMemo(() => {
    if (!liqFarmerId) return null;
    const porId = fomentoDeudaDeAgricultor.get(`id:${liqFarmerId}`);
    if (porId) return porId;
    const farmer = farmers.find((f) => f.id === liqFarmerId);
    const nombre = String(farmer?.full_name ?? "").trim().toUpperCase();
    return nombre ? fomentoDeudaDeAgricultor.get(`nm:${nombre}`) ?? null : null;
  }, [liqFarmerId, fomentoDeudaDeAgricultor, farmers]);

  const setupScore = useMemo(() => {
    const checks = [
      farmers.length > 0,
      products.length >= 7,
      warehouses.length >= 2,
      insumos.length > 0,
      dashboard.current_cash_register !== null
    ];
    return checks.filter(Boolean).length;
  }, [dashboard.current_cash_register, farmers.length, insumos.length, products.length, warehouses.length]);

  async function refresh() {
    setLoading(true);
    try {
      const online = await checkHealth();
      setApiOnline(online);
      if (!online) return;

      const [
        dash,
        farmerRows,
        productRows,
        warehouseRows,
        lotRows,
        stockRows,
        supplyRows,
        dryingLotRows,
        dryingReportRows,
        liqRows,
        pendingEntryRows
      ] = await Promise.all([
        apiGet<Dashboard>("/dashboard"),
        apiGet<Farmer[]>("/farmers"),
        apiGet<Product[]>("/inventory/products"),
        apiGet<Warehouse[]>("/inventory/warehouses"),
        apiGet<Lot[]>("/lots"),
        apiGet<StockRow[]>("/inventory/stock"),
        apiGet<Insumo[]>("/inventory/insumos"),
        apiGet<MateriaPrimaEntry[]>("/process-flow/drying/available-lots"),
        apiGet<DryingTunnelReport[]>("/process-flow/drying/reports"),
        apiGet<LiqRecord[]>("/liquidations"),
        apiGet<PendingEntry[]>("/liquidations/pending-entries")
      ]);

      setDashboard(dash);
      setFarmers(farmerRows);
      setProducts(productRows);
      setWarehouses(warehouseRows);
      setLots(lotRows);
      setAvailableDryingLots(dryingLotRows);
      setDryingReports(dryingReportRows);
      setLiquidacionesList(liqRows);
      setPendingEntries(pendingEntryRows);
      setStock(stockRows);
      setInsumos(supplyRows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authUser) return;
    refresh().catch((error) => {
      setMessage(error.message);
      setLoading(false);
    });
    apiGet<AppSettings>("/settings").then(setAppSettings).catch(() => undefined);
  }, [authUser, activeAccionistaId]);

  // Renueva la sesión mientras la app está en uso, para no cerrar sesión a media
  // jornada. Al renovar se releen los permisos (y expulsa a usuarios desactivados).
  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    async function renewSession() {
      try {
        const result = await apiPost<{ token: string; user: AuthUser; accionistas: Accionista[] }>("/auth/refresh", {});
        if (cancelled) return;
        localStorage.setItem(authStorageKey, JSON.stringify(result));
        setAccionistas(result.accionistas ?? []);
        ensureActiveAccionista(result.accionistas);
        setActiveAccionistaIdState(getActiveAccionistaId());
        setAuthUser(result.user);
      } catch {
        // Un 401 lo maneja api.ts (cierra sesión). Otros errores se ignoran.
      }
    }
    const interval = window.setInterval(renewSession, 30 * 60 * 1000); // cada 30 min
    const onFocus = () => renewSession();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  async function refreshCaja(registerId?: string) {
    const id = registerId ?? dashboard.current_cash_register?.id;
    if (!id) return;
    const [summary, movements, payables, expenseRows] = await Promise.all([
      apiGet<CashSummary>(`/cash/registers/${id}/summary`),
      apiGet<CashMovement[]>(`/cash/registers/${id}/movements`),
      apiGet<AccountPayable[]>("/cash/payables"),
      apiGet<Expense[]>("/expenses").catch(() => [] as Expense[])
    ]);
    setCashSummary(summary);
    setCashMovements(movements);
    setCashPayables(payables);
    setExpenses(expenseRows);
  }

  async function reverseCashMovement(m: CashMovement) {
    const reason = window.prompt(
      `Anular ${m.movement === "INCOME" ? "ingreso" : "egreso"} de ${money(Number(m.amount))}?\n\nEscribe el motivo (queda registrado y no se puede deshacer):`
    );
    if (reason === null) return;
    if (reason.trim().length < 3) { addToast("El motivo debe tener al menos 3 caracteres", "error"); return; }
    const registerId = dashboard.current_cash_register?.id;
    try {
      await apiPost(`/cash/movements/${m.id}/reverse`, { reason: reason.trim() });
      addToast("Movimiento anulado (contra-asiento registrado)", "success");
      if (registerId) await refreshCaja(registerId);
    } catch (err) {
      addToast(`No se pudo anular: ${err instanceof Error ? err.message : "error"}`, "error");
    }
  }

  async function submitExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) { addToast("No hay caja abierta", "error"); return; }
    const amount = Number(expenseForm.amount);
    if (!amount || amount <= 0 || expenseForm.description.trim().length < 2) {
      addToast("Ingresa monto y descripción del gasto", "error");
      return;
    }
    await apiPost("/expenses", {
      cash_register_id: registerId,
      amount,
      description: expenseForm.description.trim(),
      paid_to: expenseForm.paid_to.trim() || undefined
    });
    setExpenseForm({ amount: "", description: "", paid_to: "" });
    addToast("Gasto registrado y descontado de caja", "success");
    await refreshCaja(registerId);
  }

  async function submitLaborPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) { addToast("No hay caja abierta", "error"); return; }
    const sacks = Number(laborForm.sacks_moved);
    const price = Number(laborForm.price_per_sack);
    if (laborForm.worker_group.trim().length < 2 || !sacks || sacks <= 0 || price < 0) {
      addToast("Ingresa cuadrilla, sacos y precio por saco", "error");
      return;
    }
    const total = round2(sacks * price);
    await apiPost("/expenses/labor-payments", {
      cash_register_id: registerId,
      worker_group: laborForm.worker_group.trim(),
      sacks_moved: sacks,
      price_per_sack: price
    });
    await apiPost("/cash/movements", {
      cash_register_id: registerId,
      movement: "EXPENSE",
      category: "PAGO_CUADRILLA",
      amount: total,
      description: `Pago cuadrilla ${laborForm.worker_group.trim()}: ${sacks} sacos @ $${price.toFixed(2)}`
    });
    setLaborForm({ worker_group: "", sacks_moved: "", price_per_sack: "" });
    addToast(`Pago de cuadrilla registrado (${money(total)})`, "success");
    await refreshCaja(registerId);
  }

  // ── Configuración ─────────────────────────────────────────────────────────
  const isAdmin = authUser?.role_name === "ADMINISTRADOR";

  // La nómina, cuadrilla y servicio de pilado son responsabilidad única del dueño
  // de la piladora (CEYRO). Los accionistas/clientes solo pagan el servicio; nunca
  // cargan con la nómina ni administran cobros de secado/pilado. Por eso esas
  // pestañas solo aparecen con CEYRO activo.
  const esCeyroActivo = activeAccionistaId === CEYRO_ID;

  // Pestañas visibles según los módulos asignados al usuario.
  const visibleTabs = useMemo(() => {
    if (!authUser) return [] as string[];
    const soloCeyro = new Set(["Nomina", "Cuadrilla", "Servicio Pilado"]);
    // Permisos POR ACCIONISTA: los módulos permitidos dependen del accionista
    // activo, no de un set global. Al cambiar de accionista cambian las pestañas.
    const activeAcc = accionistas.find((a) => a.id === activeAccionistaId);
    const allowed = new Set(activeAcc?.allowed_modules ?? []);
    const base = isAdmin
      ? tabs
      : tabs.filter((tab) => {
          if (tab === "Dashboard") return true;      // panel de inicio para todos
          if (tab === "Configuracion") return false; // solo administradores
          // Un permiso por pestana: si el admin marca la seccion, se ve. Las
          // secciones nuevas del Sidebar entran solas por allowed.has(tab).
          return allowed.has(tab);
        });
    return base.filter((tab) => !soloCeyro.has(tab) || esCeyroActivo);
  }, [authUser, isAdmin, esCeyroActivo, accionistas, activeAccionistaId]);

  // Puede ver el Panel Integral (vista del NEGOCIO COMPLETO: todos los
  // accionistas)? Solo admin, o un operador con el permiso "Dashboard" en el
  // accionista activo (se concede a proposito por ser vista global).
  const canSeePanel = isAdmin || (accionistas.find((a) => a.id === activeAccionistaId)?.allowed_modules ?? []).includes("Dashboard");

  useEffect(() => {
    if (authUser && !visibleTabs.includes(activeTab)) {
      setActiveTab("Dashboard");
    }
  }, [authUser, visibleTabs, activeTab]);

  // Las tarifas (incluidos los precios del combustible) las usan varias
  // pantallas: Secadoras, Nómina y Configuración.
  async function loadLaborRates() {
    const rates = await apiGet<LaborRates>("/labor/rates").catch(() => null);
    if (rates) setLaborRatesForm(rates);
  }

  async function refreshConfig() {
    const settings = await apiGet<AppSettings>("/settings");
    setAppSettings(settings);
    setSettingsForm(settings);
    await loadLaborRates();
    await refreshServicioTarifas();
    if (isAdmin) {
      const [users, accionistas, backups, audit] = await Promise.all([
        apiGet<AdminUser[]>("/auth/users"),
        apiGet<AdminAccionista[]>("/auth/accionistas").catch(() => [] as AdminAccionista[]),
        apiGet<{ directory: string; backups: Array<{ name: string; size_kb: number; created_at: string }> }>("/settings/backups").catch(() => null),
        apiGet<AuditEntry[]>("/audit?limit=200").catch(() => [] as AuditEntry[])
      ]);
      setAdminUsers(users);
      setAdminAccionistas(accionistas);
      if (backups) setBackupInfo(backups);
      setAuditLog(audit);
    }
  }

  async function createAccionista(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newAccionistaForm.name.trim();
    const code = newAccionistaForm.code.trim().toUpperCase();
    if (name.length < 2 || code.length < 2) {
      addToast("Escribe un nombre y un código (mínimo 2 caracteres)", "error");
      return;
    }
    await apiPost("/auth/accionistas", { name, code });
    setNewAccionistaForm({ name: "", code: "" });
    addToast("Accionista creado", "success");
    await refreshConfig();
  }

  async function saveUserAccionistas() {
    if (!accionistaEditor) return;
    const accionistas = accionistaEditor.items
      .filter((it) => it.access)
      .map((it) => ({ accionista_id: it.accionista_id, modules: it.modules }));
    await apiPut(`/auth/users/${accionistaEditor.user.id}/accionistas`, { accionistas });
    addToast(`Accionistas de ${accionistaEditor.user.username} actualizados`, "success");
    setAccionistaEditor(null);
    await refreshConfig();
  }

  // Habilita/deshabilita que un accionista pueda mandar a envejecer producto.
  async function toggleEnvejecer(a: AdminAccionista) {
    await apiPut(`/auth/accionistas/${a.id}`, { puede_envejecer: !a.puede_envejecer });
    addToast(`${a.name}: envejecido ${!a.puede_envejecer ? "habilitado" : "deshabilitado"}`, "success");
    await refreshConfig();
  }

  async function saveRenameAccionista() {
    if (!renameAccionista) return;
    const name = renameAccionista.name.trim();
    const code = renameAccionista.code.trim().toUpperCase();
    if (name.length < 2 || code.length < 2) {
      addToast("Escribe un nombre y un código (mínimo 2 caracteres)", "error");
      return;
    }
    await apiPut(`/auth/accionistas/${renameAccionista.id}`, { name, code });
    addToast("Accionista actualizado", "success");
    setRenameAccionista(null);
    await refreshConfig();
  }

  async function saveLaborRates(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const saved = await apiPut<LaborRates>("/labor/rates", laborRatesForm);
    setLaborRatesForm(saved);
    addToast("Tarifas de pago guardadas", "success");
  }

  async function refreshNomina() {
    setNominaBusy(true);
    try {
      const data = await apiGet<{ rows: WorkerSummary[] }>(`/labor/summary?from=${nominaFrom}&to=${nominaTo}`);
      setNominaRows(data.rows);
    } catch (e) {
      addToast(`Error al cargar nómina: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    } finally {
      setNominaBusy(false);
    }
  }

  async function loadNominaPaymentDetail(row: WorkerSummary) {
    setNominaPaymentDetail({ open: true, row, payments: [], loading: true });
    try {
      const data = await apiGet<{ rows: WorkerPaymentDetail[] }>(
        `/labor/payments?role=${row.worker_role}&name=${encodeURIComponent(row.worker_name)}&from=${nominaFrom}&to=${nominaTo}`
      );
      setNominaPaymentDetail((cur) => ({ ...cur, payments: data.rows, loading: false }));
    } catch (e) {
      addToast(`Error al cargar detalle: ${e instanceof Error ? e.message : "desconocido"}`, "error");
      setNominaPaymentDetail((cur) => ({ ...cur, loading: false }));
    }
  }

  async function loadSecadorSuggestions() {
    try {
      const data = await apiGet<{ rows: Array<{ worker_name: string; work_date: string; tunnels: number; suggested_amount: number; already_generated: boolean }> }>(
        `/labor/secador-suggestions?from=${nominaFrom}&to=${nominaTo}`
      );
      setSecadorSugg(data.rows);
      if (data.rows.length === 0) addToast("No se encontraron días de secado en Secadora para este período", "warn");
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    }
  }

  async function generateSecadorDays(days: Array<{ worker_name: string; work_date: string; tunnels: number }>) {
    if (days.length === 0) { addToast("No hay días nuevos para generar", "warn"); return; }
    const res = await apiPost<{ created: number }>("/labor/secador-days", { days });
    addToast(`${res.created} día(s) de secador generados`, "success");
    await loadSecadorSuggestions();
    await refreshNomina();
  }

  async function loadNominaHistory() {
    try {
      const data = await apiGet<{ rows: typeof histRows }>(`/labor/history?from=${histFrom}&to=${histTo}`);
      setHistRows(data.rows);
    } catch (e) {
      addToast(`Error al cargar historial: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    }
  }

  // ── Panel de Control Integral (admin) ─────────────────────────────────────
  async function refreshPanel(month?: string) {
    try {
      const data = await apiGet<PanelData>(`/dashboard/panel?month=${month ?? panelMonth}`);
      setPanelData(data);
    } catch (e) {
      addToast(`Error al cargar el panel: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    }
  }

  // ── Servicio de pilado ────────────────────────────────────────────────────
  async function refreshPilado() {
    try {
      const [services, balances] = await Promise.all([
        apiGet<{ rows: PiladoService[] }>("/pilado/services"),
        apiGet<PiladoBalance[]>("/pilado/balances")
      ]);
      setPiladoServices(services.rows);
      setPiladoBalances(balances);
    } catch (e) {
      addToast(`Error al cargar servicios de pilado: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    }
  }

  // Autocompleta la tarifa por QQ desde el tarifario vigente del socio/fecha,
  // pero el usuario puede editarla en la transaccion (F-B: autocompleta-editable).
  const autofillPiladoRate = async (socioId: string, fecha: string) => {
    if (!socioId) { setTarifaVigenteHint(""); return; }
    try {
      const t = await apiGet<{ precio_por_qq: number } | null>(`/pilado/tarifa-vigente?socio_id=${socioId}&servicio=PILADO&fecha=${fecha}`);
      if (t && typeof t.precio_por_qq === "number") {
        setPiladoForm((f) => ({ ...f, rate_per_qq: String(t.precio_por_qq) }));
        setTarifaVigenteHint(`Tarifa vigente: $${t.precio_por_qq.toFixed(2)}/QQ (editable)`);
      } else {
        setTarifaVigenteHint("Sin tarifa configurada para este socio (escríbela manual)");
      }
    } catch { setTarifaVigenteHint(""); }
  };

  const refreshServicioTarifas = async () => {
    try { setServicioTarifas(await apiGet<any[]>("/pilado/tarifas")); }
    catch { /* noop */ }
  };
  const submitServicioTarifa = async () => {
    if (!tarifaForm.socio_id) { addToast("Elige el socio", "error"); return; }
    const precio = parseFloat(tarifaForm.precio_por_qq);
    if (isNaN(precio) || precio < 0) { addToast("Precio inválido", "error"); return; }
    try {
      await apiPost("/pilado/tarifas", {
        socio_id: tarifaForm.socio_id,
        servicio: tarifaForm.servicio,
        precio_por_qq: precio,
        fecha_vigencia: tarifaForm.fecha_vigencia || undefined
      });
      setTarifaForm({ socio_id: "", servicio: "PILADO", precio_por_qq: "", fecha_vigencia: nominaToday });
      await refreshServicioTarifas();
      addToast("Tarifa guardada ✓", "success");
    } catch (e) { addToast(`Error: ${e instanceof Error ? e.message : "Error"}`, "error"); }
  };
  const toggleServicioTarifa = async (t: any) => {
    try {
      await apiFetch(`/pilado/tarifas/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !t.is_active }) });
      await refreshServicioTarifas();
    } catch (e) { addToast(`Error: ${e instanceof Error ? e.message : "Error"}`, "error"); }
  };

  // F-C: costo operativo por corrida del accionista activo.
  const refreshCostos = async () => {
    try {
      const [rows, batches] = await Promise.all([
        apiGet<any[]>("/costos"),
        apiGet<any[]>("/costos/batches").catch(() => [] as any[])
      ]);
      setCostos(rows); setCostoBatches(batches);
    } catch { /* noop */ }
  };
  const costoFormTotal = () =>
    ["luz", "mantenimiento", "mano_obra", "combustible", "desgaste", "otros"]
      .reduce((s, k) => s + (parseFloat((costoForm as any)[k]) || 0), 0);
  const submitCosto = async () => {
    const qq = parseFloat(costoForm.qq_producidos);
    if (!qq || qq <= 0) { addToast("Ingresa los QQ producidos (mayor a 0)", "error"); return; }
    if (costoFormTotal() <= 0) { addToast("Ingresa al menos un rubro de costo", "error"); return; }
    try {
      await apiPost("/costos", {
        processing_batch_id: costoForm.processing_batch_id || undefined,
        fecha: costoForm.fecha || undefined,
        qq_producidos: qq,
        luz: parseFloat(costoForm.luz) || 0,
        mantenimiento: parseFloat(costoForm.mantenimiento) || 0,
        mano_obra: parseFloat(costoForm.mano_obra) || 0,
        combustible: parseFloat(costoForm.combustible) || 0,
        desgaste: parseFloat(costoForm.desgaste) || 0,
        otros: parseFloat(costoForm.otros) || 0
      });
      setCostoForm({ processing_batch_id: "", fecha: nominaToday, qq_producidos: "", luz: "", mantenimiento: "", mano_obra: "", combustible: "", desgaste: "", otros: "" });
      await refreshCostos();
      addToast("Costo operativo registrado ✓", "success");
    } catch (e) { addToast(`Error: ${e instanceof Error ? e.message : "Error"}`, "error"); }
  };

  async function submitPilado(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const qq = Number(piladoForm.quintals), rate = Number(piladoForm.rate_per_qq);
    const esExterno = piladoForm.client_kind === "externo";
    if (esExterno && piladoForm.client_name.trim().length < 2) { addToast("Escribe el nombre del cliente externo", "error"); return; }
    if (!esExterno && !piladoForm.client_accionista_id) { addToast("Elige el accionista al que le pilaste", "error"); return; }
    if (!(qq > 0) || !(rate >= 0)) { addToast("Ingresa quintales y tarifa por QQ", "error"); return; }
    await apiPost("/pilado/services", {
      client_accionista_id: esExterno ? undefined : piladoForm.client_accionista_id,
      client_name: esExterno ? piladoForm.client_name.trim() : undefined,
      quintals: qq,
      rate_per_qq: rate,
      service_date: piladoForm.service_date
    });
    localStorage.setItem("bascula-erp:pilado-rate", String(rate));
    setPiladoForm({ ...piladoForm, quintals: "", client_name: "" });
    addToast("Servicio de pilado registrado", "success");
    await refreshPilado();
  }

  async function loadPiladoReport(id: string) {
    const s = await apiGet<PiladoServiceDetail>(`/pilado/services/${id}`);
    setPiladoReport(s);
  }

  async function settlePilado(id: string) {
    const registerId = dashboard.current_cash_register?.id;
    const r = await apiPost<{ paid: number; caja_registrada: boolean; espejo: null | { accionista: string; cuenta: string; caja_registrada: boolean } }>(
      `/pilado/services/${id}/settle`, { cash_register_id: registerId }
    );
    // El cobro de CEYRO entra a su caja; el espejo saca la plata del cliente.
    let msg = r.caja_registrada
      ? `Cobrado ${money(r.paid)} y registrado como ingreso en caja`
      : `Servicio saldado, pero no había caja abierta para registrar el ingreso`;
    if (r.espejo) {
      msg += `. Se descontó la ${r.espejo.cuenta} de ${r.espejo.accionista}` +
        (r.espejo.caja_registrada ? " y salió de su caja." : " (su caja está cerrada, el saldo igual bajó).");
    }
    addToast(msg, r.caja_registrada ? "success" : "error");
    await refreshPilado();
    if (registerId) await refreshCaja(registerId);
  }

  // ── Selección / envejecido por lotes ──────────────────────────────────────
  async function refreshSelection() {
    try {
      const [batches, providers, rates] = await Promise.all([
        apiGet<{ rows: SelectionBatch[] }>("/selection/batches"),
        apiGet<ExternalProvider[]>("/selection/providers"),
        apiGet<SelectionRates>("/selection/rates")
      ]);
      setSelectionBatches(batches.rows);
      setSelectionProviders(providers);
      setSelectionRates(rates);
      setSelectionRatesForm({ seleccion_rate: String(rates.seleccion_rate), envejecimiento_rate: String(rates.envejecimiento_rate) });
    } catch (e) {
      addToast(`Error al cargar selección: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    }
  }

  async function reloadStock() {
    const rows = await apiGet<StockRow[]>("/inventory/stock").catch(() => null);
    if (rows) setStock(rows);
  }

  // FASE 1 — mandar a selectar (baja las entradas del inventario).
  async function submitStartBatch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectionForm.provider_id) { addToast("Elige la persona externa que hace el servicio", "error"); return; }
    // Siempre sale de la bodega de producto terminado.
    const warehouseId = finishedWarehouse?.id;
    if (!warehouseId) { addToast("No hay bodega de producto terminado configurada", "error"); return; }
    const inputs = selectionForm.inputs
      .filter((l) => l.product_id && Number(l.quantity) > 0)
      .map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) }));
    if (inputs.length === 0) { addToast("Agrega al menos un producto con cantidad", "error"); return; }
    if (new Set(inputs.map((i) => i.product_id)).size !== inputs.length) { addToast("Hay un producto repetido; súmalo en una sola línea", "error"); return; }
    const rate = selectionForm.rate_per_qq === "" ? undefined : Number(selectionForm.rate_per_qq);
    await apiPost("/selection/batches", {
      provider_id: selectionForm.provider_id,
      service_type: selectionForm.service_type,
      warehouse_id: warehouseId,
      rate_per_qq: rate,
      service_date: selectionForm.service_date,
      notes: selectionForm.notes.trim() || undefined,
      inputs
    });
    setSelectionForm((f) => ({ ...f, notes: "", inputs: [{ ...emptyLine }] }));
    addToast("Enviado a selectar. Producto descontado del inventario y cuenta por pagar creada.", "success");
    await Promise.all([refreshSelection(), reloadStock()]);
  }

  // FASE 2 — recibir lo procesado (ingresa las salidas al inventario).
  async function submitFinishBatch(batchId: string) {
    const outputs = finishOutputs
      .filter((l) => l.product_id && Number(l.quantity) > 0)
      .map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), is_reject: !!l.is_reject }));
    if (outputs.length === 0) { addToast("Agrega al menos un producto que regresó", "error"); return; }
    if (new Set(outputs.map((o) => o.product_id)).size !== outputs.length) { addToast("Hay un producto repetido en las salidas", "error"); return; }
    await apiPost(`/selection/batches/${batchId}/finish`, { outputs });
    setFinishingBatchId(null);
    setFinishOutputs([{ ...emptyLine }]);
    addToast("Lote cerrado. Producto procesado ingresado al inventario.", "success");
    await Promise.all([refreshSelection(), reloadStock()]);
  }

  async function cancelBatch(batchId: string) {
    if (!window.confirm("¿Cancelar este lote? Se devuelve el producto a bodega y se anula la cuenta por pagar.")) return;
    await apiPost(`/selection/batches/${batchId}/cancel`, {});
    addToast("Lote cancelado y producto devuelto a bodega", "success");
    await Promise.all([refreshSelection(), reloadStock()]);
  }

  async function submitNewProvider(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (newProviderForm.name.trim().length < 2) { addToast("Escribe el nombre de la persona", "error"); return; }
    const created = await apiPost<ExternalProvider>("/selection/providers", {
      name: newProviderForm.name.trim(),
      identification: newProviderForm.identification.trim() || undefined,
      phone: newProviderForm.phone.trim() || undefined
    });
    setNewProviderForm({ name: "", identification: "", phone: "" });
    addToast("Persona externa guardada", "success");
    await refreshSelection();
    setSelectionForm((f) => ({ ...f, provider_id: created.id }));
  }

  async function saveSelectionRates(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sel = Number(selectionRatesForm.seleccion_rate), env = Number(selectionRatesForm.envejecimiento_rate);
    if (!(sel >= 0) || !(env >= 0)) { addToast("Las tarifas deben ser números válidos", "error"); return; }
    await apiPut("/selection/rates", { seleccion_rate: sel, envejecimiento_rate: env });
    addToast("Tarifas actualizadas", "success");
    await refreshSelection();
  }

  // ── Cuadrilla ─────────────────────────────────────────────────────────────
  async function refreshCuadrilla() {
    try {
      const [acts, entries, summary, advances] = await Promise.all([
        apiGet<CuadrillaActivity[]>("/cuadrilla/activities"),
        apiGet<{ rows: CuadrillaEntry[]; total: number }>(`/cuadrilla/entries?from=${cuadFrom}&to=${cuadTo}`),
        apiGet<{ rows: CuadrillaSummaryRow[]; total_general: number; total_anticipos: number; total_neto: number }>(`/cuadrilla/summary?from=${cuadFrom}&to=${cuadTo}`),
        apiGet<CuadrillaAdvance[]>("/cuadrilla/advances?status=pending")
      ]);
      setCuadActivities(acts);
      setCuadEntries(entries.rows);
      setCuadEntriesTotal(entries.total);
      setCuadSummary(summary);
      setCuadAdvances(advances);
    } catch (e) {
      addToast(`Error al cargar cuadrilla: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    }
  }

  async function submitCuadEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cuadEntryForm.activity_id) { addToast("Elige una actividad", "error"); return; }
    const qty = Number(cuadEntryForm.quantity);
    if (!(qty > 0)) { addToast("Ingresa la cantidad (mayor a 0)", "error"); return; }
    await apiPost("/cuadrilla/entries", {
      work_date: cuadEntryForm.work_date,
      activity_id: cuadEntryForm.activity_id,
      worker_name: cuadEntryForm.worker_name.trim(),
      quantity: qty
    });
    setCuadEntryForm({ ...cuadEntryForm, worker_name: "", quantity: "" });
    addToast("Registro agregado", "success");
    await refreshCuadrilla();
  }

  async function deleteCuadEntry(id: string) {
    await apiFetch(`/cuadrilla/entries/${id}`, { method: "DELETE" });
    addToast("Registro eliminado", "success");
    await refreshCuadrilla();
  }

  async function submitCuadAdvance(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const amount = Number(cuadAdvanceForm.amount);
    if (cuadAdvanceForm.worker_name.trim().length < 2 || !(amount > 0)) {
      addToast("Ingresa el nombre y un monto mayor a 0", "error");
      return;
    }
    await apiPost("/cuadrilla/advances", {
      worker_name: cuadAdvanceForm.worker_name.trim(),
      amount,
      concept: cuadAdvanceForm.concept.trim() || undefined
    });
    setCuadAdvanceForm({ worker_name: "", amount: "", concept: "" });
    addToast("Anticipo registrado", "success");
    await refreshCuadrilla();
  }

  async function settleCuadAdvance(id: string) {
    await apiPost(`/cuadrilla/advances/${id}/settle`, {});
    addToast("Anticipo saldado", "success");
    await refreshCuadrilla();
  }

  async function createActivity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const rate = Number(newActivityForm.unit_rate);
    if (newActivityForm.name.trim().length < 2 || !(rate >= 0)) {
      addToast("Ingresa nombre y valor unitario", "error");
      return;
    }
    await apiPost("/cuadrilla/activities", { name: newActivityForm.name.trim(), unit_rate: rate });
    setNewActivityForm({ name: "", unit_rate: "" });
    addToast("Actividad guardada", "success");
    await refreshCuadrilla();
  }

  async function updateActivityRate(id: string, unit_rate: number) {
    await apiPut(`/cuadrilla/activities/${id}`, { unit_rate });
    addToast("Tarifa actualizada", "success");
    await refreshCuadrilla();
  }

  function printCuadrillaSummary() {
    if (!cuadSummary || cuadSummary.rows.length === 0) { addToast("No hay datos para imprimir", "warn"); return; }
    const filas = cuadSummary.rows.map((r) => `
      <tr><td>${r.worker_name || "(sin nombre)"}</td><td class="r">${r.entradas}</td>
      <td class="r">$${r.total.toFixed(2)}</td>
      <td class="r">${r.anticipos > 0 ? "-$" + r.anticipos.toFixed(2) : "—"}</td>
      <td class="r"><strong>$${r.neto.toFixed(2)}</strong></td></tr>`).join("");
    const html = `<html><head><meta charset="utf-8"><title>Nómina cuadrilla</title><style>
      body{font-family:Arial,sans-serif;font-size:13px;margin:14mm}
      h1{font-size:18px;margin:0 0 2px;text-align:center}
      h2{font-size:12px;font-weight:normal;margin:0;text-align:center;color:#555}
      h3{font-size:15px;margin:16px 0 4px;text-align:center;text-transform:uppercase;letter-spacing:1px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th,td{padding:5px 8px;border-bottom:1px solid #eee;text-align:left}
      th{background:#16a34a;color:#fff}
      td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
      tfoot td{border-top:2px solid #111;font-weight:bold}
      @media print{body{margin:10mm}}
    </style></head><body>
      <h1>${appSettings.business_name}</h1>
      <h2>${[appSettings.business_subtitle, appSettings.ruc && `RUC: ${appSettings.ruc}`].filter(Boolean).join(" · ")}</h2>
      <h3>Nómina de Cuadrilla</h3>
      <div style="text-align:center;color:#555;font-size:12px">Período: ${cuadFrom} al ${cuadTo}</div>
      <table>
        <thead><tr><th>Trabajador</th><th class="r">Trabajos</th><th class="r">Ganado</th><th class="r">Anticipos</th><th class="r">Neto a pagar</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td>TOTALES</td><td class="r">${cuadSummary.rows.reduce((s, r) => s + r.entradas, 0)}</td>
          <td class="r">$${cuadSummary.total_general.toFixed(2)}</td>
          <td class="r">${cuadSummary.total_anticipos > 0 ? "-$" + cuadSummary.total_anticipos.toFixed(2) : "—"}</td>
          <td class="r">$${cuadSummary.total_neto.toFixed(2)}</td></tr></tfoot>
      </table>
    </body></html>`;
    const w = window.open("", "_blank", "width=640,height=700");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  function printHistoryReceipt(h: { worker_role: string; worker_name: string; week_start: string; cnt: number; qq: number; sacas: number; arrocillo: number; tulas?: number; earned: number; advances_applied: number }) {
    // Reconstruye una fila de resumen para reutilizar el recibo.
    const cashPaid = round2(h.earned - h.advances_applied);
    const row: WorkerSummary = {
      worker_role: h.worker_role, worker_name: h.worker_name, cnt: h.cnt,
      qq: h.qq, sacas: h.sacas, arrocillo: h.arrocillo, tulas: h.tulas ?? 0,
      base_amount: h.earned,
      net_amount: cashPaid, pending_amount: 0, paid_amount: cashPaid,
      advances: h.advances_applied, to_pay: 0
    };
    const weekEnd = new Date(h.week_start); weekEnd.setDate(weekEnd.getDate() + 6);
    printWorkerReceipt(row, h.week_start, weekEnd.toISOString().slice(0, 10)).catch(() => undefined);
  }

  function nominaExportData(): { title: string; headers: string[]; rows: (string | number)[][]; totals: (string | number)[] } {
    const m2 = (n: number) => Number(n || 0).toFixed(2);
    const roleLabel = (r: string) => (r === "PILADOR" ? "Pilador" : r === "ESTIBADOR" ? "Estibador" : r === "POLVILLO" ? "Polvillo" : "Secador");
    const rows = nominaRows.map((r) => [
      roleLabel(r.worker_role), r.worker_name, r.cnt,
      Number(r.qq).toFixed(2), Number(r.tulas ?? 0).toFixed(0), Number(r.sacas).toFixed(0),
      m2(r.base_amount), m2(r.advances ?? 0), m2((r.pending_amount ?? 0) > 0 ? (r.to_pay ?? 0) : 0), m2(r.paid_amount ?? 0)
    ]);
    const t = nominaRows.reduce((a, r) => ({
      base: a.base + r.base_amount, adv: a.adv + (r.advances ?? 0),
      pay: a.pay + ((r.pending_amount ?? 0) > 0 ? (r.to_pay ?? 0) : 0), paid: a.paid + (r.paid_amount ?? 0)
    }), { base: 0, adv: 0, pay: 0, paid: 0 });
    return {
      title: "Nómina de trabajadores",
      headers: ["Rol", "Trabajador", "Reg.", "QQ", "Tulas", "Sacas", "Ganó", "Anticipos", "A pagar", "Pagado"],
      rows,
      totals: ["TOTALES", "", "", "", "", "", m2(t.base), m2(t.adv), m2(t.pay), m2(t.paid)]
    };
  }

  async function printWorkerReceipt(row: WorkerSummary, periodFrom?: string, periodTo?: string) {
    // La ventana se abre YA (dentro del click) para que el bloqueador de popups
    // no la mate; el contenido se escribe después de traer el detalle.
    const w = window.open("", "_blank", "width=560,height=680");
    const from = periodFrom ?? nominaFrom;
    const to = periodTo ?? nominaTo;
    const earned = row.base_amount;
    const adv = row.advances ?? 0;
    const net = row.pending_amount != null && row.pending_amount > 0 ? (row.to_pay ?? 0) : (row.paid_amount ?? 0);
    const roleLabel = row.worker_role === "PILADOR" ? "Pilador" : row.worker_role === "ESTIBADOR" ? "Estibador" : row.worker_role === "POLVILLO" ? "Polvillo" : "Secador";
    const isPilador = row.worker_role === "PILADOR";
    const isEstibador = row.worker_role === "ESTIBADOR";

    type DailyRow = { fecha: string; piladas: number; qq: number; sacas: number; arrocillo: number; tulas: number; ganado: number };
    const detail = await apiGet<{ rows: DailyRow[] }>(
      `/labor/worker-detail?role=${row.worker_role}&name=${encodeURIComponent(row.worker_name)}&from=${from}&to=${to}`
    ).catch(() => ({ rows: [] as DailyRow[] }));

    const fmtFecha = (f: string) => { const [y, m, d] = String(f).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
    // Tabla día por día, con columnas según el rol.
    let detalleDiario = "";
    if (detail.rows.length > 0) {
      const head = isEstibador
        ? `<td>Fecha</td><td class="r">Piladas</td><td class="r">Tulas</td><td class="r">Arrocillo</td><td class="r">Ganado</td>`
        : isPilador
        ? `<td>Fecha</td><td class="r">Piladas</td><td class="r">QQ</td><td class="r">Ganado</td>`
        : `<td>Fecha</td><td class="r">Ganado</td>`;
      const fila = (d: DailyRow) => isEstibador
        ? `<td>${fmtFecha(d.fecha)}</td><td class="r">${d.piladas}</td><td class="r">${Number(d.tulas).toFixed(0)}</td><td class="r">${Number(d.arrocillo).toFixed(2)} QQ</td><td class="r">${Number(d.ganado).toFixed(2)}</td>`
        : isPilador
        ? `<td>${fmtFecha(d.fecha)}</td><td class="r">${d.piladas}</td><td class="r">${Number(d.qq).toFixed(2)}</td><td class="r">$${Number(d.ganado).toFixed(2)}</td>`
        : `<td>${fmtFecha(d.fecha)}</td><td class="r">$${Number(d.ganado).toFixed(2)}</td>`;
      const colspan = isEstibador ? 4 : isPilador ? 3 : 1;
      detalleDiario = `<h4>Detalle por día</h4>
        <table>
          <tr class="th">${head}</tr>
          ${detail.rows.map((d) => `<tr>${fila(d)}</tr>`).join("")}
          <tr class="tot"><td colspan="${colspan}">Total</td><td class="r">$${detail.rows.reduce((s, d) => s + Number(d.ganado), 0).toFixed(2)}</td></tr>
        </table>`;
    } else {
      // Sin detalle: se muestra el resumen agregado como antes.
      const resumen = row.worker_role === "SECADOR"
        ? `<tr><td>Días trabajados</td><td class="r">${row.cnt}</td></tr>`
        : isEstibador
        ? `<tr><td>Piladas</td><td class="r">${row.cnt}</td></tr><tr><td>Tulas</td><td class="r">${Number(row.tulas ?? 0).toFixed(0)}</td></tr><tr><td>Arrocillo</td><td class="r">${Number(row.arrocillo ?? 0).toFixed(2)} QQ</td></tr>`
        : `<tr><td>Piladas</td><td class="r">${row.cnt}</td></tr><tr><td>Quintales de arroz</td><td class="r">${Number(row.qq).toFixed(2)} QQ</td></tr><tr><td>Sacas (@)</td><td class="r">${Number(row.sacas).toFixed(0)}</td></tr>`;
      detalleDiario = `<table>${resumen}</table>`;
    }

    const html = `<html><head><meta charset="utf-8"><title>Recibo ${row.worker_name}</title><style>
      body{font-family:Arial,sans-serif;font-size:13px;margin:16mm;max-width:520px}
      h1{font-size:18px;margin:0 0 2px;text-align:center}
      h2{font-size:12px;font-weight:normal;margin:0;text-align:center;color:#555}
      h3{font-size:15px;margin:16px 0 4px;text-align:center;text-transform:uppercase;letter-spacing:1px}
      h4{font-size:12px;margin:16px 0 2px;text-transform:uppercase;letter-spacing:1px;color:#333}
      .meta{display:flex;justify-content:space-between;margin:10px 0;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      td{padding:5px 8px;border-bottom:1px solid #eee}
      td.r{text-align:right;font-variant-numeric:tabular-nums}
      .th td{font-weight:bold;background:#f3f4f6;border-bottom:1px solid #ccc}
      .tot td{border-top:2px solid #111;font-weight:bold;font-size:15px;padding-top:8px}
      .disc td{color:#b91c1c}
      .sig{margin-top:48px;text-align:center}
      .sig hr{width:200px;border:none;border-top:1px solid #111;margin:0 auto 4px}
      @media print{body{margin:10mm}}
    </style></head><body>
      <h1>${appSettings.business_name}</h1>
      <h2>${[appSettings.business_subtitle, appSettings.ruc && `RUC: ${appSettings.ruc}`].filter(Boolean).join(" · ")}</h2>
      <h3>Recibo de Pago</h3>
      <div class="meta"><div><strong>Trabajador:</strong> ${row.worker_name} (${roleLabel})</div><div><strong>Período:</strong> ${from} al ${to}</div></div>
      ${detalleDiario}
      <table>
        <tr><td>Total ganado</td><td class="r">$${earned.toFixed(2)}</td></tr>
        ${adv > 0 ? `<tr class="disc"><td>Anticipos recibidos</td><td class="r">-$${adv.toFixed(2)}</td></tr>` : ""}
        <tr class="tot"><td>NETO A PAGAR</td><td class="r">$${net.toFixed(2)}</td></tr>
      </table>
      <div class="sig"><hr/><span>Firma del trabajador</span></div>
    </body></html>`;
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  async function registerAdvance(row: WorkerSummary) {
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) { addToast("Abre una caja para dar anticipos", "error"); return; }
    const amtStr = window.prompt(`Anticipo a ${row.worker_name} (${row.worker_role.toLowerCase()}). Monto $:`, "");
    if (amtStr === null) return;
    const amount = Number(amtStr);
    if (!amount || amount <= 0) { addToast("Monto inválido", "error"); return; }
    const desc = window.prompt("Descripción (opcional):", "Anticipo") ?? undefined;
    try {
      await apiPost("/labor/advances", {
        worker_role: row.worker_role,
        worker_name: row.worker_name,
        amount,
        description: desc,
        cash_register_id: registerId
      });
      addToast(`Anticipo de ${money(amount)} registrado a ${row.worker_name}`, "success");
      await refreshNomina();
      await refreshCaja(registerId);
    } catch (e) {
      addToast(`No se pudo registrar: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  async function payWorkerWeek(row: WorkerSummary) {
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) { addToast("Abre una caja para pagar", "error"); return; }
    const toPay = row.to_pay ?? (row.pending_amount ?? 0);
    if (!window.confirm(`Pagar ${money(toPay)} a ${row.worker_name} (${row.worker_role.toLowerCase()})?${(row.advances ?? 0) > 0 ? `\n(Ganó ${money(row.pending_amount ?? 0)}, menos ${money(row.advances)} de anticipos)` : ""}`)) return;
    try {
      await apiPost("/labor/pay-worker", {
        worker_role: row.worker_role,
        worker_name: row.worker_name,
        from: nominaFrom,
        to: nominaTo,
        cash_register_id: registerId
      });
      addToast(`Pagado a ${row.worker_name}`, "success");
      await refreshNomina();
      await refreshCaja(registerId);
    } catch (e) {
      addToast(`No se pudo pagar: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  async function loadReport(kind: ReportKind = reportKind) {
    setReportBusy(true);
    try {
      const qs = `?from=${reportFrom}&to=${reportTo}`;
      if (kind === "resumen") {
        const data = await apiGet<ReportSummary>(`/reports/summary${qs}`);
        setReportSummary(data);
        setReportRows({ kind, data });
      } else {
        const data = await apiGet<any>(`/reports/${reportEndpoint[kind]}${qs}`);
        setReportRows({ kind, data });
      }
    } catch (e) {
      addToast(`Error al generar reporte: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    } finally {
      setReportBusy(false);
    }
  }

  // Apartar / devolver un secado como "arianos" (arroz seco que no se procesa
  // todavia). Recarga el informe y los secados de Produccion para que el cambio
  // se refleje en todos lados.
  async function apartarArianos(id: string, apartar: boolean, ubicacion?: string) {
    await apiPost("/reports/arianos/apartar", { ids: [id], apartar, ubicacion });
    addToast(apartar ? "Apartado como arianos" : "Devuelto a proceso", "success");
    await loadReport("arianos");
    const dr = await apiGet<DryingTunnelReport[]>("/process-flow/drying/reports").catch(() => null);
    if (dr) setDryingReports(dr);
  }

  // Actualizar solo la ubicacion de un lote ya guardado (si lo movieron).
  async function actualizarUbicArianos(id: string, ubicacion?: string) {
    await apiPost("/reports/arianos/ubicacion", { id, ubicacion });
    addToast("Ubicación actualizada", "success");
    await loadReport("arianos");
  }

  useEffect(() => {
    if (activeTab === "Reportes") loadReport("resumen").catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "Bascula") refreshBasculaTickets().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ticketFilter]);

  function exportReportCsv(headers: string[], rows: (string | number)[][], filename: string) {
    const escape = (v: string | number) => {
      const s = String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map((r) => r.map(escape).join(";")).join("\r\n");
    // BOM para que Excel abra los acentos correctamente.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport(title: string, headers: string[], rows: (string | number)[][], totalsRow?: (string | number)[]) {
    const thead = headers.map((h) => `<th>${h}</th>`).join("");
    const tbody = rows
      .map((r) => `<tr>${r.map((c, i) => `<td class="${i === 0 ? "" : "num"}">${c}</td>`).join("")}</tr>`)
      .join("");
    const tfoot = totalsRow
      ? `<tfoot><tr>${totalsRow.map((c, i) => `<td class="${i === 0 ? "" : "num"}">${c}</td>`).join("")}</tr></tfoot>`
      : "";
    const html = `<html><head><meta charset="utf-8"><title>${title}</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:16mm}
      h1{font-size:18px;margin:0 0 2px;text-align:center}
      h2{font-size:13px;font-weight:normal;margin:0 0 2px;text-align:center;color:#555}
      h3{font-size:14px;margin:14px 0 2px;text-align:center;text-transform:uppercase;letter-spacing:1px}
      .range{text-align:center;color:#555;margin-bottom:12px;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#0f766e;color:#fff;padding:6px 8px;text-align:left;font-size:11px;text-transform:uppercase}
      td{padding:5px 8px;border-bottom:1px solid #ddd}
      td.num,th{text-align:left}
      td.num{text-align:right;font-variant-numeric:tabular-nums}
      tfoot td{font-weight:bold;border-top:2px solid #111;background:#f0f0f0}
      @media print{body{margin:10mm}}
    </style></head><body>
      <h1>${appSettings.business_name}</h1>
      <h2>${[appSettings.business_subtitle, appSettings.ruc && `RUC: ${appSettings.ruc}`].filter(Boolean).join(" · ")}</h2>
      <h3>${title}</h3>
      <div class="range">Del ${reportFrom} al ${reportTo}</div>
      <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody>${tfoot}</table>
    </body></html>`;
    const w = window.open("", "_blank", "width=820,height=640");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  function getReportExport(): { title: string; headers: string[]; rows: (string | number)[][]; totals?: (string | number)[] } | null {
    if (!reportRows) return null;
    const m2 = (n: number) => Number(n || 0).toFixed(2);
    const { kind, data } = reportRows;
    if (kind === "resumen") {
      const s = data as ReportSummary;
      return {
        title: "Resumen del período",
        headers: ["Concepto", "Valor"],
        rows: [
          ["Ventas del período", m2(s.sales.total)],
          ["N.º de ventas", s.sales.cnt],
          ["Liquidaciones (neto)", m2(s.liquidations.net)],
          ["Liquidaciones (bruto)", m2(s.liquidations.gross)],
          ["Gastos", m2(s.expenses.total)],
          ["Caja · ingresos", m2(s.cash.income)],
          ["Caja · egresos", m2(s.cash.expense)],
          ["Caja · neto", m2(s.cash.net)],
          ["Procesos de producción", s.production.cnt],
          ["Por cobrar (saldo actual)", m2(s.receivable_outstanding)],
          ["Por pagar (saldo actual)", m2(s.payable_outstanding)]
        ]
      };
    }
    if (kind === "ventas") {
      const rows = (data.by_product || []).map((r: any) => [r.name, r.qty, m2(r.total)]);
      const total = (data.by_product || []).reduce((a: number, r: any) => a + r.total, 0);
      return { title: "Ventas por producto", headers: ["Producto", "Cantidad", "Total"], rows, totals: ["TOTAL", "", m2(total)] };
    }
    if (kind === "liquidaciones") {
      const rows = (data.rows || []).map((r: any) => [r.full_name, r.cnt, m2(r.qq), m2(r.gross), m2(r.discounts), m2(r.net)]);
      const t = (data.rows || []).reduce((a: any, r: any) => ({ qq: a.qq + r.qq, gross: a.gross + r.gross, disc: a.disc + r.discounts, net: a.net + r.net }), { qq: 0, gross: 0, disc: 0, net: 0 });
      return { title: "Liquidaciones por agricultor", headers: ["Agricultor", "N.º", "Quintales", "Bruto", "Descuentos", "Neto"], rows, totals: ["TOTAL", "", m2(t.qq), m2(t.gross), m2(t.disc), m2(t.net)] };
    }
    if (kind === "gastos") {
      const rows = (data.rows || []).map((r: any) => [new Date(r.created_at).toLocaleDateString("es-EC"), r.description, r.paid_to || "", m2(r.amount)]);
      const total = (data.rows || []).reduce((a: number, r: any) => a + r.amount, 0);
      return { title: "Gastos del período", headers: ["Fecha", "Descripción", "Pagado a", "Monto"], rows, totals: ["TOTAL", "", "", m2(total)] };
    }
    if (kind === "porcobrar") {
      const rows = (data.rows || []).map((r: any) => [r.customer_name, r.phone || "", m2(r.b0), m2(r.b30), m2(r.b60), m2(r.b90), m2(r.total), r.oldest_days]);
      const t = data.totals || { b0: 0, b30: 0, b60: 0, b90: 0, total: 0 };
      return {
        title: "Cuentas por cobrar por antigüedad",
        headers: ["Cliente", "Teléfono", "0-30 días", "31-60", "61-90", "+90 días", "Total", "Antigüedad (días)"],
        rows,
        totals: ["TOTAL", "", m2(t.b0), m2(t.b30), m2(t.b60), m2(t.b90), m2(t.total), ""]
      };
    }
    if (kind === "combustible") {
      const rows = (data.rows || []).map((r: any) => [
        new Date(r.fecha).toLocaleDateString("es-EC"),
        r.dryer_name ?? `Túnel ${r.tunnel_number}`,
        m2(r.quintals),
        m2(r.gas_costo),
        m2(r.diesel_costo),
        m2(r.costo_por_qq_gas),
        m2(r.costo_por_qq_diesel),
        m2(r.total)
      ]);
      const t = data.totals || { gas: 0, diesel: 0, total: 0 };
      return {
        title: "Combustible de secado (gas y diésel por separado)",
        headers: ["Fecha", "Secadora", "QQ", "Gas $", "Diésel $", "Costo/QQ Gas", "Costo/QQ Diésel", "Total $"],
        rows,
        totals: ["TOTAL", "", "", m2(t.gas), m2(t.diesel), "", "", m2(t.total)]
      };
    }
    // produccion
    const rows = (data.rows || []).map((r: any) => [new Date(r.created_at).toLocaleDateString("es-EC"), r.batch_number, r.lot_code || "—", m2(r.input_qty), m2(r.output_qty), r.status]);
    return { title: "Producción del período", headers: ["Fecha", "Lote/Proceso", "Lote", "Entrada", "Salida", "Estado"], rows };
  }

  async function runBackupNow() {
    setBackupBusy(true);
    try {
      const info = await apiPost<{ directory: string; backups: Array<{ name: string; size_kb: number; created_at: string }> }>("/settings/backup", {});
      setBackupInfo(info);
      addToast("Respaldo creado correctamente", "success");
    } catch (e) {
      addToast(`Error al respaldar: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    } finally {
      setBackupBusy(false);
    }
  }

  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const saved = await apiPut<AppSettings>("/settings", settingsForm);
    setAppSettings(saved);
    setSettingsForm(saved);
    addToast("Datos del negocio guardados", "success");
  }

  async function submitConfigUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (newUserForm.name.trim().length < 2 || newUserForm.username.trim().length < 2 || newUserForm.password.length < 4) {
      addToast("Completa nombre, usuario y una clave de al menos 4 caracteres", "error");
      return;
    }
    if (newUserForm.role === "OPERADOR" && newUserForm.modules.length === 0) {
      addToast("Asigna al menos un módulo al operador", "error");
      return;
    }
    if (newUserForm.role === "OPERADOR" && newUserForm.accionistas.length === 0) {
      addToast("Asigna al menos un accionista al operador: sin eso no podrá trabajar", "error");
      return;
    }
    await apiPost("/auth/users", {
      name: newUserForm.name.trim(),
      username: newUserForm.username.trim().toLowerCase(),
      cedula: newUserForm.cedula.trim() || undefined,
      password: newUserForm.password,
      role: newUserForm.role,
      allowed_modules: newUserForm.role === "OPERADOR" ? newUserForm.modules : [],
      accionista_ids: newUserForm.role === "OPERADOR" ? newUserForm.accionistas : []
    });
    setNewUserForm({ name: "", username: "", cedula: "", password: "", role: "OPERADOR", modules: [], accionistas: [] });
    addToast("Usuario creado", "success");
    await refreshConfig();
  }

  async function savePermissions() {
    if (!permsEditor) return;
    if (permsEditor.modules.length === 0) {
      addToast("Asigna al menos un módulo", "error");
      return;
    }
    await apiPut(`/auth/users/${permsEditor.user.id}`, { allowed_modules: permsEditor.modules });
    addToast(`Permisos de ${permsEditor.user.username} actualizados`, "success");
    setPermsEditor(null);
    await refreshConfig();
  }

  async function toggleUserActive(user: AdminUser) {
    await apiPut(`/auth/users/${user.id}`, { is_active: !user.is_active });
    addToast(user.is_active ? `Usuario ${user.username} desactivado` : `Usuario ${user.username} activado`, "success");
    await refreshConfig();
  }

  // Guarda la edición de los datos de un usuario (nombre, usuario, rol y,
  // solo si se escribió, una clave nueva de mínimo 8 caracteres).
  async function saveUserEdit() {
    if (!userEditor) return;
    const payload: Record<string, unknown> = {
      name: userEditor.name.trim(),
      username: userEditor.username.trim(),
      cedula: userEditor.cedula.trim(),
      role: userEditor.role
    };
    if (userEditor.password.trim()) payload.password = userEditor.password.trim();
    await apiPut(`/auth/users/${userEditor.user.id}`, payload);
    addToast(`Usuario ${userEditor.username.trim()} actualizado`, "success");
    setUserEditor(null);
    await refreshConfig();
  }

  async function submitResetData(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (resetForm.confirm.trim().toUpperCase() !== "BORRAR") {
      addToast('Escribe "BORRAR" para confirmar', "error");
      return;
    }
    const result = await apiPost<{ ok: boolean; wiped_tables: number }>("/settings/reset-transactions", {
      password: resetForm.password,
      confirm: "BORRAR"
    });
    setResetForm({ password: "", confirm: "" });
    addToast(`Datos de prueba eliminados (${result.wiped_tables} tablas). El sistema quedó listo para operar.`, "success");
    setCashSummary(null);
    setCashMovements([]);
    setExpenses([]);
    await refresh();
  }

  useEffect(() => {
    if (activeTab === "Caja" && dashboard.current_cash_register?.id) {
      refreshCaja().catch(() => undefined);
    }
  }, [activeTab, dashboard.current_cash_register?.id]);

  async function refreshFomentos() {
    const data = await apiGet<Fomento[]>("/fomentos");
    setFomentos(data);
  }

  async function exportFomentos() {
    try {
      const response = await apiFetch("/fomentos/export", { method: "GET" });
      if (!response.ok) {
        let msg = `Error ${response.status}`;
        try {
          const err = await response.json();
          msg = err.error || err.message || msg;
        } catch {
          msg = await response.text().catch(() => msg);
        }
        throw new Error(msg);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fomentos_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Error al descargar", "error");
    }
  }

  async function importFomentos(file: File) {
    setFomentoImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiFetch("/fomentos/import", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok || !data.success) {
        const details = Array.isArray(data.errors)
          ? data.errors.map((e: { fila: number; error: string }) => `Fila ${e.fila}: ${e.error}`).join("\n")
          : data.error || "Error desconocido";
        setFomentoImportModal({ open: true, title: "❌ Error al importar", message: details, isError: true });
      } else {
        setFomentoImportModal({ open: true, title: "✓ Importado correctamente", message: `Creados: ${data.created}\nActualizados: ${data.updated}`, isError: false });
        await refreshFomentos();
      }
    } catch (err) {
      setFomentoImportModal({ open: true, title: "❌ Error al importar", message: err instanceof Error ? err.message : "Error desconocido", isError: true });
    } finally {
      setFomentoImporting(false);
    }
  }

  async function refreshSacks() {
    const [inv, movs] = await Promise.all([
      apiGet<SackInventory[]>("/sacks"),
      apiGet<SackMovement[]>("/sacks/movements/recent")
    ]);
    setSackInventory(inv);
    setSackMovements(movs);
  }

  async function refreshCustomersAndSales() {
    const [custs, sls, ar, ords] = await Promise.all([
      apiGet<Customer[]>("/customers"),
      apiGet<Sale[]>("/sales"),
      apiGet<AccountsReceivable[]>("/receivable"),
      apiGet<SalesOrder[]>("/orders").catch(() => [] as SalesOrder[])
    ]);
    setCustomers(custs);
    setSales(sls);
    setAccountsReceivable(ar.filter(a => a.status !== "PAID"));
    setSalesOrders(ords);
  }

  async function refreshBasculaTickets() {
    const qs = ticketFilter === "all" ? "" : `?status=${ticketFilter}`;
    const [data, materia] = await Promise.all([
      apiGet<BasculaTicket[]>(`/tickets${qs}`),
      apiGet<MateriaPrimaCorreccion[]>("/weighing-tickets/materia-prima").catch(() => [] as MateriaPrimaCorreccion[])
    ]);
    setBasculaTickets(data);
    setMateriaPrimaEntries(materia);
  }

  // Corrige el accionista de un ingreso mal registrado. Pide confirmación
  // porque mueve la cáscara de un socio a otro en el inventario.
  async function corregirAccionistaIngreso(entry: MateriaPrimaCorreccion, accionistaId: string) {
    if (!accionistaId || accionistaId === entry.accionista_id) return;
    const destino = accionistas.find((a) => a.id === accionistaId)?.name ?? "";
    const origen = entry.accionista_name ?? "sin asignar";
    const etiqueta = entry.numero_bascula ? `#${entry.numero_bascula}` : entry.ticket_number;
    const ok = window.confirm(
      `¿Pasar el ingreso ${etiqueta} (${entry.farmer_name ?? "sin agricultor"}, ${Number(entry.quintals ?? 0).toFixed(2)} QQ) ` +
      `de ${origen} a ${destino}?\n\nSe mueve también su cáscara en el inventario.`
    );
    if (!ok) return;
    await apiPut(`/weighing-tickets/${entry.id}/accionista`, { accionista_id: accionistaId });
    addToast(`Ingreso ${etiqueta} corregido: ahora es de ${destino}`, "success");
    await refreshBasculaTickets();
    await refresh();
  }

  const [basculaImporting, setBasculaImporting] = useState(false);
  async function runFirebaseImport() {
    setBasculaImporting(true);
    try {
      // El botón manual siempre hace importación COMPLETA (full): quien lo
      // presiona quiere ver todo lo de la báscula, no solo el delta. El sync
      // automático de cada 3 min sigue siendo incremental.
      const res = await apiPost<{ ok: boolean; count: number }>("/tickets/refresh-firebase", { full: true });
      addToast(res.count > 0 ? `${res.count} tickets traídos de la báscula` : "Sin tickets nuevos en la báscula", "success");
      await refreshBasculaTickets();
    } catch (e) {
      addToast(`No se pudo importar: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally {
      setBasculaImporting(false);
    }
  }

  async function submitLinkFarmer() {
    if (!linkTicket) return;
    if (!linkFarmerId) { addToast("Selecciona o crea un agricultor", "error"); return; }
    try {
      const body = linkFarmerId === "__new__"
        ? { full_name: (linkTicket.farmer_name || "").trim() }
        : { farmer_id: linkFarmerId };
      await apiPost(`/tickets/${linkTicket.id}/link-farmer`, body);
      addToast("Ticket vinculado al agricultor", "success");
      setLinkTicket(null);
      setLinkFarmerId("");
      await Promise.all([refreshBasculaTickets(), refresh()]);
    } catch (e) {
      addToast(`No se pudo vincular: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  async function submitCreateLot() {
    if (!lotTicket) return;
    try {
      // La compra entra sola a la bodega de materia prima; el servicio siempre
      // es de CEYRO. El backend resuelve ambas cosas.
      await apiPost(`/tickets/${lotTicket.id}/create-lot`, {
        rice_type: lotForm.rice_type,
        ownership: lotForm.ownership,
        accionista_id: lotForm.ownership === "OWNED" ? (lotForm.accionista_id || undefined) : undefined
      });
      addToast(
        lotForm.ownership === "OWNED"
          ? "Materia prima ingresada a Bodega Materia Prima. Ya puedes formar el lote en Secadoras."
          : "Ingreso de servicio registrado (a nombre de CEYRO). Ya puedes formar el lote en Secadoras.",
        "success"
      );
      setLotTicket(null);
      await Promise.all([refreshBasculaTickets(), refresh()]);
    } catch (e) {
      addToast(`No se pudo ingresar la materia prima: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  async function previewTicketLiquidation() {
    if (!liqTicket) return;
    const precio = Number(liqPrecio);
    if (!precio || precio <= 0) { addToast("Ingresa el precio por QQ", "error"); return; }
    try {
      const preview = await apiPost<{ quintals: number; grossPayable: number; advancesDiscount: number; netPayable: number }>(
        `/tickets/${liqTicket.id}/liquidation-preview`, { precioQQ: precio }
      );
      setLiqPreview(preview);
    } catch (e) {
      addToast(`Error en vista previa: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  async function confirmTicketLiquidation() {
    if (!liqTicket) return;
    const precio = Number(liqPrecio);
    if (!precio || precio <= 0) { addToast("Ingresa el precio por QQ", "error"); return; }
    try {
      await apiPost(`/tickets/${liqTicket.id}/liquidate`, {
        precioQQ: precio,
        cash_register_id: dashboard.current_cash_register?.id
      });
      addToast(`Ticket liquidado (${money(liqPreview?.netPayable ?? 0)})`, "success");
      setLiqTicket(null);
      setLiqPrecio("");
      setLiqPreview(null);
      await Promise.all([refreshBasculaTickets(), refresh()]);
    } catch (e) {
      addToast(`No se pudo liquidar: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  // Cargas ligeras para las pestañas de Cuentas (no requieren caja abierta).
  async function refreshReceivables() {
    const ar = await apiGet<AccountsReceivable[]>("/receivable");
    setAccountsReceivable(ar.filter((a) => a.status !== "PAID"));
  }

  async function refreshPayables() {
    const ap = await apiGet<AccountPayable[]>("/cash/payables");
    setCashPayables(ap);
  }

  async function submitNewCustomer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newCustomerForm.full_name) { addToast("Ingresa nombre del cliente", "error"); return; }
    await apiPost("/customers", {
      full_name: newCustomerForm.full_name,
      phone: newCustomerForm.phone || undefined,
      address: newCustomerForm.address || undefined,
      customer_type: newCustomerForm.customer_type
    });
    setNewCustomerForm({ full_name: "", phone: "", address: "", customer_type: "NATURAL" });
    addToast("Cliente agregado", "success");
    await refreshCustomersAndSales();
  }

  async function payAccountReceivable(id: string, amount: number) {
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) { addToast("No hay caja abierta", "error"); return; }
    const r = await apiPost<{ remaining: number; espejo: null | { accionista: string; cuenta: string; caja_registrada: boolean } }>(
      `/receivable/${id}/pay`, { amount, cash_register_id: registerId }
    );
    // Si era una deuda entre socios, confirmar que la contraparte se actualizó.
    if (r.espejo) {
      addToast(
        `Abono de ${money(amount)} registrado. Se descontó la ${r.espejo.cuenta} de ${r.espejo.accionista}` +
        (r.espejo.caja_registrada ? " y entró a su caja." : " (su caja está cerrada, el saldo igual bajó)."),
        "success"
      );
    } else {
      addToast(`Abono de ${money(amount)} registrado en caja`, "success");
    }
    await refreshCustomersAndSales();
    await refreshCaja(registerId);
  }

  async function submitSackMovement(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sackMovForm.sack_id) { addToast("Selecciona un tipo de saco", "error"); return; }
    await apiPost("/sacks/movements", {
      sack_id: sackMovForm.sack_id,
      movement: sackMovForm.movement,
      cantidad: Number(sackMovForm.cantidad),
      concepto: sackMovForm.concepto || undefined
    });
    setSackMovForm(p => ({ ...p, cantidad: "", concepto: "" }));
    addToast(`${sackMovForm.movement === "ENTRADA" ? "Entrada" : "Salida"} de sacos registrada`, "success");
    await refreshSacks();
  }

  async function loadFomentoDetalle(id: string) {
    const data = await apiGet<FomentoDetalle>(`/fomentos/${id}`);
    setFomentoDetalle(data);
  }

  // ── Venta Detalle (por libra) ──
  async function submitVentaDetalle() {
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) { addToast("No hay caja abierta", "error"); return; }
    if (!ventaDetalleForm.product_id || !ventaDetalleForm.cantidad_libras || !ventaDetalleForm.precio_por_libra) {
      addToast("Completa producto, cantidad en libras y precio", "error");
      return;
    }

    const cantidadLibras = Number(ventaDetalleForm.cantidad_libras);
    const precioLibra = Number(ventaDetalleForm.precio_por_libra);
    const cantidadQQ = round2(cantidadLibras / 100); // Convertir libras a QQ
    const totalVenta = round2(cantidadLibras * precioLibra); // Total por libra

    try {

      // Crear movimiento de inventario
      await apiFetch(`/inventory/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: ventaDetalleForm.product_id,
          warehouse_id: finishedWarehouse?.id,
          quantity: -cantidadQQ, // Negativo = salida
          ownership: "OWNED",
          notes: `Venta al detalle: ${cantidadLibras} lb @ $${precioLibra.toFixed(2)}/lb`
        })
      });

      // Crear movimiento de caja
      await apiPost("/cash/movements", {
        cash_register_id: registerId,
        movement: "INCOME",
        category: "VENTA",
        amount: totalVenta,
        description: `Venta detalle ${cantidadLibras} lb @ $${precioLibra.toFixed(2)}/lb`
      });

      setVentaDetalleForm({ product_id: "", cantidad_libras: "", precio_por_libra: "", customer_id: "" });
      addToast(`✓ Venta ${cantidadLibras} lb por $${totalVenta.toFixed(2)} registrada`, "success");
      await refreshCaja(registerId);
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error");
    }
  }

  // ── Búsqueda de clientes (autocompletado) ──
  async function handleCustomerSearch(q: string) {
    setCustomerSearch(q);
    if (q.length < 2) { setFilteredCustomers([]); return; }
    try {
      const res = await apiFetch(`/customers/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setFilteredCustomers(data);
      }
    } catch (e) { console.error(e); }
  }

  // ── Crear cliente rápido (nombre + teléfono) ──
  async function submitQuickNewCustomer() {
    if (!quickNewCustomerForm.full_name) { addToast("Ingresa el nombre del cliente", "error"); return; }
    try {
      const res = await apiFetch(`/customers/quick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quickNewCustomerForm)
      });
      if (!res.ok) throw new Error(await res.text());
      const newCust = await res.json();
      setCustomers(prev => [...prev, newCust]);
      setSelectedCustomerId(newCust.id);
      setQuickNewCustomerForm({ full_name: "", phone: "" });
      setShowQuickNewCustomer(false);
      setCustomerSearch("");
      setFilteredCustomers([]);
      addToast(`Cliente ${newCust.full_name} creado ✓`, "success");
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error");
    }
  }

  // ── Cargar presentaciones de un producto ──
  async function loadProductPresentations(productId: string) {
    if (!productId) { setSaleProductPresentations([]); setSelectedPresentationId(""); return; }
    try {
      const res = await apiFetch(`/products/${productId}/presentations`);
      if (res.ok) {
        const pres = await res.json();
        setSaleProductPresentations(pres);
        setSelectedPresentationId(pres[0]?.id || "");
      }
    } catch (e) { console.error(e); }
  }

  // ── Agregar línea de pedido al carrito ──
  function addSaleLineItem() {
    if (!saleLineForm.product_id || !saleLineForm.presentation_id || !saleLineForm.quantity || saleLineForm.unit_price === "") {
      addToast("Completa producto, presentación, cantidad y precio", "error");
      return;
    }
    const presentation = saleProductPresentations.find(p => p.id === saleLineForm.presentation_id);
    const newItem: SaleLineItem = {
      id: `temp-${Date.now()}`,
      product_id: saleLineForm.product_id,
      presentation_id: saleLineForm.presentation_id,
      presentation_name: presentation ? `${presentation.name}` : "",
      weight_lb: presentation && presentation.weight_lb ? Number(presentation.weight_lb) : null,
      quantity: Number(saleLineForm.quantity),
      unit_price: Number(saleLineForm.unit_price)
    };
    setSaleLineItems(prev => [...prev, newItem]);
    setSaleLineForm({ product_id: "", presentation_id: "", quantity: "", unit_price: "" });
    setSaleProductPresentations([]);
    setSelectedPresentationId("");
    addToast("Línea agregada", "success");
  }

  // ── Mapeo de marcas a productos de inventario ──
  function getInventoryProductForBrand(brandName: string): string | null {
    // Flor, Oso, Lira Verde, Lira Azul → Producto 0.11
    if (['Flor', 'Oso', 'Lira Verde', 'Lira Azul'].includes(brandName)) {
      return products.find(p => p.code === 'ARROZ-PILADO-011')?.id || null;
    }
    // Conejo → Producto Corriente
    if (brandName === 'Conejo') {
      return products.find(p => p.code === 'ARROZ-PILADO-CORRIENTE')?.id || null;
    }
    // Arrocillos y Polvillo → productos propios
    const prod = products.find(p => p.name === brandName);
    return prod?.id || null;
  }

  // Stock propio disponible (QQ) del producto de inventario que respalda una
  // marca. El vendedor lo ve ANTES de armar el pedido, en vez de descubrir el
  // "stock insuficiente" al guardar.
  function stockDisponibleDeMarca(brandProductId: string): number | null {
    const marca = products.find((p) => p.id === brandProductId);
    const inventoryId = getInventoryProductForBrand(marca?.name || "") || brandProductId;
    const filas = stock.filter((s) => s.product_id === inventoryId && s.ownership === "OWNED");
    if (!filas.length) return 0;
    return round2(filas.reduce((sum, s) => sum + Number(s.quantity), 0));
  }

  /** QQ que pide una línea del carrito (sacos × libras ÷ 100). */
  const qqDeLinea = (item: SaleLineItem): number =>
    item.weight_lb ? round2((item.quantity * item.weight_lb) / 100) : item.quantity;

  // ── Eliminar línea de pedido ──
  function removeSaleLineItem(id: string) {
    setSaleLineItems(prev => prev.filter(item => item.id !== id));
  }

  // ── Calcular total del pedido ──
  function calculateSaleTotal(): number {
    return saleLineItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  }

  // ── Cambiar producto en formulario de línea (actualizar presentaciones) ──
  async function handleSaleLineProductChange(productId: string) {
    setSaleLineForm(prev => ({ ...prev, product_id: productId, presentation_id: "" }));
    try {
      const res = await apiFetch(`/products/${productId}/presentations`);
      if (res.ok) {
        const pres = await res.json();
        setSaleProductPresentations(pres);
        setSaleLineForm(prev => ({ ...prev, presentation_id: pres[0]?.id || "" }));
      }
    } catch (e) { console.error(e); }
  }

  useEffect(() => {
    if (activeTab === "Fomentos") refreshFomentos().catch(() => undefined);
    // Liquidaciones también necesita los fomentos: al elegir agricultor se
    // carga automáticamente su deuda de fomento como descuento.
    if (activeTab === "Liquidaciones") refreshFomentos().catch(() => undefined);
    if (activeTab === "Produccion") {
      refreshSacks().catch(() => undefined);
      loadMillingDrafts().catch(() => undefined);
      loadProductionHistory().catch(() => undefined);
      refreshCostos().catch(() => undefined);
    }
    if (activeTab === "Inventario") { refreshSacks().catch(() => undefined); refreshInvMovs().catch(() => undefined); }
    if (activeTab === "Ventas") refreshCustomersAndSales().catch(() => undefined);
    if (activeTab === "Compras") { refreshSuppliers().catch(() => undefined); refreshPurchases().catch(() => undefined); }
    if (activeTab === "Por Cobrar") refreshReceivables().catch(() => undefined);
    if (activeTab === "Por Pagar") refreshPayables().catch(() => undefined);
    // Secadoras y Nómina necesitan las tarifas (precios de gas/diesel).
    if (activeTab === "Secadoras" || activeTab === "Nomina") loadLaborRates().catch(() => undefined);
    if (activeTab === "Secadoras") loadMotorActive(motorActivo).catch(() => undefined);
    if (activeTab === "Nomina") refreshNomina().catch(() => undefined);
    if (activeTab === "Cuadrilla") refreshCuadrilla().catch(() => undefined);
    if (activeTab === "Servicio Pilado") refreshPilado().catch(() => undefined);
    if (activeTab === "Seleccion") refreshSelection().catch(() => undefined);
    if (activeTab === "Dashboard" && canSeePanel) refreshPanel().catch(() => undefined);
    if (activeTab === "Configuracion") refreshConfig().catch(() => undefined);
    if (activeTab === "Estados Financieros") loadFinanzas().catch((e) => addToast(e.message, "error"));
  }, [activeTab, motorActivo]);

  async function submitFomento(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await apiPost("/fomentos", {
      farmer_name: fomentoForm.farmer_name,
      cuadras: Number(fomentoForm.cuadras),
      inicio: fomentoForm.inicio,
      status: fomentoForm.status,
      notes: fomentoForm.notes || undefined
    });
    setFomentoForm({ farmer_name: "", cuadras: "", inicio: new Date().toISOString().slice(0,10), status: "ACTIVOS", notes: "" });
    addToast("Fomento creado", "success");
    await refreshFomentos();
  }

  async function submitFomentoEntrega(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fomentoDetalle) return;
    await apiPost(`/fomentos/${fomentoDetalle.id}/entregas`, {
      fecha: fomentoEntregaForm.fecha,
      valor: Number(fomentoEntregaForm.valor),
      concepto: fomentoEntregaForm.concepto || undefined,
      cash_register_id: dashboard.current_cash_register?.id
    });
    setFomentoEntregaForm({ fecha: new Date().toISOString().slice(0,10), valor: "", concepto: "" });
    addToast("Entrega registrada" + (dashboard.current_cash_register ? " y descontada de caja" : ""), "success");
    await loadFomentoDetalle(fomentoDetalle.id);
    await refreshFomentos();
    if (dashboard.current_cash_register?.id) await refreshCaja(dashboard.current_cash_register.id);
  }

  async function deleteFomentoEntrega(fomentoId: string, entregaId: string) {
    await apiFetch(`/fomentos/${fomentoId}/entregas/${entregaId}`, { method: "DELETE" });
    await loadFomentoDetalle(fomentoId);
    await refreshFomentos();
  }

  async function submitFomentoPago(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fomentoDetalle) return;
    await apiPost(`/fomentos/${fomentoDetalle.id}/pagos`, {
      fecha: fomentoPagoForm.fecha,
      valor: Number(fomentoPagoForm.valor),
      concepto: fomentoPagoForm.concepto || undefined,
      cash_register_id: dashboard.current_cash_register?.id
    });
    setFomentoPagoForm({ fecha: new Date().toISOString().slice(0,10), valor: "", concepto: "" });
    addToast("Pago registrado", "success");
    await loadFomentoDetalle(fomentoDetalle.id);
    await refreshFomentos();
    if (dashboard.current_cash_register?.id) await refreshCaja(dashboard.current_cash_register.id);
  }

  async function deleteFomentoPago(fomentoId: string, pagoId: string) {
    await apiFetch(`/fomentos/${fomentoId}/pagos/${pagoId}`, { method: "DELETE" });
    await loadFomentoDetalle(fomentoId);
    await refreshFomentos();
  }

  async function saveRenta(fomentoId: string) {
    const renta = Number(fomentoRentaInput) / 100;
    if (!renta || renta <= 0 || renta > 1) { addToast("Porcentaje inválido", "error"); return; }
    await apiFetch(`/fomentos/${fomentoId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ renta })
    });
    setFomentoEditingRenta(null);
    addToast("Tasa actualizada", "success");
    await refreshFomentos();
    if (fomentoDetalle?.id === fomentoId) await loadFomentoDetalle(fomentoId);
  }

  const submitSackBuy = async () => {
    if (!dashboard.current_cash_register?.id || !sackBuyForm.sack_id || !sackBuyForm.cantidad || !sackBuyForm.precio) {
      addToast("Completa todos los campos", "error");
      return;
    }
    const cantidad = parseInt(sackBuyForm.cantidad);
    const precio = parseFloat(sackBuyForm.precio);
    const registerId = dashboard.current_cash_register.id;
    try {
      // Compra ATOMICA: inventario + kardex + caja en una sola transaccion (backend).
      // Un unico endpoint reemplaza las dos llamadas separadas anteriores.
      await apiPost("/sacks/purchases", {
        sack_id: sackBuyForm.sack_id,
        cantidad,
        precio,
        cash_register_id: registerId
      });
      setSackBuyForm({ sack_id: "", cantidad: "", precio: "" });
      await refreshSacks();
      await refreshCaja(registerId);
      addToast("Compra de sacos registrada \u2713", "success");
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error");
    }
  };

  const refreshEquipment = async () => {
    const res = await apiFetch(`/equipment`);
    if (res.ok) setEquipment(await res.json());
  };

  const refreshMaintenanceHistory = async () => {
    try {
      const qs = new URLSearchParams();
      if (maintFilter.area) qs.set("area", maintFilter.area);
      if (maintFilter.from) qs.set("from", maintFilter.from);
      if (maintFilter.to) qs.set("to", maintFilter.to);
      const q = qs.toString();
      setMaintenanceHistory(await apiGet<any[]>(`/equipment/maintenance/all${q ? "?" + q : ""}`));
    } catch { /* noop */ }
  };

  const maintReportRows = () =>
    maintenanceHistory
      .filter((m: any) => !maintFilter.type || m.maintenance_type === maintFilter.type)
      .map((m: any) => [
        (m.created_at || "").slice(0, 10),
        m.area_label || "",
        m.section_label || "",
        m.maintenance_type,
        m.description || "",
        m.provider || "",
        Number(m.amount || 0).toFixed(2)
      ]);
  const MAINT_HEADERS = ["Fecha", "Área", "Sección", "Tipo", "Descripción", "Proveedor", "Monto"];
  const exportMaintCsv = () => exportReportCsv(MAINT_HEADERS, maintReportRows(), "mantenimiento.csv");
  const printMaintReport = () => printReport("Reporte de Mantenimiento", MAINT_HEADERS, maintReportRows());

  const refreshSuppliers = async () => {
    try { setSuppliers(await apiGet<Supplier[]>("/suppliers?all=1")); }
    catch { /* noop */ }
  };

  const purchasesFiltered = () => purchases.filter((c: any) => {
    const d = (c.purchase_date || "").slice(0, 10);
    if (purchaseFilter.from && d < purchaseFilter.from) return false;
    if (purchaseFilter.to && d > purchaseFilter.to) return false;
    if (purchaseFilter.supplier_id && c.supplier_id !== purchaseFilter.supplier_id) return false;
    if (purchaseFilter.payment_type && c.payment_type !== purchaseFilter.payment_type) return false;
    return true;
  });
  const PURCH_HEADERS = ["N°", "Fecha", "Proveedor", "Pago", "Estado", "Total"];
  const purchReportRows = () => purchasesFiltered().map((c: any) => [
    c.purchase_number,
    (c.purchase_date || "").slice(0, 10),
    c.supplier_name || "",
    c.payment_type === "CASH" ? "Contado" : "Credito",
    c.status,
    Number(c.total_amount || 0).toFixed(2)
  ]);
  const exportPurchCsv = () => exportReportCsv(PURCH_HEADERS, purchReportRows(), "compras.csv");
  const printPurchReport = () => printReport("Reporte de Compras", PURCH_HEADERS, purchReportRows());
  const refreshInvMovs = async () => {
    try { setInvMovs(await apiGet<any[]>("/inventory/movements")); }
    catch { /* noop */ }
  };
  const invMovsFiltered = () => invMovs.filter((m: any) => {
    const d = (m.created_at || "").slice(0, 10);
    if (invFilter.from && d < invFilter.from) return false;
    if (invFilter.to && d > invFilter.to) return false;
    if (invFilter.movement && m.movement !== invFilter.movement) return false;
    return true;
  });
  const INV_HEADERS = ["Fecha", "Producto", "Bodega", "Movimiento", "Cantidad", "Referencia"];
  const invReportRows = () => invMovsFiltered().map((m: any) => [
    (m.created_at || "").slice(0, 10),
    m.product_name || "",
    m.warehouse_name || "",
    m.movement,
    Number(m.quantity || 0).toFixed(2),
    m.reference_type || ""
  ]);
  const exportInvCsv = () => exportReportCsv(INV_HEADERS, invReportRows(), "inventario_movimientos.csv");
  const printInvReport = () => printReport("Reporte de Movimientos de Inventario", INV_HEADERS, invReportRows());

  const refreshPurchases = async () => {
    try { setPurchases(await apiGet<any[]>("/purchases")); }
    catch { /* noop */ }
  };

  const purchaseTotal = () =>
    purchaseItems.reduce((acc, it) => {
      const q = parseFloat(it.quantity) || 0;
      const p = parseFloat(it.unit_price) || 0;
      return acc + q * p;
    }, 0);

  const addPurchaseItem = () =>
    setPurchaseItems((prev) => [...prev, { item_type: "INSUMO", insumo_id: "", product_id: "", warehouse_id: "", quantity: "", unit_price: "" }]);

  const removePurchaseItem = (idx: number) =>
    setPurchaseItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const updatePurchaseItem = (idx: number, patch: Partial<{ item_type: "INSUMO" | "PRODUCT"; insumo_id: string; product_id: string; warehouse_id: string; quantity: string; unit_price: string; }>) =>
    setPurchaseItems((prev) => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const submitPurchase = async () => {
    if (!purchaseForm.supplier_id) { addToast("Selecciona un proveedor", "error"); return; }
    const items: any[] = [];
    for (const it of purchaseItems) {
      const quantity = parseFloat(it.quantity);
      const unit_price = parseFloat(it.unit_price);
      if (!quantity || quantity <= 0) { addToast("Cada item necesita cantidad mayor a 0", "error"); return; }
      if (isNaN(unit_price) || unit_price < 0) { addToast("Precio invalido en un item", "error"); return; }
      if (it.item_type === "INSUMO") {
        if (!it.insumo_id) { addToast("Selecciona el insumo en cada item", "error"); return; }
        items.push({ item_type: "INSUMO", insumo_id: it.insumo_id, quantity, unit_price });
      } else {
        if (!it.product_id || !it.warehouse_id) { addToast("Selecciona producto y bodega en cada item", "error"); return; }
        items.push({ item_type: "PRODUCT", product_id: it.product_id, warehouse_id: it.warehouse_id, quantity, unit_price });
      }
    }
    if (purchaseTotal() <= 0) { addToast("El total de la compra debe ser mayor a 0", "error"); return; }

    const payload: any = {
      supplier_id: purchaseForm.supplier_id,
      payment_type: purchaseForm.payment_type,
      invoice_number: purchaseForm.invoice_number || undefined,
      notes: purchaseForm.notes || undefined,
      items
    };
    if (purchaseForm.payment_type === "CASH") {
      const registerId = dashboard.current_cash_register?.id;
      if (!registerId) { addToast("No hay caja abierta para una compra a contado", "error"); return; }
      payload.cash_register_id = registerId;
    } else if (purchaseForm.due_date) {
      payload.due_date = purchaseForm.due_date;
    }

    try {
      await apiPost("/purchases", payload);
      setPurchaseForm({ supplier_id: "", payment_type: "CASH", due_date: "", invoice_number: "", notes: "" });
      setPurchaseItems([{ item_type: "INSUMO", insumo_id: "", product_id: "", warehouse_id: "", quantity: "", unit_price: "" }]);
      await refreshPurchases();
      if (purchaseForm.payment_type === "CASH" && dashboard.current_cash_register?.id) {
        await refreshCaja(dashboard.current_cash_register.id);
      }
      addToast("Compra registrada ✓", "success");
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error");
    }
  };

  const submitNewSupplier = async () => {
    if (!supplierForm.name || supplierForm.name.trim().length < 2) { addToast("Nombre del proveedor requerido", "error"); return; }
    try {
      await apiPost("/suppliers", {
        name: supplierForm.name.trim(),
        identification: supplierForm.identification || undefined,
        phone: supplierForm.phone || undefined,
        email: supplierForm.email || undefined,
        address: supplierForm.address || undefined,
        notes: supplierForm.notes || undefined
      });
      setSupplierForm({ name: "", identification: "", phone: "", email: "", address: "", notes: "" });
      await refreshSuppliers();
      addToast("Proveedor creado ✓", "success");
    } catch (e) { addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error"); }
  };

  const startEditSupplier = (s: Supplier) => {
    setEditingSupplierId(s.id);
    setSupplierEdit({ name: s.name, identification: s.identification || "", phone: s.phone || "", email: s.email || "", address: s.address || "", notes: s.notes || "" });
  };

  const saveSupplierEdit = async (id: string) => {
    if (!supplierEdit.name || supplierEdit.name.trim().length < 2) { addToast("Nombre requerido", "error"); return; }
    try {
      const res = await apiFetch(`/suppliers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: supplierEdit.name.trim(),
          identification: supplierEdit.identification || undefined,
          phone: supplierEdit.phone || undefined,
          email: supplierEdit.email || undefined,
          address: supplierEdit.address || undefined,
          notes: supplierEdit.notes || undefined
        })
      });
      if (!res.ok) throw new Error(await res.text());
      setEditingSupplierId(null);
      await refreshSuppliers();
      addToast("Proveedor actualizado ✓", "success");
    } catch (e) { addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error"); }
  };

  const toggleSupplierActive = async (s: Supplier) => {
    try {
      const res = await apiFetch(`/suppliers/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !s.is_active })
      });
      if (!res.ok) throw new Error(await res.text());
      await refreshSuppliers();
      addToast(s.is_active ? "Proveedor desactivado" : "Proveedor reactivado", "success");
    } catch (e) { addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error"); }
  };

  const submitNewEquipment = async () => {
    if (!newEquipmentForm.name || !newEquipmentForm.type) {
      addToast("Completa nombre y tipo", "error");
      return;
    }

    try {
      const res = await apiFetch(`/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newEquipmentForm.name,
          type: newEquipmentForm.type,
          status: newEquipmentForm.status,
          code: newEquipmentForm.code || undefined,
          brand: newEquipmentForm.brand || undefined,
          model: newEquipmentForm.model || undefined,
          serial: newEquipmentForm.serial || undefined,
          location: newEquipmentForm.location || undefined
        })
      });
      if (!res.ok) throw new Error(await res.text());

      setNewEquipmentForm({ name: "", type: "PILADORA", status: "ACTIVA", code: "", brand: "", model: "", serial: "", location: "" });
      await refreshEquipment();
      addToast("Máquina creada ✓", "success");
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error");
    }
  };

  const deleteEquipment = async (equipmentId: string) => {
    if (!confirm("¿Eliminar este equipo?")) return;
    try {
      const res = await apiFetch(`/equipment/${equipmentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) throw new Error(await res.text());
      await refreshEquipment();
      addToast("Equipo actualizado ✓", "success");
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error");
    }
  };

  const getDescriptionPlaceholder = () => {
    if (maintenanceForm.area === "PILADORA") {
      return "Ej: cambio de faja - pulidor 2, rodamiento - descascarador, malla - zaranda, ajuste - plan sister";
    }
    return "Descripción del trabajo realizado";
  };

  const submitEquipmentMaintenance = async (photoFile?: File) => {
    if (!dashboard.current_cash_register?.id || !maintenanceForm.area || !maintenanceForm.section || !maintenanceForm.description || !maintenanceForm.amount) {
      addToast("Completa los campos requeridos", "error");
      return;
    }
    const amount = parseFloat(maintenanceForm.amount);
    const registerId = dashboard.current_cash_register.id;

    try {

      // Convertir foto a base64 si existe
      let photoBase64: string | undefined;
      if (photoFile) {
        const reader = new FileReader();
        photoBase64 = await new Promise((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(photoFile);
        });
      }

      const res = await apiFetch(`/equipment/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: maintenanceForm.area,
          section: maintenanceForm.section,
          maintenance_type: maintenanceForm.maintenance_type,
          description: maintenanceForm.description,
          provider: maintenanceForm.provider || undefined,
          invoice_number: maintenanceForm.invoice_number || undefined,
          receipt_photo_base64: photoBase64,
          amount,
          cash_register_id: registerId
        })
      });
      if (!res.ok) throw new Error(await res.text());

      setMaintenanceForm({
        area: "",
        section: "",
        maintenance_type: "CORRECTIVO",
        description: "",
        provider: "",
        invoice_number: "",
        receipt_photo_url: "",
        amount: ""
      });
      await refreshCaja(registerId);
      await refreshMaintenanceHistory();
      addToast("Mantenimiento registrado ✓", "success");
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error");
    }
  };

  async function submitCajaFomento(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cajaFomentoId) { addToast("Selecciona un agricultor fomentado", "error"); return; }
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) { addToast("No hay caja abierta", "error"); return; }
    const endpoint = cajaFomentoAccion === "entrega"
      ? `/fomentos/${cajaFomentoId}/entregas`
      : `/fomentos/${cajaFomentoId}/pagos`;
    await apiPost(endpoint, {
      fecha: new Date().toISOString().slice(0,10),
      valor: Number(cajaFomentoMonto),
      concepto: cajaFomentoConcepto || (cajaFomentoAccion === "entrega" ? "Entrega de insumos" : "Pago de fomento"),
      cash_register_id: registerId
    });
    setCajaFomentoMonto("");
    setCajaFomentoConcepto("");
    addToast(cajaFomentoAccion === "entrega" ? "Entrega registrada en caja" : "Pago registrado en caja", "success");
    await refreshFomentos();
    await refreshCaja(registerId);
  }

  async function downloadCajaExcel() {
    if (!cashSummary) return;
    try {
      const res = await apiFetch(`/cash/registers/${cashSummary.id}/export-excel`);
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = "cierre-caja.xlsx";
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      addToast(`Error al descargar: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    }
  }

  function printCajaMovimientos() {
    if (!cashSummary) return;
    const opening = Number(cashSummary.opening_balance);
    const openingCash = Number(cashSummary.opening_balance_cash ?? 0);
    const openingBank = Number(cashSummary.opening_balance_bank ?? 0);
    const rows = cashMovements.map((m, i) => {
      const isIncome = m.movement === "INCOME";
      return `<tr>
        <td>${i+1}</td>
        <td>${new Date(m.created_at).toLocaleString("es-EC")}</td>
        <td>${m.category}</td>
        <td>${m.description ?? ""}</td>
        <td style="color:green">${isIncome ? "$"+Number(m.amount).toFixed(2) : ""}</td>
        <td style="color:#c00">${!isIncome ? "$"+Number(m.amount).toFixed(2) : ""}</td>
      </tr>`;
    }).join("");
    const balance = (opening + cashSummary.total_income - cashSummary.total_expense).toFixed(2);
    const saldoLinea = openingCash > 0 || openingBank > 0
      ? `Efectivo: $${openingCash.toFixed(2)} · Banco: $${openingBank.toFixed(2)} · Total: $${opening.toFixed(2)}`
      : `Saldo inicial: $${opening.toFixed(2)}`;
    const html = `<html><head><title>Cierre de Caja</title>
    <style>body{font-family:Arial;font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:4px 8px}th{background:#16a34a;color:#fff}.tot{font-weight:bold}</style>
    </head><body>
    <h2 style="text-align:center;margin-bottom:2px">${appSettings.business_name}</h2>
    <p style="text-align:center;margin:0 0 12px;color:#555">${[appSettings.business_subtitle, appSettings.ruc && `RUC: ${appSettings.ruc}`].filter(Boolean).join(" · ")}</p>
    <h3 style="text-align:center">${cashSummary.name} — Cierre de Caja</h3>
    <p>Fecha apertura: ${new Date(cashSummary.opened_at).toLocaleString("es-EC")} | ${saldoLinea}</p>
    <table><thead><tr><th>#</th><th>Fecha/Hora</th><th>Categoría</th><th>Descripción</th><th>Ingreso</th><th>Egreso</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="tot"><td colspan="4">TOTALES</td><td style="color:green">$${cashSummary.total_income.toFixed(2)}</td><td style="color:#c00">$${cashSummary.total_expense.toFixed(2)}</td></tr>
      <tr class="tot"><td colspan="4">SALDO FINAL</td><td colspan="2">$${balance}</td></tr>
    </tfoot></table>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.print();
  }

  async function submitFarmer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await apiPost("/farmers", {
      full_name: form.get("full_name"),
      identification: form.get("identification") || undefined,
      phone: form.get("phone") || undefined,
      accionista_id: form.get("accionista_id") || null
    });
    safeResetForm(formElement);
    setMessage("Agricultor guardado");
    await refresh();
  }

  async function changeLotAccionista(lotId: string, accionistaId: string) {
    if (!accionistaId) return;
    const lot = lots.find((item) => item.id === lotId);
    const destino = accionistas.find((a) => a.id === accionistaId)?.name ?? "";
    const origen = accionistas.find((a) => a.id === lot?.accionista_id)?.name ?? "sin asignar";

    // El traspaso mueve plata: crea deuda entre accionistas. No se hace de un
    // clic sin avisar qué implica.
    const ok = window.confirm(
      `¿Pasar el lote ${lot?.lot_code ?? ""} de ${origen} a ${destino}?\n\n` +
      `Se mueve el lote con su inventario, su proceso y sus liquidaciones.\n\n` +
      `Lo que ${origen} ya le pagó al agricultor queda como cuenta POR COBRAR suya, y como cuenta POR PAGAR de ${destino}. ` +
      `Lo que aún se le deba al agricultor lo paga ${destino} de ahora en adelante.`
    );
    if (!ok) return;

    const res = await apiPut<LotTransferResult>(`/lots/${lotId}/accionista`, {
      accionista_id: accionistaId,
      created_by: authUser?.id
    });

    const t = res.traspaso;
    if (t && Number(t.ya_cancelado) > 0) {
      addToast(
        `Lote traspasado. ${t.de} tiene por cobrar ${money(Number(t.ya_cancelado))} a ${t.para}. ` +
        `Pendiente con el agricultor: ${money(Number(t.pendiente_agricultor))}, ahora lo paga ${t.para}.`,
        "success"
      );
    } else {
      addToast("Lote cambiado de accionista (se movió también su inventario)", "success");
    }
    await refresh();
  }


  async function submitAdvance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await apiPost("/advances", {
      farmer_id: form.get("farmer_id"),
      amount: Number(form.get("amount")),
      concept: form.get("concept")
    });
    safeResetForm(formElement);
    setMessage("Anticipo registrado");
    await refresh();
  }

  async function submitCash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiPost("/cash/registers/open", {
      name: newCajaName,
      tipo: newCajaTipo,
      opening_balance_cash: Number(newCajaCash),
      opening_balance_bank: Number(newCajaBank)
    });
    addToast("Caja abierta", "success");
    setNewCajaCash("0");
    setNewCajaBank("0");
    await refresh();
  }

  async function loadPreviousBalance(tipo: "EFECTIVO" | "BANCO") {
    try {
      const data = await apiGet<{ final_balance: number }>(`/cash/registers/previous-balance?tipo=${tipo}`);
      const total = data.final_balance;
      if (total <= 0) return;
      if (tipo === "EFECTIVO") {
        setNewCajaCash(total.toFixed(2));
        setNewCajaBank("0");
      } else {
        setNewCajaBank(total.toFixed(2));
        setNewCajaCash("0");
      }
    } catch {
      // sin caja anterior: deja en 0
    }
  }

  async function updateOpeningBalance() {
    const id = dashboard.current_cash_register?.id;
    if (!id) return;
    try {
      await apiPut(`/cash/registers/${id}/opening-balance`, {
        opening_balance_cash: Number(newCajaCash),
        opening_balance_bank: Number(newCajaBank)
      });
      addToast("Saldo inicial actualizado", "success");
      setEditOpeningBalance(false);
      setNewCajaCash("0");
      setNewCajaBank("0");
      await refreshCaja(id);
      await refresh();
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "desconocido"}`, "error");
    }
  }

  async function closeCaja() {
    if (!cashSummary) return;
    await apiPost(`/cash/registers/${cashSummary.id}/close`, {});
    addToast("Caja cerrada", "success");
    setCashSummary(null);
    setCashMovements([]);
    await refresh();
  }

  async function submitCajaAnticipo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) throw new Error("No hay caja abierta");
    await apiPost("/advances", {
      farmer_id: form.get("farmer_id"),
      amount: Number(form.get("amount")),
      concept: form.get("concept"),
      cash_register_id: registerId,
      apply_to_payables: true
    });
    safeResetForm(formElement);
    addToast("Anticipo registrado", "success");
    await refresh();
    await refreshCaja(registerId);
  }

  async function submitCajaMovimiento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) throw new Error("No hay caja abierta");
    const movement = form.get("movement") as "INCOME" | "EXPENSE";
    const category = form.get("category") as string;
    await apiPost(`/cash/${registerId}/movements`, {
      movement,
      category,
      amount: Number(form.get("amount")),
      description: form.get("description") || undefined
    });
    safeResetForm(formElement);
    setMovCategory("");
    addToast(`${movement === "INCOME" ? "Ingreso" : "Egreso"} registrado`, "success");
    await refreshCaja(registerId);
  }

  async function aplicarAnticiposLiquidacion(liquidationIds: string[]) {
    let totalAplicado = 0;
    for (const id of liquidationIds) {
      try {
        const r = await apiPost<{ applied: number; remaining: number }>(`/liquidations/${id}/apply-advances`, {});
        totalAplicado += r.applied;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("ya está pagada") && !msg.includes("No hay anticipos")) throw e;
      }
    }
    if (totalAplicado === 0) throw new Error("No hay anticipos pendientes para este agricultor");
    addToast(`Anticipo aplicado: $${totalAplicado.toFixed(2)} descontados`, "success");
    const [liqRows] = await Promise.all([apiGet<LiqRecord[]>("/liquidations")]);
    setLiquidacionesList(liqRows);
    await refresh();
  }

  // Desbloquear / bloquear la edicion de una liquidacion (grupo). SOLO admin:
  // el candado protege las liquidaciones ya hechas.
  async function toggleLiqLock(b: LiqBatch) {
    await apiPost("/liquidations/set-lock", { ids: b.liquidation_ids, unlocked: !b.unlocked });
    addToast(b.unlocked ? "Liquidacion BLOQUEADA" : "Liquidacion desbloqueada para editar", "success");
    const liqRows = await apiGet<LiqRecord[]>("/liquidations");
    setLiquidacionesList(liqRows);
  }

  // Abrir el editor de precio/otros descuentos de una liquidacion desbloqueada.
  function openLiqEdit(b: LiqBatch) {
    const rows = liquidacionesList
      .filter((r) => b.liquidation_ids.includes(r.id))
      .map((r) => ({ id: r.id, lot_code: r.lot_code, price: String(Number(r.price_per_quintal).toFixed(2)), other: String(Number(r.other_discounts).toFixed(2)) }));
    setLiqEditRows(rows);
    setLiqEdit(b);
  }

  // Guardar correcciones. El backend recalcula bruto/neto y ajusta la cuenta
  // por pagar; el cambio queda auditado automaticamente (middleware de auditoria).
  async function saveLiqEdit() {
    if (!liqEdit) return;
    for (const row of liqEditRows) {
      await apiPut(`/liquidations/${row.id}`, {
        price_per_quintal: Number(row.price) || 0,
        other_discounts: Number(row.other) || 0
      });
    }
    addToast("Liquidacion corregida", "success");
    const liqRows = await apiGet<LiqRecord[]>("/liquidations");
    setLiquidacionesList(liqRows);
    await refresh();
    setLiqEdit(null);
  }

  async function pagarCuenta(payableId: string, amount: number) {
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) throw new Error("No hay caja abierta");
    await apiPost(`/cash/payables/${payableId}/pay`, {
      cash_register_id: registerId,
      amount
    });
    addToast("Pago registrado", "success");
    await refreshCaja(registerId);
  }

  // Paga una liquidación completa: un solo monto que el backend reparte entre
  // sus cuentas (de la más vieja a la más nueva) y deja UN movimiento en caja.
  async function pagarGrupoCuentas(payableIds: string[], amount: number) {
    const registerId = dashboard.current_cash_register?.id;
    if (!registerId) throw new Error("No hay caja abierta");
    await apiPost("/cash/payables/pay-group", {
      payable_ids: payableIds,
      cash_register_id: registerId,
      amount
    });
    addToast("Pago registrado", "success");
    await refreshCaja(registerId);
  }

  async function setupMasterData() {
    setBusy(true);
    try {
      await Promise.all([
        apiPost("/inventory/products", {
          code: "CASCARA-011",
          name: "Cascara 0.11",
          product_type: "RAW_MATERIAL",
          unit: "QQ"
        }),
        apiPost("/inventory/products", {
          code: "CASCARA-CORRIENTE",
          name: "Cascara Corriente",
          product_type: "RAW_MATERIAL",
          unit: "QQ"
        }),
        apiPost("/inventory/products", {
          code: "ARROZ-PILADO-011",
          name: "Producto 0.11",
          product_type: "FINISHED_GOOD",
          unit: "QQ"
        }),
        apiPost("/inventory/products", {
          code: "ARROZ-PILADO-CORRIENTE",
          name: "Producto Corriente",
          product_type: "FINISHED_GOOD",
          unit: "QQ"
        }),
        apiPost("/inventory/products", {
          code: "ARROCILLO-34",
          name: "Arrocillo 3/4",
          product_type: "BYPRODUCT",
          unit: "QQ"
        }),
        apiPost("/inventory/products", {
          code: "ARROCILLO-FINO",
          name: "Arrocillo Fino",
          product_type: "BYPRODUCT",
          unit: "QQ"
        }),
        apiPost("/inventory/products", {
          code: "POLVILLO",
          name: "Polvillo / Afrecho",
          product_type: "BYPRODUCT",
          unit: "QQ"
        }),
        apiPost("/inventory/warehouses", {
          name: "Bodega Materia Prima",
          type: "RAW_MATERIAL"
        }),
        apiPost("/inventory/warehouses", {
          name: "Bodega Producto Terminado",
          type: "FINISHED_GOODS"
        }),
        apiPost("/inventory/insumos", {
          nombre: "Sacos vacios",
          stock_actual: 500,
          nivel_critico: 50,
          unidad: "UNIDAD"
        })
      ]);
      setMessage("Datos base creados: productos, bodegas y sacos vacios");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitWeighing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const gross = Number(form.get("gross_weight"));
    const tare = Number(form.get("tare_weight"));
    const qualification = Number(form.get("qualification"));
    const farmerId = String(form.get("farmer_id"));
    const riceType = String(form.get("rice_type")) as "0.11" | "CORRIENTE";
    const productId = riceType === "CORRIENTE" ? rawProductCorriente?.id : rawProduct011?.id;
    const warehouseId = rawWarehouse?.id ?? "";
    const ownership = String(form.get("ownership"));

    if (!productId) {
      setMessage("Falta crear el producto de cascara para ese tipo de arroz");
      return;
    }

    const created = await apiPost<{ ticket: { id: string } }>("/weighing-tickets", {
      farmer_id: farmerId,
      rice_type: riceType,
      ownership,
      is_maquila: ownership === "MAQUILA",
      gross_weight: gross
    });

    await apiPut(`/weighing-tickets/${created.ticket.id}/tare-weight`, { tare_weight: tare });
    await apiPut(`/weighing-tickets/${created.ticket.id}/qualification`, { qualification });
    await apiPost(`/weighing-tickets/${created.ticket.id}/close`, {
      product_id: productId,
      warehouse_id: warehouseId
    });

    safeResetForm(formElement);
    setMessage("Ticket de bascula cerrado e inventario actualizado");
    await refresh();
  }

  async function submitSupply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await apiPost("/inventory/insumos", {
      nombre: form.get("nombre"),
      stock_actual: Number(form.get("stock_actual")),
      nivel_critico: Number(form.get("nivel_critico") || 50),
      unidad: form.get("unidad") || "UNIDAD"
    });
    safeResetForm(formElement);
    setMessage("Insumo actualizado");
    await refresh();
  }

  async function loadProcessFlow(lotId = traceLotId) {
    if (!lotId) {
      setMessage("Seleccione un lote para ver secadoras");
      return;
    }
    const flow = await apiGet<ProcessFlow>(`/process-flow/lots/${lotId}`);
    setProcessFlow(flow);
    setTraceLotId(lotId);
    setMessage(`Secadoras cargadas para ${flow.lot.lot_code}`);
  }

  async function submitDryingReport(event: FormEvent<HTMLFormElement>, secadora: string) {
    event.preventDefault();
    await submitDryingForm(event.currentTarget, secadora);
  }

  function addDryingEntry(secadora: string) {
    const entryId = dryingEntryPick[secadora];
    if (!entryId) {
      setMessage("Selecciona un ingreso de materia prima");
      return;
    }
    setDryingSelections((cur) => ({ ...cur, [secadora]: [...(cur[secadora] ?? []), entryId] }));
    setDryingEntryPick((cur) => ({ ...cur, [secadora]: "" }));
  }

  function removeDryingEntry(secadora: string, lotId: string) {
    if (editandoEnSecadora(secadora)) return;
    setDryingSelections((cur) => ({ ...cur, [secadora]: (cur[secadora] ?? []).filter((id) => id !== lotId) }));
  }

  function editDryingReport(report: DryingTunnelReport) {
    setEditingDryingReport(report);
    // El formulario del secado vive bajo su motor: cambiar a esa vista.
    setMotorActivo(motorDeSecadora(report.dryer_name));
    setMessage(`Editando secado del Tunel ${report.tunnel_number} (${report.dryer_name ?? "Secadora 1"})`);
  }

  function clearDryingForm(form?: HTMLFormElement | null, secadora?: string) {
    setEditingDryingReport(null);
    if (secadora) setDryingSelections((cur) => ({ ...cur, [secadora]: [] }));
    safeResetForm(form);
    setMessage("Formulario listo para nuevo secado");
  }

  async function loadMotorActive(motor: 1 | 2 = motorActivo) {
    const [rows, tunnelRows] = await Promise.all([
      apiGet<MotorActiveReport[]>(`/process-flow/drying/motor/${motor}/active`).catch(
        () => [] as MotorActiveReport[]
      ),
      apiGet<TunnelStatusRow[]>("/process-flow/drying/tunnels-status").catch(() => [] as TunnelStatusRow[])
    ]);
    setMotorActiveReports(rows);
    // Un túnel ocupado por otro accionista no se puede llenar: se bloquea en el formulario.
    const occupied: Record<number, string> = {};
    for (const r of tunnelRows) {
      if (!(r.tunnel_number in occupied)) occupied[r.tunnel_number] = r.accionista_name;
    }
    setOccupiedTunnels(occupied);
  }

  // Guarda TODO el informe del motor junto: crea el lote de cada secadora que
  // tenga ingresos (aunque la otra esté vacía) y, al final, registra el
  // combustible del motor repartiéndolo entre los secados. Un solo botón.
  async function guardarInformeMotor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const secadoras = MOTOR_SECADORAS[motorActivo];
    const conIngresos = secadoras.filter((s) => seleccionDe(s).length > 0);
    const hayCombustible = combustibleTotal > 0;

    // El motor enciende una sola vez: la hora de INICIO del secado es la misma
    // para las dos secadoras del motor; solo la hora FINAL puede variar. Si ya
    // hay un secado activo con hora de inicio, esa manda sobre lo digitado.
    const inicioActivo = motorActiveReports.find((r) => r.dry_start_at)?.dry_start_at ?? null;
    const horaInicioMotor = inicioActivo ?? stringOrUndefined(form.get("dry_start_at_motor"));

    // Candado: no se puede guardar nada en un túnel que está secando a otro
    // accionista (además del bloqueo visual del formulario).
    const bloqueada = conIngresos.find((s) => occupiedTunnels[tunelDeSecadora(s)]);
    if (bloqueada) {
      const t = tunelDeSecadora(bloqueada);
      setMessage(`El túnel ${t} está en uso por ${occupiedTunnels[t]}. Quita esos ingresos y usa otro túnel.`);
      return;
    }

    if (conIngresos.length === 0 && !hayCombustible) {
      setMessage("Agrega ingresos a alguna secadora o registra el combustible del motor");
      return;
    }

    // 1) El lote de cada secadora llena.
    let creados = 0;
    for (const secadora of conIngresos) {
      const t = tunelDeSecadora(secadora);
      const operatorName = String(form.get(`secador_name_${t}`) ?? "").trim();
      if (operatorName) saveSecadorName(t, operatorName);
      await apiPost<DryingTunnelReport>("/process-flow/drying", {
        entry_ids: seleccionDe(secadora),
        lot_code: String(form.get(`lot_code_${t}`) ?? "").trim() || undefined,
        tunnel_number: t,
        rice_type: form.get(`rice_type_${t}`) || "0.11",
        moisture_before: numberOrUndefined(form.get(`moisture_before_${t}`)),
        filled_at: stringOrUndefined(form.get(`filled_at_${t}`)),
        dry_start_at: horaInicioMotor,
        dry_end_at: stringOrUndefined(form.get(`dry_end_at_${t}`)),
        dryer_name: secadora,
        operator_name: operatorName || undefined,
        notes: form.get(`notes_${t}`) || undefined
      });
      creados++;
    }
    if (conIngresos.length > 0) {
      setDryingSelections((cur) => {
        const next = { ...cur };
        conIngresos.forEach((s) => { next[s] = []; });
        return next;
      });
      setDryingEntryPick((cur) => {
        const next = { ...cur };
        conIngresos.forEach((s) => { next[s] = ""; });
        return next;
      });
    }
    // Ya guardados: ahora son secados activos para repartir el combustible.
    const activos = await apiGet<MotorActiveReport[]>(`/process-flow/drying/motor/${motorActivo}/active`).catch(() => [] as MotorActiveReport[]);
    setMotorActiveReports(activos);

    // 2) El combustible del motor, repartido entre todos los secados activos.
    let msgFuel = "";
    if (hayCombustible) {
      if (activos.length === 0) {
        setMotorActiveReports(activos);
        addToast("Guardé los lotes, pero no hay secados activos para repartir el combustible.", "error");
      } else {
        const fuel = await apiPost<{ costo_por_qq: number; reparto: Array<{ total: number }>; finalized?: number }>(
          "/process-flow/drying/motor-fuel",
          {
            motor_number: motorActivo,
            gas_bombona_inicio: Number(gasForm.bombona_inicio || 0),
            gas_bombona_fin: Number(gasForm.bombona_fin || 0),
            gas_cilindro_cantidad: Number(gasForm.cilindro_cantidad || 0),
            diesel_inicio: Number(gasForm.diesel_inicio || 0),
            diesel_fin: Number(gasForm.diesel_fin || 0),
            finalize: false,
            created_by: authUser?.id
          }
        );
        setGasForm({ bombona_inicio: "", bombona_fin: "", cilindro_cantidad: "", diesel_inicio: "", diesel_fin: "" });
        msgFuel = ` · gas ${money(gasCostoTotal)} + diésel ${money(dieselCosto)} repartidos (${money(fuel.costo_por_qq)}/QQ)`;
      }
    }

    safeResetForm(event.currentTarget);
    setEditingDryingReport(null);
    await refresh();
    await loadMotorActive();
    addToast(
      `Informe del Motor ${motorActivo} guardado: ${creados} secadora(s)${msgFuel}`,
      "success"
    );
  }

  // Cierra el combustible del motor: lo reparte entre los secados de la última
  // corrida (aunque ya estén finalizados). Se usa desde la edición del motor.
  async function cerrarCombustibleMotor() {
    if (!(combustibleTotal > 0)) { setMessage("Ingresa los medidores del combustible del motor"); return; }
    const activos = await apiGet<MotorActiveReport[]>(`/process-flow/drying/motor/${motorActivo}/active`).catch(() => [] as MotorActiveReport[]);
    if (activos.length === 0) { addToast("Este motor no tiene secados pendientes de combustible.", "error"); return; }
    const fuel = await apiPost<{ costo_por_qq: number; finalized?: number }>("/process-flow/drying/motor-fuel", {
      motor_number: motorActivo,
      gas_bombona_inicio: Number(gasForm.bombona_inicio || 0),
      gas_bombona_fin: Number(gasForm.bombona_fin || 0),
      gas_cilindro_cantidad: Number(gasForm.cilindro_cantidad || 0),
      diesel_inicio: Number(gasForm.diesel_inicio || 0),
      diesel_fin: Number(gasForm.diesel_fin || 0),
      finalize: true,
      created_by: authUser?.id
    });
    setGasForm({ bombona_inicio: "", bombona_fin: "", cilindro_cantidad: "", diesel_inicio: "", diesel_fin: "" });
    setEditingDryingReport(null);
    addToast(`Combustible del Motor ${motorActivo} repartido (${money(fuel.costo_por_qq)}/QQ) y ${fuel.finalized ?? 0} secado(s) finalizado(s)`, "success");
    await refresh();
    await loadMotorActive();
  }

  async function finalizarSecadoMotor() {
    const result = await apiPost<{ finalized: number }>("/process-flow/drying/motor-finalize", { motor_number: motorActivo });
    addToast(`Motor ${motorActivo} finalizado: ${result.finalized} secado(s) completado(s).`, "success");
    await refresh();
    await loadMotorActive();
  }

  // Guarda/finaliza UN secado por su id (para editar las dos secadoras en
  // proceso del motor a la vez, cada una en su propio formulario).
  async function guardarSecadoEditado(report: DryingTunnelReport, formElement: HTMLFormElement, finalizar: boolean) {
    const form = new FormData(formElement);
    const endInput = formElement.elements.namedItem("dry_end_at") as HTMLInputElement | null;
    if (finalizar && endInput && !endInput.value) endInput.value = dateTimeLocalValue(new Date().toISOString());
    const payload = {
      rice_type: form.get("rice_type") || "0.11",
      moisture_before: numberOrUndefined(form.get("moisture_before")),
      filled_at: stringOrUndefined(form.get("filled_at")),
      dry_start_at: stringOrUndefined(form.get("dry_start_at")),
      dry_end_at: stringOrUndefined(endInput?.value ?? null),
      dryer_name: report.dryer_name,
      operator_name: String(form.get("operator_name") ?? "").trim(),
      notes: form.get("notes") || undefined
    };
    const updated = await apiPut<DryingTunnelReport>(`/process-flow/drying/${report.id}`, payload);
    setMessage(updated.status === "COMPLETED" ? `Secado del Túnel ${updated.tunnel_number} finalizado` : `Secado del Túnel ${updated.tunnel_number} actualizado`);
    await refresh();
    await loadMotorActive();
    // Al guardar (con o sin finalizar) se sale del modo edición y se vuelve a
    // la vista del motor, donde la secadora queda como "En uso / OCUPADO POR".
    safeResetForm(formElement);
    setEditingDryingReport(null);
  }

  // Panel de medidores del combustible del motor.
  function renderFuelFieldset() {
    return (
      <fieldset className="medidorPanel" style={{ marginTop: 16 }}>
        <legend>⛽ Combustible del Motor {motorActivo}</legend>
        <p className="muted">
          El medidor es del motor y se reparte entre las secadoras de la corrida según sus quintales.
          Como pueden terminar en momentos distintos, regístralo al final: se reparte igual entre las dos.
        </p>
        <MedidorRow
          label="Bombona" unidad="%"
          nameInicio="gas_bombona_inicio" nameFin="gas_bombona_fin"
          inicio={gasForm.bombona_inicio} fin={gasForm.bombona_fin}
          onInicio={(v) => setGasForm({ ...gasForm, bombona_inicio: v })}
          onFin={(v) => setGasForm({ ...gasForm, bombona_fin: v })}
          precio={laborRatesForm.precio_gas_bombona}
        />
        <div className="medidorRow">
          <span className="medidorLabel">Cilindro</span>
          <label><span>Utilizados</span>
            <input type="number" step="0.01" min="0" placeholder="0" value={gasForm.cilindro_cantidad}
              onChange={(e) => setGasForm({ ...gasForm, cilindro_cantidad: e.target.value })} />
          </label>
          <span className="medidorOp">×</span>
          <div className="medidorOut muted"><small>Precio</small><strong>{money(laborRatesForm.precio_gas_cilindro)}</strong></div>
          <span className="medidorOp">=</span>
          <div className="medidorOut total"><small>Total $</small><strong>{money(gasCilindroCosto)}</strong></div>
        </div>
        <MedidorRow
          label="Diesel" unidad="diesel"
          nameInicio="diesel_inicio" nameFin="diesel_fin"
          inicio={gasForm.diesel_inicio} fin={gasForm.diesel_fin}
          onInicio={(v) => setGasForm({ ...gasForm, diesel_inicio: v })}
          onFin={(v) => setGasForm({ ...gasForm, diesel_fin: v })}
          precio={laborRatesForm.precio_diesel}
        />
        <div className="medidorTotal" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <span>TOTAL GAS</span>
            <strong>{money(gasCostoTotal)}</strong>
          </div>
          <div>
            <span>TOTAL DIÉSEL</span>
            <strong>{money(dieselCosto)}</strong>
          </div>
        </div>
        {(gasCostoTotal > 0 || dieselCosto > 0) && qqMotor > 0 && (
          <div className="costoQq">
            <div className="costoQqTotal">
              <small>Combustible por QQ</small>
              <strong>{money(gasPorQq)} gas + {money(dieselPorQq)} diésel</strong>
              <span className="muted">{money(gasCostoTotal)} gas + {money(dieselCosto)} diésel ÷ {qqMotor.toFixed(2)} QQ</span>
            </div>
          </div>
        )}
        <p className="muted medidorNota">Los precios se configuran en Configuración → Tarifas. Deja en cero lo que no uses.</p>
      </fieldset>
    );
  }

  function updateProductionPackage(key: ProductionPackageKey, changes: Partial<ProductionPackageState[ProductionPackageKey]>) {
    setProductionPackages((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...changes
      }
    }));
  }

  function addDryerEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const producer = dryerProducer.trim().toUpperCase();
    const weightQq = Number(dryerWeightQq);

    if (!producer) {
      setMessage("Ingrese el nombre completo del productor");
      return;
    }

    if (!Number.isFinite(weightQq) || weightQq <= 0) {
      setMessage("Ingrese un peso valido en QQ");
      return;
    }

    setDryerEntries((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        dryer: selectedDryer,
        producer,
        weightQq
      }
    ]);
    setDryerProducer("");
    setDryerWeightQq("");
    setMessage(`${producer} agregado a ${selectedDryer}`);
  }

  function removeDryerEntry(entryId: string) {
    setDryerEntries((current) => current.filter((entry) => entry.id !== entryId));
  }

  function updateMillingField(field: keyof MillingReportState, value: string) {
    setMillingReport((current) => ({
      ...current,
      [field]: value
    }));
    setMillingYields(null);
  }

  function updateProductionDryingId(value: string) {
    setProductionDryingId(value);
    setMillingYields(null);
    // Trae del servidor el proceso guardado de ese túnel, si existe.
    loadDraftFor(value).catch(() => undefined);
  }

  function addMillingPiladoEntry() {
    const quantityQq = Number(millingPiladoQq);
    if (!Number.isFinite(quantityQq) || quantityQq <= 0) {
      setMessage("Ingrese una cantidad valida para el pilado");
      return;
    }

    setMillingPiladoEntries((current) => {
      const entries = Array.isArray(current) ? current : [];
      return [
      ...entries,
      {
        id: `${Date.now()}-${entries.length}`,
        presentation: millingPiladoPresentation,
        quantityQq
      }
    ];
    });
    setMillingPiladoQq("");
    setMillingYields(null);
    setMessage(`Pilado ${millingPiladoPresentation} agregado`);
  }

  function removeMillingPiladoEntry(entryId: string) {
    setMillingPiladoEntries((current) => (Array.isArray(current) ? current : []).filter((entry) => entry.id !== entryId));
    setMillingYields(null);
  }

  // Guarda el pilado a medias EN EL SERVIDOR (por túnel), para poder
  // retomarlo desde cualquier equipo.
  async function saveMillingProcess() {
    if (!selectedProductionDrying) {
      setMessage("Seleccione la secadora antes de guardar el proceso");
      return;
    }
    await apiPut<{ saved_at: string }>(`/processing-batches/drafts/${productionDryingId}`, {
      report: millingReport,
      pilado_entries: safeMillingPiladoEntries
    });
    await loadMillingDrafts();
    // Al guardar, el formulario SE LIMPIA: el proceso queda a salvo en el
    // servidor y aparece en «Procesos guardados». Solo vuelve al formulario
    // cuando se presiona «Continuar / Finalizar lote».
    setMillingReport(defaultMillingReport);
    setMillingPiladoEntries([]);
    setMillingYields(null);
    setMillingDraftSavedAt(null);
    setProductionDryingId("");
    addToast("Proceso guardado. El formulario quedó limpio: retómalo desde «Procesos guardados» con Continuar / Finalizar lote.", "success");
  }

  async function loadMillingDrafts() {
    const rows = await apiGet<MillingDraft[]>("/processing-batches/drafts").catch(() => [] as MillingDraft[]);
    setMillingDrafts(rows);
  }

  async function loadFinanzas() {
    const qs = `?desde=${finanzasDesde}&hasta=${finanzasHasta}`;
    const [datos, cuentas, activos] = await Promise.all([
      apiGet<FinanzasData>(`/finance/dashboard${qs}`),
      apiGet<CuentaBancaria[]>("/finance/bank/accounts").catch(() => [] as CuentaBancaria[]),
      apiGet<ActivosFijosData>(`/finance/fixed-assets?hasta=${finanzasHasta}&todos=true`).catch(() => null)
    ]);
    setFinanzas(datos);
    setCuentasBanco(cuentas);
    setActivosFijos(activos);
  }

  /** Vida útil sugerida en Ecuador según el tipo de bien. */
  function vidaUtilSugerida(tipo: string | null): number {
    const t = String(tipo ?? "").toUpperCase();
    if (t.includes("VEHICULO") || t.includes("VEHÍCULO") || t.includes("CAMION")) return 5;
    if (t.includes("COMPUTO") || t.includes("CÓMPUTO")) return 3;
    if (t.includes("EDIFICIO") || t.includes("INMUEBLE")) return 20;
    return 10; // maquinaria y equipo
  }

  // Guarda los datos contables de un equipo. Sin costo no hay depreciación
  // posible, así que hasta que no se cargue no entra al balance.
  async function guardarActivoFijo(item: ActivoFijo) {
    const edit = activoEdit[item.id] ?? {
      costo: String(item.costo || ""),
      fecha: item.fecha_compra ? String(item.fecha_compra).slice(0, 10) : "",
      vida: String(item.vida_util || vidaUtilSugerida(item.tipo))
    };
    const costo = Number(edit.costo || 0);
    if (costo > 0 && !edit.fecha) throw new Error("Indica la fecha de compra: sin ella no se puede calcular la depreciación.");
    await apiPut(`/finance/fixed-assets/${item.id}`, {
      acquisition_cost: costo,
      acquisition_date: edit.fecha || undefined,
      useful_life_years: Number(edit.vida || vidaUtilSugerida(item.tipo)),
      salvage_value: 0,
      is_depreciable: true
    });
    addToast(`${item.nombre} actualizado`, "success");
    await loadFinanzas();
  }

  // Carga el extracto pegado del banco y muestra la conciliación al instante.
  async function cargarExtracto() {
    if (!extractoForm.cash_register_id) throw new Error("Elige la cuenta bancaria");
    if (!extractoForm.texto.trim()) throw new Error("Pega el extracto del banco");
    const res = await apiPost<{ statement_id: string; lineas_leidas: number; cruzadas_automatico: number }>(
      "/finance/bank/statements",
      {
        cash_register_id: extractoForm.cash_register_id,
        periodo_desde: finanzasDesde,
        periodo_hasta: finanzasHasta,
        saldo_final: Number(extractoForm.saldo_final || 0),
        texto: extractoForm.texto,
        created_by: authUser?.id
      }
    );
    addToast(`${res.lineas_leidas} línea(s) leídas · ${res.cruzadas_automatico} cruzadas automáticamente`, "success");
    setExtractoForm({ ...extractoForm, texto: "" });
    await verConciliacion(res.statement_id);
  }

  async function verConciliacion(statementId: string) {
    setConciliacion(await apiGet<Conciliacion>(`/finance/bank/statements/${statementId}/reconciliation`));
  }

  // Descarga el libro de Excel con los estados financieros del período.
  async function descargarEstadosExcel() {
    const qs = `?desde=${finanzasDesde}&hasta=${finanzasHasta}`;
    const res = await apiFetch(`/finance/export/excel${qs}`);
    if (!res.ok) throw new Error("No se pudo generar el Excel");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estados-financieros-${finanzasHasta}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    addToast("Estados financieros descargados", "success");
  }

  async function loadProductionHistory() {
    const rows = await apiGet<ProductionHistoryItem[]>("/processing-batches/history").catch(
      () => [] as ProductionHistoryItem[]
    );
    setProductionHistory(rows);
  }

  // Al elegir una secadora, trae su proceso guardado (si lo hay).
  async function loadDraftFor(dryingId: string) {
    if (!dryingId) {
      setMillingReport(defaultMillingReport);
      setMillingPiladoEntries([]);
      setMillingDraftSavedAt(null);
      return;
    }
    const d = await apiGet<MillingDraft | null>(`/processing-batches/drafts/${dryingId}`).catch(() => null);
    if (d) {
      setMillingReport({ ...defaultMillingReport, ...(d.report as Partial<MillingReportState>) });
      setMillingPiladoEntries(Array.isArray(d.pilado_entries) ? d.pilado_entries : []);
      setMillingDraftSavedAt(d.saved_at);
    } else {
      setMillingReport(defaultMillingReport);
      setMillingPiladoEntries([]);
      setMillingDraftSavedAt(null);
    }
  }

  async function finalizeMillingLot() {
    const drying = selectedProductionDrying;
    if (!drying) {
      setMessage("Seleccione la secadora que se esta produciendo");
      return;
    }

    const qqTulas = Number(millingReport.qqTulas || 0);
    if (millingPiladoTotalQq <= 0 && qqTulas <= 0) {
      setMessage("Agregue al menos una cantidad de pilado o QQ de tulas");
      return;
    }

    const inputProduct = drying.rice_type === "CORRIENTE" ? rawProductCorriente : rawProduct011;
    const outputProduct = drying.rice_type === "CORRIENTE" ? whiteRiceCorrienteProduct : whiteRiceProduct;

    if (!inputProduct?.id || !rawWarehouse?.id || !finishedWarehouse?.id || !outputProduct?.id || !broken34Product?.id || !fineBrokenProduct?.id || !branProduct?.id) {
      setMessage("Faltan productos o bodegas base. Presiona Crear datos base en Dashboard.");
      return;
    }

    const totalCascara = Number(drying.total_quintals ?? 0);
    const result = calculateMillingYields(millingReport, millingPiladoTotalQq, totalCascara);
    if (!result) {
      setMessage("La secadora seleccionada no tiene total de cascara valido");
      return;
    }

    const batch = await apiPost<{ id: string }>("/processing-batches", {
      lot_id: drying.lot_id,
      drying_report_id: drying.id,
      process_type: "PILADO",
      ownership: "OWNED",
      input_product_id: inputProduct.id,
      input_warehouse_id: rawWarehouse.id,
      input_quantity: Number(drying.input_weight_kg)
    });

    const whiteRiceQq = millingPiladoTotalQq > 0 ? millingPiladoTotalQq : qqTulas;
    const production = await apiPost<ProductionResult>(`/processing-batches/${batch.id}/finish-production`, {
      lot_id: drying.lot_id,
      drying_report_id: drying.id,
      is_maquila: false,
      input_paddy_kg: Number(drying.input_weight_kg),
      white_rice: {
        product_id: outputProduct.id,
        warehouse_id: finishedWarehouse.id,
        quantity: whiteRiceQq,
        unit: "QQ"
      },
      // Se manda el desglose (100 LB, 25 LB...) y no solo el total, para que en
      // el historial se vea en que presentacion salio cada quintal.
      white_rice_presentations: (Array.isArray(millingPiladoEntries) ? millingPiladoEntries : []).map((entry) => ({
        presentation: entry.presentation,
        sack_weight_lb: sackWeightLbOf(entry.presentation),
        quantity: entry.quantityQq
      })),
      broken_rice: Number(millingReport.broken34 || 0) > 0 ? {
        product_id: broken34Product.id,
        warehouse_id: finishedWarehouse.id,
        quantity: Number(millingReport.broken34 || 0),
        unit: "QQ"
      } : undefined,
      fine_broken_rice: Number(millingReport.fineBroken || 0) > 0 ? {
        product_id: fineBrokenProduct.id,
        warehouse_id: finishedWarehouse.id,
        quantity: Number(millingReport.fineBroken || 0),
        unit: "QQ"
      } : undefined,
      bran: Number(millingReport.polvillo || 0) > 0 ? {
        product_id: branProduct.id,
        warehouse_id: finishedWarehouse.id,
        quantity: Number(millingReport.polvillo || 0),
        unit: "QQ"
      } : undefined,
      sacks_used: 0,
      pilador_name: piladorName || undefined,
      estibador_name: estibadorName || undefined,
      polvillo_worker_name: polvilloWorkerName || undefined,
      tulas: Number(millingReport.tulas || 0),
      qq_de_tulas: Number(millingReport.qqTulas || 0)
    });

    setMillingYields(result);
    setProductionResult(production);
    setMillingPiladoEntries([]);
    setMillingReport(defaultMillingReport);
    // El proceso ya se cerró: se borra el borrador del servidor.
    await apiFetch(`/processing-batches/drafts/${drying.id}`, { method: "DELETE" }).catch(() => undefined);
    setProductionDryingId("");
    setMillingDraftSavedAt(null);
    // Confirmación clara del cobro de pilado creado al finalizar el lote.
    if (production.servicio_pilado) {
      const s = production.servicio_pilado;
      addToast(
        `Cobro de pilado creado: CEYRO cobra ${money(s.total)} por ${s.quintales} QQ` +
        (s.es_accionista ? ` · queda como Por Pagar de ${s.cliente}` : ` · a ${s.cliente} (cliente externo)`),
        "success"
      );
    }
    await loadMillingDrafts();
    await loadProductionHistory();
    setMessage("Lote finalizado: produccion agregada al stock");
    await refresh();
  }

  async function finalizeDryingReport(formElement: HTMLFormElement | null, secadora: string) {
    if (!editingDryingReport || !formElement) return;
    const endInput = formElement.elements.namedItem("dry_end_at") as HTMLInputElement | null;
    if (endInput && !endInput.value) {
      endInput.value = dateTimeLocalValue(new Date().toISOString());
    }
    await submitDryingForm(formElement, secadora);
  }

  // El combustible ya no viaja aquí: se registra por MOTOR en su propio panel
  // y el backend lo reparte entre los secados activos.
  async function submitDryingForm(formElement: HTMLFormElement, secadora: string) {
    const form = new FormData(formElement);
    const payload = {
      rice_type: form.get("rice_type") || "0.11",
      moisture_before: numberOrUndefined(form.get("moisture_before")),
      filled_at: stringOrUndefined(form.get("filled_at")),
      dry_start_at: stringOrUndefined(form.get("dry_start_at")),
      dry_end_at: stringOrUndefined(form.get("dry_end_at")),
      dryer_name: secadora,
      notes: form.get("notes") || undefined
    };

    const editando = editandoEnSecadora(secadora);
    if (editando) {
      const updated = await apiPut<DryingTunnelReport>(`/process-flow/drying/${editando.id}`, payload);
      setMessage(updated.status === "COMPLETED" ? `Secado del Tunel ${updated.tunnel_number} finalizado` : `Secado del Tunel ${updated.tunnel_number} actualizado`);
      setEditingDryingReport(null);
      safeResetForm(formElement);
      await refresh();
      await loadMotorActive();
      if (updated.lots[0]?.lot_id) await loadProcessFlow(updated.lots[0].lot_id);
      return;
    }

    const entryIds = seleccionDe(secadora);
    if (entryIds.length === 0) {
      setMessage(`Agrega ingresos de materia prima a la ${secadora} para formar el lote`);
      return;
    }

    // Aquí nace el lote: el grupo de ingresos que entra al túnel.
    const created = await apiPost<DryingTunnelReport>("/process-flow/drying", {
      entry_ids: entryIds,
      lot_code: String(form.get("lot_code") ?? "").trim() || undefined,
      tunnel_number: tunelDeSecadora(secadora),
      ...payload
    });
    safeResetForm(formElement);
    setDryingSelections((cur) => ({ ...cur, [secadora]: [] }));
    await refresh();
    await loadMotorActive();
    if (created.lots[0]?.lot_id) await loadProcessFlow(created.lots[0].lot_id);
    setMessage(`Lote formado en la ${secadora}; los ingresos usados ya no aparecen disponibles`);
  }

  async function submitProduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const isMaquila = form.get("is_maquila") === "on";
    const drying = selectedProductionDrying;
    if (!drying) {
      setMessage("Seleccione un tunel secado para sacar la produccion");
      return;
    }
    const lotId = drying.lot_id;
    const inputQuantity = Number(drying.input_weight_kg);
    const outputWarehouseId = String(form.get("output_warehouse_id"));

    if (qqAndPoundsToQq(productionPackages.whiteRice) <= 0) {
      setMessage("Ingrese el arroz pilado producido en QQ y libras");
      return;
    }

    if (!whiteRiceProduct?.id || !broken34Product?.id || !fineBrokenProduct?.id || !branProduct?.id) {
      setMessage("Faltan productos base de produccion. Presiona Crear datos base en Dashboard.");
      return;
    }

    const batch = await apiPost<{ id: string }>("/processing-batches", {
      lot_id: lotId,
      drying_report_id: drying.id,
      process_type: "PILADO",
      ownership: isMaquila ? "MAQUILA" : "OWNED",
      input_product_id: form.get("input_product_id"),
      input_warehouse_id: form.get("input_warehouse_id"),
      input_quantity: inputQuantity
    });

    const whiteRice = packagePayload(whiteRiceProduct.id, outputWarehouseId, productionPackages.whiteRice);
    const broken34 = packagePayload(broken34Product.id, outputWarehouseId, productionPackages.broken34);
    const fineBroken = packagePayload(fineBrokenProduct.id, outputWarehouseId, productionPackages.fineBroken);
    const bran = packagePayload(branProduct.id, outputWarehouseId, productionPackages.bran);

    const result = await apiPost<ProductionResult>(`/processing-batches/${batch.id}/finish-production`, {
      lot_id: lotId,
      is_maquila: isMaquila,
      input_paddy_kg: inputQuantity,
      white_rice: whiteRice,
      broken_rice: qqAndPoundsToQq(productionPackages.broken34) > 0 ? broken34 : undefined,
      fine_broken_rice: qqAndPoundsToQq(productionPackages.fineBroken) > 0 ? fineBroken : undefined,
      bran: qqAndPoundsToQq(productionPackages.bran) > 0 ? bran : undefined,
      sacks_used: 0,
      service_rate_per_qq: isMaquila ? Number(form.get("service_rate_per_qq") || 0) : undefined
    });

    setProductionResult(result);
    setProductionPackages(defaultProductionPackages);
    setMessage(
      result.custodyMode
        ? "Maquila cerrada: productos en custodia y cuenta por cobrar creada"
        : "Produccion cerrada: inventario y rendimiento actualizados"
    );
    setProductionDryingId("");
    await refresh();
  }

  // Venta en dos tiempos (preventa): aquí solo se TOMA EL PEDIDO —una promesa,
  // sin mover inventario ni plata—. El cobro y la salida de bodega ocurren al
  // despacharlo desde "Pedidos pendientes".
  async function submitOrderSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    if (saleLineItems.length === 0) {
      setMessage("Agrega al menos una línea de producto");
      return;
    }

    if (!selectedCustomerId) {
      setMessage("Selecciona un cliente");
      return;
    }

    const items = saleLineItems.map(line => {
      const brandProduct = products.find(p => p.id === line.product_id);
      const inventoryProductId = getInventoryProductForBrand(brandProduct?.name || "");
      return {
        product_id: line.product_id,
        presentation_id: line.presentation_id || undefined,
        presentation_name: line.presentation_name || undefined,
        inventory_product_id: inventoryProductId || line.product_id,
        quantity: line.quantity,
        unit_price: line.unit_price
      };
    });

    const pedido = await apiPost<{ order_number: string; total_amount: string | number }>("/orders", {
      customer_id: selectedCustomerId,
      delivery_date: (form.get("delivery_date") as string) || undefined,
      notes: (form.get("order_notes") as string) || undefined,
      created_by: authUser?.id,
      items
    });

    safeResetForm(formElement);
    setSaleLineItems([]);
    setSaleLineForm({ product_id: "", presentation_id: "", quantity: "", unit_price: "" });
    setSelectedCustomerId("");
    setCustomerSearch("");
    setFilteredCustomers([]);
    setSelectedPresentationId("");
    setSaleProductPresentations([]);
    setMessage(`✓ Pedido ${pedido.order_number} tomado: ${money(pedido.total_amount)}`);
    addToast(`Pedido ${pedido.order_number} tomado · ${money(pedido.total_amount)}. Se cobra al despachar.`, "success");
    await refreshCustomersAndSales();
  }

  // Despachar y cobrar: el pedido se convierte en venta real (inventario +
  // caja o crédito) en una sola operación del servidor.
  async function despacharPedido(order: SalesOrder) {
    const metodo = orderPayMethod[order.id] ?? "CASH";
    const registerId = dashboard.current_cash_register?.id;
    if (metodo !== "CREDIT" && !registerId) {
      addToast("Abre una caja para cobrar, o despacha a crédito", "error");
      return;
    }
    if (!finishedWarehouse?.id) {
      addToast("Falta la bodega de producto terminado (Crear datos base en Dashboard)", "error");
      return;
    }
    const ok = window.confirm(
      `¿Despachar el pedido ${order.order_number} de ${order.customer_name} por ${money(Number(order.total_amount))}?\n\n` +
      (metodo === "CREDIT" ? "Queda como CRÉDITO (cuenta por cobrar)." : "Se cobra ahora y entra a la caja abierta.") +
      "\nLa mercadería sale del inventario."
    );
    if (!ok) return;

    const result = await apiPost<{ sale: { sale_number: string } }>(`/orders/${order.id}/deliver`, {
      payment_method: metodo,
      cash_register_id: metodo === "CREDIT" ? undefined : registerId,
      warehouse_id: finishedWarehouse.id,
      created_by: authUser?.id
    });
    addToast(`Pedido ${order.order_number} despachado → venta ${result.sale.sale_number}`, "success");
    await refreshCustomersAndSales();
    await refresh();
    if (registerId) await refreshCaja(registerId);
  }

  /**
   * Trae el pedido al carrito para editarlo. Las líneas vuelven al formulario
   * y al guardar se reemplazan; la cuenta por cobrar se ajusta sola.
   */
  async function editarPedido(order: SalesOrder) {
    const detalle = await apiGet<{ items: Array<{ product_id: string; presentation_id: string | null; presentation_name: string | null; quantity: string | number; unit_price: string | number }>; delivery_date: string | null; notes: string | null; customer_id: string }>(`/orders/${order.id}`);
    setSaleLineItems(detalle.items.map((it, i) => ({
      id: `edit-${i}`,
      product_id: it.product_id,
      presentation_id: it.presentation_id ?? "",
      presentation_name: it.presentation_name ?? "",
      weight_lb: null,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price)
    })));
    setSelectedCustomerId(detalle.customer_id);
    setCustomerSearch(order.customer_name);
    setPedidoEditando(order.id);
    addToast(`Editando ${order.order_number}: ajusta las líneas y guarda`, "success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function guardarEdicionPedido() {
    if (!pedidoEditando) return;
    if (saleLineItems.length === 0) throw new Error("El pedido debe tener al menos una línea");
    const items = saleLineItems.map((line) => {
      const brandProduct = products.find((p) => p.id === line.product_id);
      const inventoryProductId = getInventoryProductForBrand(brandProduct?.name || "");
      return {
        product_id: line.product_id,
        presentation_id: line.presentation_id || undefined,
        presentation_name: line.presentation_name || undefined,
        inventory_product_id: inventoryProductId || line.product_id,
        quantity: line.quantity,
        unit_price: line.unit_price
      };
    });
    const r = await apiPut<{ order_number: string; total_amount: string | number }>(`/orders/${pedidoEditando}`, { items });
    addToast(`Pedido ${r.order_number} actualizado: ${money(Number(r.total_amount))}`, "success");
    cancelarEdicionPedido();
    await refreshCustomersAndSales();
  }

  function cancelarEdicionPedido() {
    setPedidoEditando(null);
    setSaleLineItems([]);
    setSelectedCustomerId("");
    setCustomerSearch("");
    setSaleLineForm({ product_id: "", presentation_id: "", quantity: "", unit_price: "" });
  }

  async function cancelarPedido(order: SalesOrder) {
    if (!window.confirm(`¿Cancelar el pedido ${order.order_number} de ${order.customer_name}?`)) return;
    await apiPost(`/orders/${order.id}/cancel`, {});
    addToast(`Pedido ${order.order_number} cancelado`, "success");
    await refreshCustomersAndSales();
  }

  async function submitStockAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const quantity = Number(form.get("quantity"));

    if (!Number.isFinite(quantity) || quantity === 0) {
      setMessage("Ingrese una cantidad positiva para subir stock o negativa para bajarlo");
      return;
    }

    await apiPost("/inventory/adjustments", {
      product_id: form.get("product_id"),
      warehouse_id: form.get("warehouse_id"),
      quantity,
      ownership: "OWNED",
      notes: form.get("notes") || "Cuadre manual de inventario"
    });

    safeResetForm(formElement);
    setMessage("Cuadre de stock registrado");
    await refresh();
  }

  async function loadNegativeStock() {
    const rows = await apiGet<NegativeStockRow[]>("/inventory/negative-stock");
    setNegativeStock(rows);
    setNegativeStockOpen(true);
  }

  async function submitLiquidations() {
    const validLines = liqLines.filter((l) => l.lot_id && l.price);
    if (!liqFarmerId || validLines.length === 0) {
      setMessage("Seleccione agricultor y al menos un lote con precio");
      return;
    }
    type LiqApiResult = {
      quintals: number; price_per_quintal: number;
      gross_amount: number; advances_discount: number; other_discounts: number; net_amount: number;
    };
    const batchId = safeUUID();
    const resultItems: Array<{
      lot_code: string; rice_type: string | null;
      quintals: number; price_per_quintal: number;
      gross_amount: number; advances_discount: number; other_discounts: number; net_amount: number;
    }> = [];
    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i];
      // line.lot_id guarda el id del INGRESO de materia prima elegido.
      const entry = farmerLots.find((l) => l.id === line.lot_id);
      if (!entry) continue;
      const qq = Number(line.quintals) || Number(entry.quintals ?? 0);
      const result = await apiPost<LiqApiResult>("/liquidations", {
        farmer_id: liqFarmerId,
        weighing_ticket_id: line.lot_id,
        quintals: qq,
        price_per_quintal: Number(line.price),
        other_discounts: i === 0 ? liqDiscountsTotal : 0,
        discount_breakdown: i === 0 ? {
          fomento:     Number(liqDiscounts.fomento     || 0),
          bascula:     Number(liqDiscounts.bascula     || 0),
          flete:       Number(liqDiscounts.flete       || 0),
          cosechadora: Number(liqDiscounts.cosechadora || 0)
        } : undefined,
        batch_id: batchId
      });
      resultItems.push({
        lot_code: entryLabel(entry),
        rice_type: entry.rice_type ?? null,
        quintals: Number(result.quintals),
        price_per_quintal: Number(result.price_per_quintal),
        gross_amount: Number(result.gross_amount),
        advances_discount: Number(result.advances_discount),
        other_discounts: Number(result.other_discounts),
        net_amount: Number(result.net_amount),
      });
    }
    setLiqResult(resultItems);
    setLiqLines([{ lot_id: "", quintals: "", price: "" }]);
    setLiqDiscounts({ fomento: "", bascula: "", flete: "", cosechadora: "" });
    setDiscountsOpen(false);
    setMessage(`${resultItems.length} lote(s) liquidado(s)`);
    await refresh();
  }

  // Comprobante de venta imprimible, con el membrete del negocio (igual que el
  // de liquidación). Antes no había forma de darle un papel al cliente.
  async function printSaleReceipt(saleId: string) {
    type SaleDetail = {
      sale_number: string; customer_name: string | null; total_amount: string | number;
      payment_status: string; created_at: string;
      items: Array<{ product_name: string; quantity: string | number; unit_price: string | number; total: string | number }>;
    };
    const venta = await apiGet<SaleDetail>(`/sales/${saleId}`);
    const fecha = new Date(venta.created_at).toLocaleDateString("es-EC", { year: "numeric", month: "long", day: "numeric" });
    const filas = venta.items.map((it) => `
      <tr>
        <td>${it.product_name}</td>
        <td style="text-align:right">${Number(it.quantity).toFixed(2)}</td>
        <td style="text-align:right">$${Number(it.unit_price).toFixed(2)}</td>
        <td style="text-align:right">$${Number(it.total).toFixed(2)}</td>
      </tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Comprobante de Venta</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:24px 32px}
        .hdr{text-align:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
        .hdr h1{margin:0;font-size:19px;letter-spacing:1px}
        .hdr h2{margin:2px 0;font-size:13px;font-weight:normal}
        .hdr h3{margin:6px 0 0;font-size:15px;letter-spacing:2px;text-transform:uppercase}
        .meta{display:flex;justify-content:space-between;margin-bottom:14px}
        table{width:100%;border-collapse:collapse;margin-bottom:10px}
        th{background:#f0f0f0;padding:6px 8px;text-align:left;border:1px solid #bbb;font-size:12px;text-transform:uppercase}
        td{padding:6px 8px;border:1px solid #ccc}
        .tot{font-weight:700;font-size:15px}
        .tot td{border-top:2px solid #111}
        .sigs{display:flex;justify-content:space-around;margin-top:52px}
        .sig{text-align:center}
        .sig hr{width:180px;border:none;border-top:1px solid #111;margin:0 auto 4px}
        @media print{body{margin:10mm}}
      </style></head><body>
      <div class="hdr">
        <h1>${appSettings.business_name}</h1>
        <h2>${appSettings.business_subtitle}</h2>
        ${appSettings.ruc ? `<h2>RUC: ${appSettings.ruc}</h2>` : ""}
        <h3>Comprobante de Venta</h3>
      </div>
      <div class="meta">
        <div><strong>Cliente:</strong> ${venta.customer_name ?? "Consumidor final"}</div>
        <div><strong>N.º:</strong> ${venta.sale_number} &nbsp; <strong>Fecha:</strong> ${fecha}</div>
      </div>
      <table>
        <thead><tr><th>Producto</th><th style="text-align:right">QQ</th><th style="text-align:right">Precio</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr class="tot"><td colspan="3">TOTAL</td><td style="text-align:right">$${Number(venta.total_amount).toFixed(2)}</td></tr></tfoot>
      </table>
      ${venta.payment_status !== "PAID" ? `<p style="color:#b91c1c;font-weight:700">VENTA A CRÉDITO — saldo pendiente</p>` : ""}
      <div class="sigs">
        <div class="sig"><hr/><span>Cliente</span></div>
        <div class="sig"><hr/><span>Responsable</span></div>
      </div>
      ${appSettings.receipt_footer ? `<p style="text-align:center;margin-top:28px;font-size:11px;color:#666">${appSettings.receipt_footer}</p>` : ""}
    </body></html>`;
    const win = window.open("", "_blank", "width=760,height=620");
    if (!win) { addToast("El navegador bloqueó la ventana de impresión", "error"); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  async function printLiqBatch(b: LiqBatch) {
    // Traer anticipos detallados aplicados a esta liquidación
    type AppliedAdvance = { advance_number: string; concept: string; amount_applied: string | number; issued_at: string };
    let appliedAdvances: AppliedAdvance[] = [];
    try {
      const qs = b.batch_id
        ? `batch_id=${b.batch_id}`
        : `liquidation_ids=${b.key}`;
      appliedAdvances = await apiGet<AppliedAdvance[]>(`/liquidations/applied-advances?${qs}`);
    } catch { /* sin detalle, igual imprime */ }

    const qqTotal = b.lots.reduce((s, l) => s + l.quintals, 0);
    // El NETO se calcula aquí: bruto menos anticipos menos otros descuentos.
    // No se confía en el net_amount guardado porque un anticipo aplicado
    // después de liquidar podía dejarlo desactualizado.
    const advancesSum = appliedAdvances.length > 0
      ? appliedAdvances.reduce((s, a) => s + Number(a.amount_applied), 0)
      : b.advances_total;
    const netoReal = Math.max(0, b.gross_total - advancesSum - b.other_disc_total);
    const fecha = new Date(b.created_at).toLocaleDateString("es-EC", {
      year: "numeric", month: "long", day: "numeric",
    });
    const lotsRows = b.lots.map((l) => `
      <tr>
        <td>${l.lot_code ?? "—"}</td>
        <td>${l.rice_type ?? "—"}</td>
        <td style="text-align:right">${l.quintals.toFixed(2)}</td>
        <td style="text-align:right">$${l.price_per_quintal.toFixed(2)}</td>
        <td style="text-align:right">$${(l.quintals * l.price_per_quintal).toFixed(2)}</td>
      </tr>`).join("");

    // Filas de anticipos individuales
    const advanceRows = appliedAdvances.length > 0
      ? appliedAdvances.map((a) => `
        <tr>
          <td class="lbl disc">${a.advance_number} — ${a.concept}</td>
          <td class="val disc">-$${Number(a.amount_applied).toFixed(2)}</td>
        </tr>`).join("")
      : b.advances_total > 0
        ? `<tr><td class="lbl disc">Desc. Anticipos</td><td class="val disc">-$${b.advances_total.toFixed(2)}</td></tr>`
        : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Comprobante de Liquidación</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:24px 32px}
        .hdr{text-align:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
        .hdr h1{margin:0;font-size:19px;letter-spacing:1px}
        .hdr h2{margin:2px 0;font-size:13px;font-weight:normal}
        .hdr h3{margin:6px 0 0;font-size:15px;letter-spacing:2px;text-transform:uppercase}
        .meta{display:flex;justify-content:space-between;margin-bottom:14px;font-size:13px}
        table{width:100%;border-collapse:collapse;margin-bottom:10px}
        th{background:#f0f0f0;padding:6px 8px;text-align:left;border:1px solid #bbb;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
        td{padding:6px 8px;border:1px solid #ccc;font-size:13px}
        .totals{width:320px;margin-left:auto;border-collapse:collapse}
        .totals td{padding:5px 8px;border:none;font-size:13px}
        .lbl{font-weight:600;text-align:right;padding-right:12px}
        .val{text-align:right}
        .disc{color:#b91c1c}
        .disc-header td{font-size:11px;font-weight:700;text-transform:uppercase;color:#888;padding-top:8px;padding-bottom:2px}
        .total-row td{font-weight:700;font-size:15px;border-top:2px solid #111;padding-top:7px}
        .sigs{display:flex;justify-content:space-around;margin-top:52px}
        .sig{text-align:center}
        .sig hr{width:180px;border:none;border-top:1px solid #111;margin:0 auto 4px}
        .sig span{font-size:12px}
        @media print{body{margin:10mm}}
      </style></head><body>
      <div class="hdr">
        <h1>${appSettings.business_name}</h1>
        <h2>${appSettings.business_subtitle}</h2>
        ${appSettings.ruc ? `<h2>RUC: ${appSettings.ruc}</h2>` : ""}
        ${appSettings.address || appSettings.phone ? `<h2>${[appSettings.address, appSettings.phone && `Telf: ${appSettings.phone}`].filter(Boolean).join(" · ")}</h2>` : ""}
        <h3>Comprobante de Liquidación</h3>
      </div>
      <div class="meta">
        <div><strong>Agricultor:</strong> ${b.farmer_name}</div>
        <div><strong>Fecha:</strong> ${fecha}</div>
      </div>
      <table>
        <thead><tr><th>Lote</th><th>Tipo</th><th style="text-align:right">QQ</th><th style="text-align:right">Precio/QQ</th><th style="text-align:right">Subtotal</th></tr></thead>
        <tbody>${lotsRows}</tbody>
      </table>
      <table class="totals">
        <tr><td class="lbl">Total QQ:</td><td class="val">${qqTotal.toFixed(2)} QQ</td></tr>
        <tr><td class="lbl">Bruto:</td><td class="val">$${b.gross_total.toFixed(2)}</td></tr>
        ${advanceRows.length > 0 ? `<tr class="disc-header"><td colspan="2">Anticipos descontados</td></tr>${advanceRows}` : ""}
        ${b.other_disc_total > 0 ? `
          <tr class="disc-header"><td colspan="2">Otros descuentos</td></tr>
          ${b.discount_breakdown.fomento     > 0 ? `<tr><td class="lbl disc">Fomento:</td><td class="val disc">-$${b.discount_breakdown.fomento.toFixed(2)}</td></tr>` : ""}
          ${b.discount_breakdown.bascula     > 0 ? `<tr><td class="lbl disc">Báscula:</td><td class="val disc">-$${b.discount_breakdown.bascula.toFixed(2)}</td></tr>` : ""}
          ${b.discount_breakdown.flete       > 0 ? `<tr><td class="lbl disc">Flete:</td><td class="val disc">-$${b.discount_breakdown.flete.toFixed(2)}</td></tr>` : ""}
          ${b.discount_breakdown.cosechadora > 0 ? `<tr><td class="lbl disc">Cosechadora:</td><td class="val disc">-$${b.discount_breakdown.cosechadora.toFixed(2)}</td></tr>` : ""}
          ${(b.other_disc_total - b.discount_breakdown.fomento - b.discount_breakdown.bascula - b.discount_breakdown.flete - b.discount_breakdown.cosechadora) > 0.01
            ? `<tr><td class="lbl disc">Otros:</td><td class="val disc">-$${(b.other_disc_total - b.discount_breakdown.fomento - b.discount_breakdown.bascula - b.discount_breakdown.flete - b.discount_breakdown.cosechadora).toFixed(2)}</td></tr>`
            : ""}
        ` : ""}
        <tr class="total-row"><td class="lbl">NETO A PAGAR:</td><td class="val">$${netoReal.toFixed(2)}</td></tr>
      </table>
      <div class="sigs">
        <div class="sig"><hr/><span>Agricultor</span></div>
        <div class="sig"><hr/><span>Responsable</span></div>
      </div>
      ${appSettings.receipt_footer ? `<p style="text-align:center;margin-top:28px;font-size:11px;color:#666">${appSettings.receipt_footer}</p>` : ""}
    </body></html>`;
    const win = window.open("", "_blank", "width=760,height=620");
    if (win) { win.document.write(html); win.document.close(); win.print(); }
  }

  function logout() {
    localStorage.removeItem(authStorageKey);
    setAuthUser(null);
  }

  if (!authUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <>
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">B</span>
          <div>
            <strong>Bascula ERP</strong>
            <small>Piladora de arroz</small>
          </div>
        </div>
        {accionistas.length > 1 && (
          <label className="accionistaSwitcher">
            <span>Accionista</span>
            <select
              value={activeAccionistaId ?? ""}
              onChange={(e) => switchAccionista(e.target.value)}
            >
              {accionistas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.tipo === "MATRIZ" ? " · Planta / Matriz" : " · Socio Operativo"}</option>
              ))}
            </select>
          </label>
        )}
        {(() => {
          const act = accionistas.find((a) => a.id === activeAccionistaId);
          if (!act) return null;
          const esMatriz = act.tipo === "MATRIZ";
          return (
            <div style={{ padding: "0 10px 8px" }}>
              <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: esMatriz ? "#065f46" : "#1e3a8a", color: "#fff" }}>
                {esMatriz ? "🏭 Planta / Matriz" : "🤝 Socio Operativo"}
              </span>
            </div>
          );
        })()}
        <div className="navSearchBox" style={{ padding: "0 10px 8px" }}>
          <input
            type="text"
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
            placeholder="Buscar sección…"
            style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-surface)", color: "inherit" }}
          />
        </div>
        <nav>
          {navGroups
            .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => visibleTabs.includes(tab) && (navSearch.trim() === "" || tab.toLowerCase().includes(navSearch.trim().toLowerCase()))) }))
            .filter((group) => group.tabs.length > 0)
            .map((group) => {
              const collapsed = navSearch.trim() !== "" ? false : collapsedGroups.has(group.label);
              const hasActive = group.tabs.includes(activeTab);
              return (
                <div className={collapsed ? "navSection collapsed" : "navSection"} data-group={group.label} key={group.label}>
                  <button type="button" className="navLabel" onClick={() => toggleGroup(group.label)} aria-expanded={!collapsed}>
                    <span>{group.label}</span>
                    {collapsed && hasActive && <i className="navDot" />}
                    <svg className="navChevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4L5 6.5 7.5 4" /></svg>
                  </button>
                  {!collapsed && group.tabs.map((tab) => (
                    <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => setActiveTab(tab)}>
                      <NavIcon tab={tab} />
                      {tab}
                    </button>
                  ))}
                </div>
              );
            })}
        </nav>
        <div className="sidebarFooter">
          <div className="userBox">
            <span className="userAvatar">
              {authUser.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")}
            </span>
            <div>
              <strong>{authUser.name}</strong>
              <small>{(authUser.role_name ?? "usuario").toLowerCase()}</small>
            </div>
            <button className="logoutBtn" title="Cerrar sesión" onClick={logout}>⏻</button>
          </div>
          <span className={apiOnline ? "apiState on" : "apiState"}>
            <i />
            API {apiOnline ? "conectada" : "sin conexión"}
          </span>
          <small>Bascula ERP · Web Admin</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbarLeft">
            <h1>{activeTab}</h1>
            <p>{loading ? "Actualizando datos…" : message}</p>
          </div>
          <div className="topbarRight">
            <span className="topbarDate">
              {new Date().toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </span>
            <button
              className="btnSecondary"
              onClick={() => refresh().catch((e) => setMessage(e.message))}
              disabled={loading}
            >
              {loading ? "⟳" : "↻"} Actualizar
            </button>
            <span className={apiOnline ? "pill online" : "pill offline"}>
              API {apiOnline ? "conectada" : "sin conexión"}
            </span>
          </div>
        </header>
        <div className="content">

        {activeTab === "Dashboard" && (
          <>
            {canSeePanel && (
              <nav className="cajaSubNav">
                <button type="button" className={dashView === "panel" ? "active" : ""} onClick={() => { setDashView("panel"); if (!panelData) refreshPanel().catch(() => undefined); }}>📊 Panel integral</button>
                <button type="button" className={dashView === "resumen" ? "active" : ""} onClick={() => setDashView("resumen")}>⚡ Resumen rápido</button>
              </nav>
            )}
            {canSeePanel && dashView === "panel" ? (
              panelData ? (
                <PanelIntegral data={panelData} month={panelMonth} onMonth={(m) => { setPanelMonth(m); refreshPanel(m).catch(() => undefined); }} />
              ) : (
                <section className="emptyState"><div className="emptyIcon">📊</div><p>Cargando panel…</p></section>
              )
            ) : (
            <>
            <section className="moduleGrid">
              <Metric title="Agricultores" value={dashboard.active_farmers} icon="👨‍🌾" />
              <Metric title="Tickets hoy" value={dashboard.tickets_today} icon="🎫" accent="accBlue" />
              <Metric title="Stock propio" value={`${dashboard.owned_stock.toFixed(2)} QQ`} icon="🌾" accent="accGreen" />
              <Metric title="Anticipos" value={money(dashboard.pending_advances)} icon="💸" accent="accAmber" />
              <Metric title="Por pagar" value={money(dashboard.pending_payables)} icon="📑" accent="accRed" />
              <Metric title="Ventas hoy" value={money(dashboard.sales_today)} icon="🛒" accent="accGreen" />
              <Metric title="Insumos criticos" value={criticalSupplies.length} icon="⚠️" accent={criticalSupplies.length > 0 ? "accRed" : undefined} />
              <Metric title="Preparacion" value={`${setupScore}/5`} icon="✅" accent="accBlue" />
            </section>
            <section className="setupPanel">
              <div>
                <h2>Preparación operativa</h2>
                <p className="muted">Productos, bodegas, insumos, agricultores y caja habilitan todas las funciones.</p>
                <div className="setupProgress" style={{ marginTop: 8 }}>
                  <div className="setupBar">
                    <div className="setupBarFill" style={{ width: `${(setupScore / 5) * 100}%` }} />
                  </div>
                  <small style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{setupScore} / 5</small>
                </div>
              </div>
              <div className="setupChecks">
                <StatusDot ok={products.length >= 7} label="Productos" />
                <StatusDot ok={warehouses.length >= 2} label="Bodegas" />
                <StatusDot ok={insumos.length > 0} label="Insumos" />
                <StatusDot ok={farmers.length > 0} label="Agricultores" />
                <StatusDot ok={dashboard.current_cash_register !== null} label="Caja" />
              </div>
              <button className="primary" onClick={() => setupMasterData().catch((error) => setMessage(error.message))} disabled={busy}>
                {busy ? "Preparando…" : "Crear datos base"}
              </button>
            </section>
            {criticalSupplies.length > 0 && (
              <section className="alertBox">
                Insumos en nivel critico: {criticalSupplies.map((item) => `${item.nombre} (${Number(item.stock_actual).toFixed(0)})`).join(", ")}
              </section>
            )}
            <section className="workPanel">
              <div>
                <h2>Caja actual</h2>
                <p className="muted">
                  {dashboard.current_cash_register
                    ? (() => {
                        const cash = Number(dashboard.current_cash_register.opening_balance_cash ?? 0);
                        const bank = Number(dashboard.current_cash_register.opening_balance_bank ?? 0);
                        const total = Number(dashboard.current_cash_register.opening_balance);
                        const parts = [
                          cash > 0 && `efectivo ${money(cash)}`,
                          bank > 0 && `banco ${money(bank)}`
                        ].filter(Boolean);
                        return `${dashboard.current_cash_register.name} abierta con ${parts.length ? parts.join(" · ") : money(total)}`;
                      })()
                    : "No hay caja abierta"}
                </p>
              </div>
              <TicketPreview />
            </section>
            </>
            )}
          </>
        )}

        {activeTab === "Bascula" && (
          <>
          <section className="panelGrid">
            <form className="formPanel" onSubmit={(event) => submitWeighing(event).catch((error) => setMessage(error.message))}>
              <h2>Registrar ingreso</h2>
              <Select name="farmer_id" label="Agricultor" rows={farmers.map((f) => [f.id, f.full_name])} />
              <Select name="ownership" label="Tipo" rows={[["OWNED", "Compra"], ["MAQUILA", "Maquila"]]} />
              <label>
                <span>Tipo de arroz</span>
                <select name="rice_type" value={weighingRiceType} onChange={(event) => setWeighingRiceType(event.target.value as "0.11" | "CORRIENTE")}>
                  <option value="0.11">0.11</option>
                  <option value="CORRIENTE">Corriente</option>
                </select>
              </label>
              <Input name="gross_weight" label="Peso bruto kg" type="number" />
              <Input name="tare_weight" label="Tara kg" type="number" />
              <Input name="qualification" label="Calificacion" type="number" />
              <button className="primary">Cerrar ticket</button>
            </form>
            <DataList
              title="Últimos lotes"
              headers={["Lote", "Agricultor", "Tipo", "QQ"]}
              rows={lots.slice(0, 8).map((lot) => [lot.lot_code, lot.farmer_name ?? "—", riceTypeLabel(lot.rice_type), `${Number(lot.quintals ?? 0).toFixed(2)} QQ`])}
            />
            {accionistas.length > 1 && materiaPrimaEntries.length > 0 && (
              <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                <h2>🔁 Corregir el accionista de un ingreso de materia prima</h2>
                <p className="muted">
                  ¿Ingresaste un peso con el accionista equivocado? Aquí salen los ingresos de <strong>todos</strong> los
                  accionistas que todavía no entraron a un lote. Al corregirlo se mueve también su cáscara en el
                  inventario. Si ya está en un lote o ya se liquidó, el sistema te avisa qué hacer.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
                  <input
                    type="search"
                    value={materiaPrimaSearch}
                    onChange={(e) => setMateriaPrimaSearch(e.target.value)}
                    placeholder="Buscar por ticket o agricultor…"
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--c-border)", minWidth: 240, fontSize: 13 }}
                  />
                  <span className="muted">{materiaPrimaFiltrada.length} ingreso(s)</span>
                </div>
                <table className="cajaTable">
                  <thead><tr><th>Ticket</th><th>Agricultor</th><th>Fecha</th><th>QQ</th><th>Accionista</th></tr></thead>
                  <tbody>
                    {materiaPrimaFiltrada.slice(0, 25).map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.numero_bascula ? `#${e.numero_bascula}` : e.ticket_number}</td>
                        <td>{e.farmer_name ?? "—"}</td>
                        <td>{new Date(e.created_at).toLocaleDateString("es-EC")}</td>
                        <td className="num">{Number(e.quintals ?? 0).toFixed(2)}</td>
                        <td>
                          <select
                            value={e.accionista_id ?? ""}
                            onChange={(ev) => corregirAccionistaIngreso(e, ev.target.value).catch((err) => addToast(err.message, "error"))}
                            style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}
                          >
                            <option value="">Sin asignar</option>
                            {accionistas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {accionistas.length > 1 && lots.length > 0 && (
              <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                <h2>Pasar un lote a otro accionista</h2>
                <p className="muted">
                  Se mueve el lote con su inventario, su proceso y sus liquidaciones. Si ya se le pagó algo al agricultor,
                  eso queda como cuenta por cobrar del que entrega y por pagar del que recibe; lo que falte pagarle al
                  agricultor lo asume el que recibe. No se puede si el lote ya tiene ventas.
                </p>
                <table className="cajaTable" style={{ marginTop: 8 }}>
                  <thead><tr><th>Lote</th><th>Agricultor</th><th>Pesos</th><th>QQ</th><th>Estado</th><th>Accionista</th></tr></thead>
                  <tbody>
                    {lots.slice(0, 10).map((lot) => (
                      <tr key={lot.id}>
                        <td style={{ fontWeight: 600 }}>{lot.lot_code}</td>
                        <td>{lot.farmer_name ?? "—"}</td>
                        <td className="num">{lot.entries_count ?? 1}</td>
                        <td className="num">{Number(lot.quintals ?? 0).toFixed(2)}</td>
                        <td><span className="chip info">{lot.status}</span></td>
                        <td>
                          <select
                            value={lot.accionista_id ?? ""}
                            onChange={(e) => changeLotAccionista(lot.id, e.target.value).catch((err) => addToast(err.message, "error"))}
                            style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}
                          >
                            <option value="">Sin asignar</option>
                            {accionistas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="tablePanel">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ marginBottom: 2 }}>📲 Tickets de la app de báscula</h2>
                <p className="muted" style={{ margin: 0 }}>Pesajes que llegan de tu app. Se importan solos; también puedes traerlos al instante.</p>
              </div>
              <button type="button" className="btnSecondary" disabled={basculaImporting} onClick={() => runFirebaseImport()}>
                {basculaImporting ? "Importando…" : "⟳ Importar de báscula"}
              </button>
              <div className="cajaSubNav" style={{ borderBottom: "none" }}>
                {(["pending", "liquidated", "all"] as const).map((f) => (
                  <button key={f} type="button" className={ticketFilter === f ? "active" : ""} onClick={() => { setTicketFilter(f); }}>
                    {f === "pending" ? "Pendientes" : f === "liquidated" ? "Liquidados" : "Todos"}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                placeholder="Buscar ticket, cliente, placa…"
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", minWidth: 220, fontSize: 13 }}
              />
            </div>
            {basculaTickets.length === 0 ? (
              <div className="emptyState"><div className="emptyIcon">📲</div><p>No hay tickets. Importa desde tu app con IMPORTAR-BASCULA.bat.</p></div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="cajaTable" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Ticket</th><th>Fecha</th><th>Cliente</th><th>Placa</th>
                      <th className="num">Bruto</th><th className="num">Tara</th><th className="num">Neto</th>
                      <th>Calidad</th><th className="num">QQ</th>
                      <th>Estado</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {basculaTickets.filter((t) => {
                      const q = ticketSearch.trim().toLowerCase();
                      if (!q) return true;
                      return [t.numero, t.farmer_name, t.placa, t.calidad].some((v) => (v ?? "").toLowerCase().includes(q));
                    }).map((t) => {
                      const linked = !!t.farmer_id;
                      const liquidated = !!t.liquidated_at;
                      return (
                        <tr key={t.id}>
                          <td style={{ fontWeight: 600 }}>#{t.numero ?? "—"}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{t.fecha_app || "—"}</td>
                          <td>{t.farmer_name || "—"}</td>
                          <td>{t.placa || "—"}</td>
                          <td className="num">{Number(t.gross_weight).toFixed(0)}</td>
                          <td className="num">{Number(t.tare_weight).toFixed(0)}</td>
                          <td className="num">{Number(t.net_weight).toFixed(0)}</td>
                          <td>{t.calidad || "—"}</td>
                          <td className="num" style={{ fontWeight: 700 }}>{Number(t.quintals).toFixed(2)}</td>
                          <td>
                            {t.en_espera ? <span className="chip warn" title="La báscula aún espera el segundo pesaje">En espera 2º pesaje</span>
                              : t.weighing_ticket_id ? <span className="chip ok">Ingresado</span>
                              : liquidated ? <span className="chip ok">Liquidado</span>
                              : <span className="chip info">Pendiente</span>}
                          </td>
                          <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                            {!t.en_espera && !t.weighing_ticket_id && !liquidated && linked && (
                              <button type="button" className="btnSecondary" onClick={() => { setLotTicket(t); setLotForm({ rice_type: (t.calidad ?? "").includes("0.11") ? "0.11" : "CORRIENTE", ownership: "OWNED", accionista_id: activeAccionistaId ?? (accionistas[0]?.id ?? ""), product_id: "", warehouse_id: "" }); }}>Ingresar materia prima</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
        )}

        {activeTab === "Secadoras" && (
          <section className="panelGrid">
            {/* ── Selector de motor: el 1 mueve las Secadoras 1 y 2; el 2, la 3 ── */}
            <div className="tablePanel" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>🔧 Motor</h2>
              {([1, 2] as const).map((motor) => (
                <button
                  key={motor}
                  type="button"
                  className={motorActivo === motor ? "primary" : undefined}
                  onClick={() => { setEditingDryingReport(null); setMotorActivo(motor); }}
                >
                  Motor {motor} · {MOTOR_SECADORAS[motor].join(" y ")}
                </button>
              ))}
              <span className="muted">El combustible se registra por motor y se reparte entre sus secadoras según los quintales.</span>
            </div>

            {editingDryingReport ? (
              /* ── Modo edición: las secadoras EN PROCESO del motor (los lotes
                    que dejaste secando) + el combustible, para cerrarlo al final.
                    No se mezclan los secados ya finalizados. ── */
              (() => {
                const enProceso = dryingReports.filter(
                  (r) => motorDeSecadora(r.dryer_name) === motorActivo && r.status !== "COMPLETED"
                );
                // Incluye el que se abrió solo si aún está en proceso. Si ya fue
                // finalizado (por ejemplo, al cerrar el combustible del motor), se
                // quita de la edición para evitar que el formulario siga lleno.
                const lista = editingDryingReport && editingDryingReport.status !== "COMPLETED"
                  ? (enProceso.some((r) => r.id === editingDryingReport!.id)
                    ? enProceso
                    : [editingDryingReport, ...enProceso])
                  : enProceso;
                lista.sort((a, b) => a.tunnel_number - b.tunnel_number);
                return (
                  <div style={{ gridColumn: "1 / -1", display: "grid", gap: 16 }}>
                    <div className="tablePanel" style={{ padding: "8px 12px" }}>
                      <strong>✎ Editando el Motor {motorActivo}</strong>
                      <span className="muted"> · {lista.length} secadora(s) en proceso. Al registrar el combustible abajo se finaliza la corrida.</span>
                    </div>
                    <div className="panelGrid" style={{ gap: 16 }}>
                      {lista.map((rep) => {
                        const secadora = rep.dryer_name ?? `Secadora ${rep.tunnel_number}`;
                        const done = rep.status === "COMPLETED";
                        return (
                          <form
                            key={rep.id}
                            className="formPanel dryingForm"
                            onSubmit={(event) => { event.preventDefault(); guardarSecadoEditado(rep, event.currentTarget, false).catch((error) => setMessage(error.message)); }}
                          >
                            <h3 style={{ marginTop: 0 }}>🌀 {secadora} · Túnel {rep.tunnel_number} {done ? <span className="chip ok">Finalizado</span> : <span className="editBadge">✎ En secado</span>}</h3>
                            <DryingLotSelector selectedLots={rep.lots} editing onRemove={() => undefined} />
                            <div className="totalBox"><span>Peso total</span><strong>{Number(rep.total_quintals ?? 0).toFixed(2)} QQ</strong></div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                              <Select name="rice_type" label="Tipo de arroz" rows={[["0.11", "0.11"], ["CORRIENTE", "Corriente"]]} defaultValue={rep.rice_type ?? "0.11"} />
                              <Input name="filled_at" label="Fecha de llenado" type="date" defaultValue={(rep.filled_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10)} required={false} />
                            </div>
                            <Input name="moisture_before" label="Humedad inicial %" type="number" defaultValue={String(rep.moisture_before ?? 0)} required={false} />
                            <Input name="operator_name" label="Nombre del secador" placeholder="Quien seca este túnel (para la nómina)" defaultValue={rep.operator_name ?? ""} required={false} />
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                              <Input name="dry_start_at" label="Hora secado inicio" type="datetime-local" defaultValue={dateTimeLocalValue(rep.dry_start_at)} required={false} />
                              <Input name="dry_end_at" label="Hora secado final" type="datetime-local" defaultValue={dateTimeLocalValue(rep.dry_end_at)} required={false} />
                            </div>
                            <Input name="notes" label="Observacion" defaultValue={rep.notes ?? "Secado registrado"} required={false} />
                            <div className="buttonRow">
                              <button className="primary">Guardar cambios</button>
                              {!done && (
                                <button
                                  type="button"
                                  className="primary"
                                  style={{ background: "var(--c-success)" }}
                                  onClick={(e) => {
                                    const form = e.currentTarget.closest("form") as HTMLFormElement | null;
                                    if (form) guardarSecadoEditado(rep, form, true).catch((error) => setMessage(error.message));
                                  }}
                                >
                                  ✅ Finalizar este túnel
                                </button>
                              )}
                            </div>
                          </form>
                        );
                      })}
                    </div>

                    {renderFuelFieldset()}
                    <div className="buttonRow">
                      <button type="button" className="primary" onClick={() => cerrarCombustibleMotor().catch((error) => setMessage(error.message))}>
                        ⛽ Registrar combustible y finalizar secado
                      </button>
                      <button type="button" onClick={() => clearDryingForm()}>Volver</button>
                    </div>
                  </div>
                );
              })()
            ) : (
              /* ── Modo crear: TODO el informe del motor en un solo formulario,
                    con el botón de guardar AL FINAL. El combustible va junto. ── */
              <form
                key={`motor-form-${motorActivo}-${motorActiveReports.find((r) => r.dry_start_at)?.dry_start_at ?? ""}`}
                className="formPanel"
                style={{ gridColumn: "1 / -1" }}
                onSubmit={(event) => guardarInformeMotor(event).catch((error) => setMessage(error.message))}
              >
                {/* Hora de inicio ÚNICA del motor: el motor arranca una vez y las
                    dos secadoras comparten esa hora; solo la hora final varía. */}
                <div style={{ marginBottom: 12, padding: "10px 12px", background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
                  <Input
                    name="dry_start_at_motor"
                    label="⏱️ Hora secado inicio (una sola para el motor: es la misma en las dos secadoras)"
                    type="datetime-local"
                    defaultValue={dateTimeLocalValue(motorActiveReports.find((r) => r.dry_start_at)?.dry_start_at)}
                    required={false}
                  />
                  <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                    El motor arranca una sola vez: ambas secadoras comparten esta hora de inicio. Solo la hora final se registra por separado en cada secadora.
                  </p>
                </div>
                <div className="panelGrid" style={{ gap: 16 }}>
                  {MOTOR_SECADORAS[motorActivo].map((secadora) => {
                    const t = tunelDeSecadora(secadora);
                    const ocupadoPor = occupiedTunnels[t];
                    // El túnel ya lo está secando OTRO accionista: se bloquea la
                    // sección para que no se le carguen datos por equivocación.
                    if (ocupadoPor) {
                      return (
                        <div key={secadora} className="dryingForm" style={{ border: "1px solid var(--c-danger)", borderRadius: "var(--r-lg)", padding: 14, background: "#fef2f2", opacity: 0.85 }}>
                          <h3 style={{ marginTop: 0 }}>🌀 {secadora} · Túnel {t} <span className="chip danger">✗ En uso</span></h3>
                          <p style={{ fontSize: 13, margin: "4px 0" }}><strong>OCUPADO POR:</strong> {ocupadoPor}</p>
                          <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}>Finaliza ese secado antes de usar este túnel.</p>
                        </div>
                      );
                    }
                    const lotes = lotesDe(secadora);
                    return (
                      <div key={secadora} className="dryingForm" style={{ border: "1px solid var(--c-border)", borderRadius: "var(--r-lg)", padding: 14 }}>
                        <h3 style={{ marginTop: 0 }}>🌀 {secadora} · Túnel {t}</h3>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                          <Select name={`rice_type_${t}`} label="Tipo de arroz" rows={[["0.11", "0.11"], ["CORRIENTE", "Corriente"]]} defaultValue="0.11" onChange={(e) => setDryingRiceType((cur) => ({ ...cur, [secadora]: e.target.value as "0.11" | "CORRIENTE" }))} />
                          <label>
                            <span>Ingreso de materia prima</span>
                            <select value={dryingEntryPick[secadora] ?? ""} onChange={(event) => setDryingEntryPick((cur) => ({ ...cur, [secadora]: event.target.value }))}>
                              <option value="">Seleccione</option>
                              {entradasLibres
                                .filter((entry) => {
                                  const tipoSeleccionado = dryingRiceType[secadora];
                                  if (!tipoSeleccionado) return true;
                                  return (entry.rice_type ?? "0.11") === tipoSeleccionado;
                                })
                                .map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entryLabel(entry)} - {entry.farmer_name ?? "Sin agricultor"} - {Number(entry.quintals ?? 0).toFixed(2)} QQ{entry.rice_type ? ` · ${entry.rice_type}` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <button type="button" onClick={() => addDryingEntry(secadora)}>Agregar al lote</button>
                        <DryingLotSelector selectedLots={lotes} editing={false} onRemove={(id) => removeDryingEntry(secadora, id)} />
                        <div className="totalBox">
                          <span>Peso total</span>
                          <strong>{qqDe(secadora).toFixed(2)} QQ</strong>
                          <small>{kgDe(secadora).toFixed(2)} kg netos</small>
                        </div>
                        <label>
                          <span>Número de lote <span className="muted">(automático)</span></span>
                          <input name={`lot_code_${t}`} type="text" placeholder="Automático (LT-…)" />
                        </label>
                        <Input name={`filled_at_${t}`} label="Fecha de llenado" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required={false} />
                        <Input name={`moisture_before_${t}`} label="Humedad inicial %" type="number" defaultValue="0" required={false} />
                        <Input name={`secador_name_${t}`} label="Nombre del secador" placeholder="Quien seca este túnel (para la nómina)" defaultValue={getSavedSecadorName(t)} required={false} />
                        <Input name={`dry_end_at_${t}`} label="Hora secado final" type="datetime-local" required={false} />
                        <Input name={`notes_${t}`} label="Observacion" defaultValue="Secado registrado" required={false} />
                      </div>
                    );
                  })}
                </div>

                {/* ── Combustible del motor: parte del mismo informe ── */}
                {renderFuelFieldset()}

                {/* ── UN SOLO botón, al final: guarda todo junto ── */}
                <button className="primary" style={{ width: "100%", padding: 13, fontSize: 16, marginTop: 14 }}>
                  💾 Guardar informe completo del Motor {motorActivo}
                </button>
                <button
                  type="button"
                  className="primary"
                  style={{ width: "100%", padding: 13, fontSize: 16, marginTop: 8, background: "var(--c-success)" }}
                  onClick={() => finalizarSecadoMotor().catch((error) => setMessage(error.message))}
                >
                  ✅ Finalizar secado del Motor {motorActivo}
                </button>
              </form>
            )}

            <DryingReportsPanel reports={dryingReports} onEdit={editDryingReport} />
          </section>
        )}

        {activeTab === "Estados Financieros" && (
          <section className="panelGrid">
            {/* Barra de período + descarga */}
            <div className="tablePanel" style={{ gridColumn: "1 / -1", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ margin: 0 }}><span>Desde</span>
                <input type="date" value={finanzasDesde} onChange={(e) => setFinanzasDesde(e.target.value)} />
              </label>
              <label style={{ margin: 0 }}><span>Hasta</span>
                <input type="date" value={finanzasHasta} onChange={(e) => setFinanzasHasta(e.target.value)} />
              </label>
              <button type="button" onClick={() => loadFinanzas().catch((e) => addToast(e.message, "error"))}>↻ Recalcular</button>
              <button type="button" className="primary" onClick={() => descargarEstadosExcel().catch((e) => addToast(e.message, "error"))}>
                📊 Descargar Excel
              </button>
              <span className="muted">Todo se calcula solo desde compras, ventas, caja, inventario y producción.</span>
            </div>

            {!finanzas ? (
              <div className="emptyState" style={{ gridColumn: "1 / -1" }}><div className="emptyIcon">📊</div><p>Calculando estados financieros…</p></div>
            ) : (
              <>
                {/* KPIs ejecutivos */}
                <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                  <h2>📈 Dashboard financiero</h2>
                  <section className="yieldResults" style={{ marginTop: 8 }}>
                    <Metric title="Total activos" value={money(finanzas.kpis.total_activos)} />
                    <Metric title="Total pasivos" value={money(finanzas.kpis.total_pasivos)} />
                    <Metric title="Patrimonio" value={money(finanzas.kpis.patrimonio)} />
                    <Metric title="Liquidez" value={finanzas.kpis.liquidez.toFixed(2)} />
                    <Metric title="Ventas" value={money(finanzas.kpis.ventas)} />
                    <Metric title="Compras" value={money(finanzas.kpis.compras)} />
                    <Metric title="Utilidad" value={money(finanzas.kpis.utilidad)} />
                    <Metric title="Efectivo" value={money(finanzas.kpis.efectivo)} />
                    <Metric title="Bancos" value={money(finanzas.kpis.bancos)} />
                    <Metric title="Inventario" value={money(finanzas.kpis.inventario)} />
                    <Metric title="Por cobrar" value={money(finanzas.kpis.por_cobrar)} />
                    <Metric title="Por pagar" value={money(finanzas.kpis.por_pagar)} />
                    <Metric title="Flujo neto" value={money(finanzas.kpis.flujo_neto)} />
                  </section>

                  {/* Gráficos: estructura del balance, del resultado y medidores */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginTop: 18 }}>
                    <div>
                      <h3 style={{ fontSize: 13, margin: "0 0 2px" }}>Estructura del activo</h3>
                      <BarrasFinancieras
                        formato={money}
                        datos={[
                          { etiqueta: "Efectivo y bancos", valor: finanzas.kpis.efectivo + finanzas.kpis.bancos, color: "#0d9488" },
                          { etiqueta: "Inventario", valor: finanzas.kpis.inventario, color: "#fbbf24" },
                          { etiqueta: "Cuentas por cobrar", valor: finanzas.kpis.por_cobrar, color: "#60a5fa" },
                          { etiqueta: "Activos fijos (neto)", valor: finanzas.balance.activo.no_corriente.total, color: "#a78bfa" }
                        ]}
                      />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 13, margin: "0 0 2px" }}>Origen del financiamiento</h3>
                      <BarrasFinancieras
                        formato={money}
                        datos={[
                          { etiqueta: "Pasivo (deuda)", valor: finanzas.kpis.total_pasivos, color: "#f472b6" },
                          { etiqueta: "Patrimonio (propio)", valor: finanzas.kpis.patrimonio, color: "#4ade80" }
                        ]}
                      />
                      <h3 style={{ fontSize: 13, margin: "14px 0 2px" }}>Resultado del período</h3>
                      <BarrasFinancieras
                        formato={money}
                        datos={[
                          { etiqueta: "Ingresos", valor: finanzas.resultados.ingresos.total, color: "#16a34a" },
                          { etiqueta: "Costo de ventas", valor: finanzas.resultados.costo_ventas.total, color: "#f59e0b" },
                          { etiqueta: "Gastos operativos", valor: finanzas.resultados.gastos_operativos.total, color: "#ef4444" },
                          { etiqueta: "Utilidad neta", valor: finanzas.resultados.utilidad_neta, color: finanzas.resultados.utilidad_neta >= 0 ? "#0d9488" : "#b91c1c" }
                        ]}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--c-border)" }}>
                    <MedidorIndicador titulo="Liquidez" valor={finanzas.indicadores.liquidez_corriente?.valor ?? 0} meta="> 1.5" ok={finanzas.indicadores.liquidez_corriente?.ok ?? false} />
                    <MedidorIndicador titulo="Prueba ácida" valor={finanzas.indicadores.prueba_acida?.valor ?? 0} meta="> 1.0" ok={finanzas.indicadores.prueba_acida?.ok ?? false} />
                    <MedidorIndicador titulo="Endeudamiento" valor={finanzas.indicadores.endeudamiento_pct?.valor ?? 0} meta="< 60%" ok={finanzas.indicadores.endeudamiento_pct?.ok ?? false} sufijo="%" />
                    <MedidorIndicador titulo="Margen neto" valor={finanzas.indicadores.margen_neto_pct?.valor ?? 0} meta="> 5%" ok={finanzas.indicadores.margen_neto_pct?.ok ?? false} sufijo="%" />
                  </div>
                </div>

                {/* Balance General */}
                <div className="tablePanel">
                  <h2>🏛️ Balance General <span className="muted">al {finanzas.balance.fecha}</span></h2>
                  <table className="cajaTable" style={{ marginTop: 8 }}>
                    <tbody>
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>ACTIVO CORRIENTE</td></tr>
                      <tr><td>Efectivo en caja</td><td className="num">{money(finanzas.balance.activo.corriente.efectivo)}</td></tr>
                      <tr><td>Bancos</td><td className="num">{money(finanzas.balance.activo.corriente.bancos)}</td></tr>
                      <tr><td>Cuentas por cobrar</td><td className="num">{money(finanzas.balance.activo.corriente.cuentas_por_cobrar)}</td></tr>
                      <tr><td>Anticipos a agricultores</td><td className="num">{money(finanzas.balance.activo.corriente.anticipos_agricultores)}</td></tr>
                      <tr>
                        <td>Inventarios
                          <small className="muted" style={{ display: "block" }}>
                            valorizado a ${finanzas.balance.activo.corriente.inventario_detalle.costo_qq_materia_prima}/QQ (costo promedio)
                          </small>
                        </td>
                        <td className="num">{money(finanzas.balance.activo.corriente.inventario)}</td>
                      </tr>
                      <tr style={{ fontWeight: 700 }}><td>Total activo corriente</td><td className="num">{money(finanzas.balance.activo.corriente.total)}</td></tr>
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>ACTIVO NO CORRIENTE</td></tr>
                      <tr><td>Propiedad, planta y equipo</td><td className="num">{money(finanzas.balance.activo.no_corriente.activos_fijos)}</td></tr>
                      <tr><td>(-) Depreciación acumulada</td><td className="num">{money(finanzas.balance.activo.no_corriente.depreciacion_acumulada)}</td></tr>
                      <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>TOTAL ACTIVO</td><td className="num">{money(finanzas.balance.activo.total)}</td></tr>
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>PASIVO</td></tr>
                      <tr><td>Cuentas por pagar</td><td className="num">{money(finanzas.balance.pasivo.corriente.cuentas_por_pagar)}</td></tr>
                      <tr style={{ fontWeight: 700 }}><td>Total pasivo</td><td className="num">{money(finanzas.balance.pasivo.total)}</td></tr>
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>PATRIMONIO</td></tr>
                      <tr><td>Capital social</td><td className="num">{money(finanzas.balance.patrimonio.capital_social)}</td></tr>
                      <tr><td>Resultados acumulados</td><td className="num">{money(finanzas.balance.patrimonio.resultados_acumulados)}</td></tr>
                      <tr><td>Resultado del ejercicio</td><td className="num">{money(finanzas.balance.patrimonio.resultado_ejercicio)}</td></tr>
                      <tr><td>Ajuste de apertura <small className="muted">(antes del sistema)</small></td><td className="num">{money(finanzas.balance.patrimonio.ajuste_apertura)}</td></tr>
                      <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>TOTAL PATRIMONIO</td><td className="num">{money(finanzas.balance.patrimonio.total)}</td></tr>
                    </tbody>
                  </table>
                  <p style={{ marginTop: 8, fontWeight: 700, color: Math.abs(finanzas.balance.cuadre) < 0.01 ? "#15803d" : "#b91c1c" }}>
                    {Math.abs(finanzas.balance.cuadre) < 0.01 ? "✓ Balance cuadrado (Activo = Pasivo + Patrimonio)" : `⚠ Descuadre de ${money(finanzas.balance.cuadre)}`}
                  </p>
                </div>

                {/* Estado de Resultados */}
                <div className="tablePanel">
                  <h2>📑 Estado de Resultados</h2>
                  <table className="cajaTable" style={{ marginTop: 8 }}>
                    <tbody>
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>INGRESOS</td></tr>
                      <tr><td>Ventas</td><td className="num">{money(finanzas.resultados.ingresos.ventas)}</td></tr>
                      <tr><td>Servicio de pilado</td><td className="num">{money(finanzas.resultados.ingresos.servicio_pilado)}</td></tr>
                      <tr style={{ fontWeight: 700 }}><td>Total ingresos</td><td className="num">{money(finanzas.resultados.ingresos.total)}</td></tr>
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>COSTO DE VENTAS</td></tr>
                      <tr><td>Mercadería vendida</td><td className="num">{money(finanzas.resultados.costo_ventas.mercaderia_vendida)}</td></tr>
                      <tr><td>Combustible de secado</td><td className="num">{money(finanzas.resultados.costo_ventas.combustible_secado)}</td></tr>
                      <tr style={{ fontWeight: 700, borderTop: "1px solid var(--c-border)" }}>
                        <td>UTILIDAD BRUTA <small className="muted">({finanzas.resultados.margen_bruto_pct}%)</small></td>
                        <td className="num">{money(finanzas.resultados.utilidad_bruta)}</td>
                      </tr>
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>GASTOS OPERATIVOS</td></tr>
                      <tr><td>Gastos generales</td><td className="num">{money(finanzas.resultados.gastos_operativos.gastos_generales)}</td></tr>
                      <tr><td>Mano de obra</td><td className="num">{money(finanzas.resultados.gastos_operativos.mano_obra)}</td></tr>
                      <tr><td>Depreciación</td><td className="num">{money(finanzas.resultados.gastos_operativos.depreciacion)}</td></tr>
                      <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}>
                        <td>UTILIDAD NETA <small className="muted">({finanzas.resultados.margen_neto_pct}%)</small></td>
                        <td className="num" style={{ color: finanzas.resultados.utilidad_neta >= 0 ? "#15803d" : "#b91c1c" }}>{money(finanzas.resultados.utilidad_neta)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Indicadores */}
                <div className="tablePanel">
                  <h2>🎯 Indicadores financieros</h2>
                  <table className="cajaTable" style={{ marginTop: 8 }}>
                    <thead><tr><th>Indicador</th><th className="num">Valor</th><th>Meta</th><th>Estado</th></tr></thead>
                    <tbody>
                      {Object.entries({
                        liquidez_corriente: "Liquidez corriente",
                        prueba_acida: "Prueba ácida",
                        capital_trabajo: "Capital de trabajo",
                        endeudamiento_pct: "Endeudamiento",
                        margen_bruto_pct: "Margen bruto",
                        margen_neto_pct: "Margen neto",
                        roa_pct: "Rentabilidad del activo",
                        roe_pct: "Rentabilidad del patrimonio"
                      }).map(([clave, etiqueta]) => {
                        const i = finanzas.indicadores[clave];
                        if (!i) return null;
                        const esPct = clave.endsWith("_pct");
                        const esDinero = clave === "capital_trabajo";
                        return (
                          <tr key={clave}>
                            <td>{etiqueta}</td>
                            <td className="num">{esDinero ? money(i.valor) : esPct ? `${i.valor}%` : i.valor.toFixed(2)}</td>
                            <td className="muted">{i.meta}</td>
                            <td><span className={i.ok ? "chip success" : "chip warning"}>{i.ok ? "✓ OK" : "⚠ Revisar"}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Activos fijos y depreciación */}
                {activosFijos && (
                  <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                    <h2>🏭 Activos fijos y depreciación</h2>
                    <p className="muted">
                      Carga el costo y la fecha de compra de cada equipo. Con eso el sistema calcula la depreciación en
                      línea recta, la resta del balance y la lleva al Estado de Resultados. Sin costo, el equipo no entra
                      al balance.
                    </p>
                    {(() => {
                      // Aviso de duplicados: nombres repetidos o con caracteres
                      // dañados confunden al cargar costos (se cargaría dos veces).
                      const vistos = new Map<string, number>();
                      activosFijos.items.forEach((i) => {
                        const clave = i.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s]/g, "").toLowerCase().trim();
                        vistos.set(clave, (vistos.get(clave) ?? 0) + 1);
                      });
                      const dup = [...vistos.entries()].filter(([, n]) => n > 1);
                      const rotos = activosFijos.items.filter((i) => i.nombre.includes("�"));
                      if (!dup.length && !rotos.length) return null;
                      return (
                        <p className="alertBox" style={{ background: "var(--c-warning-bg)", color: "#b45309", padding: "8px 12px", borderRadius: 8 }}>
                          ⚠ Hay equipos repetidos{rotos.length > 0 ? " o con el nombre dañado" : ""}. Revísalos en
                          Configuración antes de cargar costos, o cargarás el mismo bien dos veces.
                        </p>
                      );
                    })()}
                    <table className="cajaTable" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Equipo</th><th>Tipo</th>
                          <th className="num">Costo $</th><th>Fecha compra</th><th className="num">Vida (años)</th>
                          <th className="num">Depr. anual</th><th className="num">Depr. acum.</th><th className="num">Valor libros</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {activosFijos.items.map((item) => {
                          const edit = activoEdit[item.id] ?? {
                            costo: item.costo ? String(item.costo) : "",
                            fecha: item.fecha_compra ? String(item.fecha_compra).slice(0, 10) : "",
                            vida: String(item.vida_util || vidaUtilSugerida(item.tipo))
                          };
                          const set = (campo: "costo" | "fecha" | "vida", valor: string) =>
                            setActivoEdit((cur) => ({ ...cur, [item.id]: { ...edit, [campo]: valor } }));
                          return (
                            <tr key={item.id} style={item.costo > 0 ? undefined : { opacity: 0.75 }}>
                              <td style={{ fontWeight: 600 }}>{item.nombre}</td>
                              <td><span className="chip info">{item.tipo ?? "—"}</span></td>
                              <td><input type="number" step="0.01" min="0" value={edit.costo} placeholder="0.00"
                                onChange={(e) => set("costo", e.target.value)} style={{ width: 110 }} /></td>
                              <td><input type="date" value={edit.fecha}
                                onChange={(e) => set("fecha", e.target.value)} style={{ width: 140 }} /></td>
                              <td><input type="number" min="1" max="50" value={edit.vida}
                                onChange={(e) => set("vida", e.target.value)} style={{ width: 70 }} /></td>
                              <td className="num">{money(item.depreciacion_anual)}</td>
                              <td className="num">{money(item.depreciacion_acumulada)}</td>
                              <td className="num" style={{ fontWeight: 700 }}>{money(item.valor_libros)}</td>
                              <td>
                                <button type="button" onClick={() => guardarActivoFijo(item).catch((e) => addToast(e.message, "error"))}>
                                  Guardar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}>
                          <td colSpan={5}>TOTALES</td>
                          <td className="num">{money(activosFijos.depreciacion_anual)}</td>
                          <td className="num">{money(activosFijos.depreciacion_acumulada)}</td>
                          <td className="num">{money(activosFijos.valor_libros)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Conciliación bancaria */}
                <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                  <h2>🏦 Conciliación bancaria</h2>
                  {cuentasBanco.length === 0 ? (
                    <p className="muted">
                      No hay cuentas de banco. En <strong>Caja</strong>, abre una caja de tipo <strong>🏦 Banco</strong> y
                      aparecerá aquí para conciliarla contra el extracto.
                    </p>
                  ) : (
                    <>
                      <p className="muted">
                        Pega el extracto tal como lo entrega el banco (Excel, CSV o PDF copiado): una línea por
                        movimiento con fecha, descripción y monto. Los egresos con signo menos. El sistema cruza solo
                        lo que coincide en importe y fecha, y te muestra las partidas que explican la diferencia.
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                        <label><span>Cuenta bancaria</span>
                          <select
                            value={extractoForm.cash_register_id}
                            onChange={(e) => setExtractoForm({ ...extractoForm, cash_register_id: e.target.value })}
                          >
                            <option value="">Seleccione</option>
                            {cuentasBanco.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.banco ? `${c.banco} — ` : ""}{c.name} (libros {money(Number(c.saldo_libros))})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label><span>Saldo final según el banco *</span>
                          <input
                            type="number" step="0.01" placeholder="0.00"
                            value={extractoForm.saldo_final}
                            onChange={(e) => setExtractoForm({ ...extractoForm, saldo_final: e.target.value })}
                          />
                        </label>
                      </div>
                      <label>
                        <span>Extracto del banco (período {finanzasDesde} al {finanzasHasta})</span>
                        <textarea
                          rows={6}
                          value={extractoForm.texto}
                          onChange={(e) => setExtractoForm({ ...extractoForm, texto: e.target.value })}
                          placeholder={"15/07/2026  DEPOSITO CLIENTE A     1.200,00\n16/07/2026  PAGO PROVEEDOR B        -450,00\n19/07/2026  COMISION MANTENIMIENTO   -15,50"}
                          style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12.5 }}
                        />
                      </label>
                      <button type="button" className="primary" onClick={() => cargarExtracto().catch((e) => addToast(e.message, "error"))}>
                        🔍 Conciliar
                      </button>
                    </>
                  )}

                  {conciliacion && (
                    <div style={{ marginTop: 16, borderTop: "1px solid var(--c-border)", paddingTop: 12 }}>
                      <h3 style={{ margin: "0 0 4px" }}>
                        {conciliacion.extracto.banco ?? conciliacion.extracto.caja}
                        {conciliacion.extracto.numero_cuenta ? ` · Cta. ${conciliacion.extracto.numero_cuenta}` : ""}
                      </h3>
                      <p className="muted" style={{ marginTop: 0 }}>
                        {conciliacion.extracto.periodo_desde?.slice(0, 10)} al {conciliacion.extracto.periodo_hasta?.slice(0, 10)} ·
                        {" "}{conciliacion.lineas_cruzadas} de {conciliacion.lineas_totales} líneas cruzadas
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
                        <table className="cajaTable">
                          <tbody>
                            <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>SEGÚN LIBROS</td></tr>
                            <tr style={{ fontWeight: 700 }}><td>Saldo en libros</td><td className="num">{money(conciliacion.segun_libros.saldo)}</td></tr>
                            {conciliacion.segun_libros.notas_credito.map((x) => (
                              <tr key={x.id}><td>(+) {x.descripcion}<small className="muted" style={{ display: "block" }}>{x.fecha} · nota de crédito no registrada</small></td><td className="num rowIncome">{money(x.monto)}</td></tr>
                            ))}
                            {conciliacion.segun_libros.notas_debito.map((x) => (
                              <tr key={x.id}><td>(−) {x.descripcion}<small className="muted" style={{ display: "block" }}>{x.fecha} · nota de débito no registrada</small></td><td className="num rowExpense">{money(x.monto)}</td></tr>
                            ))}
                            <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>SALDO AJUSTADO</td><td className="num">{money(conciliacion.segun_libros.saldo_ajustado)}</td></tr>
                          </tbody>
                        </table>
                        <table className="cajaTable">
                          <tbody>
                            <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>SEGÚN BANCO</td></tr>
                            <tr style={{ fontWeight: 700 }}><td>Saldo del extracto</td><td className="num">{money(conciliacion.segun_banco.saldo)}</td></tr>
                            {conciliacion.segun_banco.depositos_transito.map((x) => (
                              <tr key={x.id}><td>(+) {x.descripcion}<small className="muted" style={{ display: "block" }}>{x.fecha} · depósito en tránsito</small></td><td className="num rowIncome">{money(x.monto)}</td></tr>
                            ))}
                            {conciliacion.segun_banco.cheques_no_cobrados.map((x) => (
                              <tr key={x.id}><td>(−) {x.descripcion}<small className="muted" style={{ display: "block" }}>{x.fecha} · girado, no cobrado</small></td><td className="num rowExpense">{money(x.monto)}</td></tr>
                            ))}
                            <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>SALDO AJUSTADO</td><td className="num">{money(conciliacion.segun_banco.saldo_ajustado)}</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <p style={{ marginTop: 10, fontWeight: 800, fontSize: 15, color: conciliacion.conciliado ? "#15803d" : "#b91c1c" }}>
                        {conciliacion.conciliado
                          ? "✓ CUENTA CONCILIADA — ambos saldos ajustados coinciden"
                          : `⚠ DIFERENCIA DE ${money(conciliacion.diferencia)} — revisa las partidas o el saldo del extracto`}
                      </p>
                    </div>
                  )}
                </div>

                {/* Flujo de caja */}
                <div className="tablePanel">
                  <h2>💵 Flujo de caja</h2>
                  <table className="cajaTable" style={{ marginTop: 8 }}>
                    <tbody>
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>ENTRADAS</td></tr>
                      {finanzas.flujo.entradas.length === 0 && <tr><td colSpan={2} className="muted">Sin entradas en el período</td></tr>}
                      {finanzas.flujo.entradas.map((x) => <tr key={`e-${x.concepto}`}><td>{x.concepto}</td><td className="num rowIncome">{money(x.valor)}</td></tr>)}
                      <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>SALIDAS</td></tr>
                      {finanzas.flujo.salidas.length === 0 && <tr><td colSpan={2} className="muted">Sin salidas en el período</td></tr>}
                      {finanzas.flujo.salidas.map((x) => <tr key={`s-${x.concepto}`}><td>{x.concepto}</td><td className="num rowExpense">{money(x.valor)}</td></tr>)}
                      <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>FLUJO NETO</td><td className="num">{money(finanzas.flujo.flujo_neto)}</td></tr>
                      <tr style={{ fontWeight: 700 }}><td>Saldo disponible hoy</td><td className="num">{money(finanzas.flujo.saldo_actual)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {activeTab === "Agricultores" && (
          <section className="panelGrid">
            <form className="formPanel" onSubmit={(event) => submitFarmer(event).catch((error) => setMessage(error.message))}>
              <h2>Nuevo agricultor</h2>
              <Input name="full_name" label="Nombre completo" />
              <Input name="identification" label="Cedula/RUC" />
              <Input name="phone" label="Telefono" />
              {accionistas.length > 0 && (
                <Select
                  name="accionista_id"
                  label="Accionista"
                  rows={accionistas.map((a) => [a.id, a.name])}
                  defaultValue={activeAccionistaId ?? undefined}
                  required={false}
                />
              )}
              <button className="primary">Guardar</button>
            </form>
            <div className="tablePanel">
              <h2>Agricultores registrados</h2>
              {farmers.length === 0 ? (
                <div className="emptyState"><div className="emptyIcon">👨‍🌾</div><p>Sin agricultores registrados</p></div>
              ) : (
                <table className="cajaTable" style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Cédula / RUC</th>
                      <th>Teléfono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {farmers.map((f) => (
                      <tr key={f.id}>
                        <td>{f.full_name}</td>
                        <td>{f.identification ?? "—"}</td>
                        <td>{f.phone ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ marginTop: 10 }}>
                Los agricultores son compartidos: cualquier accionista puede comprarles. Lo que separa la operación es el accionista de cada compra, no el del agricultor.
              </p>
            </div>
          </section>
        )}

        {activeTab === "Inventario" && (
          <section className="panelGrid">
            <div className="formPanel">
              <h2 style={{ marginBottom: 8 }}>Movimientos de inventario (reporte)</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "flex-end" }}>
                <label style={{ margin: 0 }}><span>Desde</span>
                  <input type="date" value={invFilter.from} onChange={(e: any) => setInvFilter({ ...invFilter, from: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Hasta</span>
                  <input type="date" value={invFilter.to} onChange={(e: any) => setInvFilter({ ...invFilter, to: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Movimiento</span>
                  <select value={invFilter.movement} onChange={(e: any) => setInvFilter({ ...invFilter, movement: e.target.value })}>
                    <option value="">Todos</option>
                    <option value="IN">Entrada (IN)</option>
                    <option value="OUT">Salida (OUT)</option>
                    <option value="ADJUSTMENT">Ajuste</option>
                    <option value="PROCESS_INPUT">Consumo proceso</option>
                    <option value="PROCESS_OUTPUT">Salida proceso</option>
                    <option value="REVERSAL">Reversa</option>
                  </select></label>
                <button type="button" onClick={exportInvCsv}>Exportar CSV</button>
                <button type="button" onClick={printInvReport}>Imprimir</button>
              </div>
              {(() => {
                const vis = invMovsFiltered();
                const entradas = vis.filter((m: any) => Number(m.quantity) > 0).reduce((s: number, m: any) => s + Number(m.quantity), 0);
                const salidas = vis.filter((m: any) => Number(m.quantity) < 0).reduce((s: number, m: any) => s + Number(m.quantity), 0);
                return (
                  <>
                    <p style={{ fontWeight: 600, margin: "4px 0" }}>{vis.length} mov. · Entradas: {entradas.toFixed(2)} · Salidas: {salidas.toFixed(2)}</p>
                    {vis.length === 0 && <p className="muted">Sin movimientos</p>}
                    <div className="equipList">
                      {vis.slice(0, 300).map((m: any) => (
                        <div key={m.id} className="equipItem">
                          <div>
                            <strong>{m.product_name}</strong>
                            <small>{(m.created_at || "").slice(0, 10)} · {m.warehouse_name} · {m.movement}{m.reference_type ? " · " + m.reference_type : ""}</small>
                          </div>
                          <strong>{Number(m.quantity).toFixed(2)}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
            <form className="formPanel" onSubmit={(event) => submitStockAdjustment(event).catch((error) => setMessage(error.message))}>
              <h2>Cuadre de stock</h2>
              <Select
                name="product_id"
                label="Producto"
                rows={inventoryAdjustmentProducts.map((product) => [product.id, `${stockGroupLabel(product)} - ${product.name}`])}
              />
              <Select name="warehouse_id" label="Bodega" rows={warehouses.map((warehouse) => [warehouse.id, warehouse.name])} />
              <Input name="quantity" label="Cantidad QQ (+ sube / - baja)" type="number" />
              <Input name="notes" label="Motivo" defaultValue="Cuadre manual de inventario" required={false} />
              <button className="primary">Registrar cuadre</button>
            </form>
            <DataList
              title="Productos"
              headers={["Código", "Nombre", "Tipo", "Unidad"]}
              rows={visibleInventoryProducts.map((p) => [p.code, p.name, p.product_type, p.unit])}
            />
            <DataList
              title="Stock cáscara"
              headers={["Producto", "Bodega", "Cantidad"]}
              rows={rawStockRows.map((row) => [row.product_name, row.warehouse_name, `${Number(row.quantity).toFixed(2)} ${row.unit}`])}
            />
            <DataList
              title="Stock producto terminado"
              headers={["Producto", "Bodega", "Cantidad"]}
              rows={finishedStockRows.map((row) => [row.product_name, row.warehouse_name, `${Number(row.quantity).toFixed(2)} ${row.unit}`])}
            />
            <DataList
              title="Stock subproductos"
              headers={["Producto", "Bodega", "Cantidad"]}
              rows={byproductStockRows.map((row) => [row.product_name, row.warehouse_name, `${Number(row.quantity).toFixed(2)} ${row.unit}`])}
            />
            {otherStockRows.length > 0 && (
              <DataList
                title="Otros stocks"
                headers={["Producto", "Bodega", "Cantidad"]}
                rows={otherStockRows.map((row) => [row.product_name, row.warehouse_name, `${Number(row.quantity).toFixed(2)} ${row.unit}`])}
              />
            )}

            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btnSecondary" onClick={() => loadNegativeStock().catch((e) => addToast(e.message, "error"))}>
                🔍 Diagnóstico de stocks negativos
              </button>
            </div>

            {negativeStockOpen && (
              <div className="modalOverlay" onClick={() => setNegativeStockOpen(false)}>
                <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
                  <h3>Stocks negativos</h3>
                  {negativeStock.length === 0 ? (
                    <p className="muted">No hay stocks negativos para este accionista.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 16 }}>
                      {negativeStock.map((row) => (
                        <div key={`${row.product_id}-${row.warehouse_id}`} style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                            <strong>{row.product_name} ({row.code})</strong>
                            <span style={{ color: "var(--c-danger)", fontWeight: 700 }}>{row.quantity.toFixed(2)} {row.unit}</span>
                          </div>
                          <p className="muted" style={{ marginBottom: 8 }}>{row.warehouse_name} · {row.ownership}</p>
                          <table className="cajaTable" style={{ fontSize: 11 }}>
                            <thead>
                              <tr>
                                <th>Fecha</th>
                                <th>Movimiento</th>
                                <th className="num">Cantidad</th>
                                <th>Origen</th>
                                <th>Notas</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.movements.map((m, i) => (
                                <tr key={i}>
                                  <td>{new Date(m.created_at).toLocaleString("es-EC")}</td>
                                  <td>{m.movement}</td>
                                  <td className="num">{Number(m.quantity).toFixed(2)}</td>
                                  <td>{m.reference_type || "—"}</td>
                                  <td>{m.notes || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="buttonRow" style={{ marginTop: 16 }}>
                    <button type="button" className="primary" onClick={() => window.print()}>Imprimir</button>
                    <button type="button" onClick={() => setNegativeStockOpen(false)}>Cerrar</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Inventario de Sacos ─────────────────────────────────── */}
            <section style={{ gridColumn: "1 / -1", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
              <h3 style={{ marginTop: 0, marginBottom: 14 }}>📦 Inventario de Sacos</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginBottom: 14 }}>
                {sackInventory.map(s => (
                  <div key={s.id} style={{
                    background: Number(s.stock) <= 10 ? "#fef2f2" : "#f0fdf4",
                    border: `1px solid ${Number(s.stock) <= 10 ? "#fecaca" : "#bbf7d0"}`,
                    borderRadius: 8, padding: "10px", textAlign: "center"
                  }}>
                    <div style={{ fontSize: 11, color: "var(--c-muted)", fontWeight: 600, marginBottom: 4 }}>{s.tipo}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: Number(s.stock) <= 10 ? "#dc2626" : "#16a34a" }}>
                      {Number(s.stock)}
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={submitSackMovement} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end", background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Tipo
                  <select required value={sackMovForm.sack_id} onChange={e => setSackMovForm(p => ({ ...p, sack_id: e.target.value }))}
                    style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3, fontSize: 12 }}>
                    <option value="">— Seleccionar —</option>
                    {sackInventory.map(s => (<option key={s.id} value={s.id}>{s.tipo} ({Number(s.stock)})</option>))}
                  </select>
                </label>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Movimiento
                  <select value={sackMovForm.movement} onChange={e => setSackMovForm(p => ({ ...p, movement: e.target.value as "ENTRADA"|"SALIDA" }))}
                    style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3, fontSize: 12 }}>
                    <option value="ENTRADA">⬇ ENTRADA</option>
                    <option value="SALIDA">⬆ SALIDA</option>
                  </select>
                </label>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Cantidad
                  <input required type="number" min="1" step="1" value={sackMovForm.cantidad}
                    onChange={e => setSackMovForm(p => ({ ...p, cantidad: e.target.value }))}
                    style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3, fontSize: 12 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Concepto
                  <input value={sackMovForm.concepto}
                    onChange={e => setSackMovForm(p => ({ ...p, concepto: e.target.value }))}
                    style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3, fontSize: 12 }}
                    placeholder="Compra / Uso..." />
                </label>
                <button type="submit" style={{ padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 700,
                  background: sackMovForm.movement === "ENTRADA" ? "var(--c-brand)" : "#dc2626", color: "#fff", fontSize: 12 }}>
                  Registrar
                </button>
              </form>
            </section>

            {/* ── Clientes ──────────────────────────────────────────────── */}
            <section style={{ gridColumn: "1 / -1", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>👥 Clientes</h3>
              <form onSubmit={submitNewCustomer} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end", marginBottom: 14, background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Nombre
                  <input required value={newCustomerForm.full_name} onChange={e => setNewCustomerForm(p => ({...p, full_name: e.target.value}))}
                    style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3, fontSize: 12 }}
                    placeholder="Nombre del cliente" />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Teléfono
                  <input value={newCustomerForm.phone} onChange={e => setNewCustomerForm(p => ({...p, phone: e.target.value}))}
                    style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3, fontSize: 12 }}
                    placeholder="+593..." />
                </label>
                <select value={newCustomerForm.customer_type} onChange={e => setNewCustomerForm(p => ({...p, customer_type: e.target.value as "NATURAL"|"EMPRESA"}))}
                  style={{ padding: "7px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                  <option value="NATURAL">Natural</option>
                  <option value="EMPRESA">Empresa</option>
                </select>
                <button type="submit" style={{ padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 700,
                  background: "var(--c-brand)", color: "#fff", fontSize: 12 }}>
                  + Agregar
                </button>
              </form>
              {customers.length > 0 && (
                <DataList
                  title="Lista de clientes"
                  headers={["Nombre", "Teléfono", "Tipo"]}
                  rows={customers.map(c => [c.full_name, c.phone ?? "—", c.customer_type === "NATURAL" ? "Persona" : "Empresa"])}
                />
              )}
            </section>
          </section>
        )}

        {activeTab === "Produccion" && (
          <section className="productionModuleGrid">
            <div className="formPanel" style={{ gridColumn: "1 / -1" }}>
              <h2 style={{ marginBottom: 4 }}>🏭 Costo operativo por corrida (Planta / CEYRO)</h2>
              <p className="muted">Registra el costo real de operar una corrida (luz, mantenimiento, mano de obra, combustible, desgaste, otros) para saber el costo por QQ producido.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                <label style={{ margin: 0 }}><span>Corrida (opcional)</span>
                  <select value={costoForm.processing_batch_id} onChange={(e) => {
                    const id = e.target.value;
                    const b = costoBatches.find((x: any) => x.id === id);
                    setCostoForm({ ...costoForm, processing_batch_id: id, qq_producidos: b && b.qq_producidos ? String(b.qq_producidos) : costoForm.qq_producidos });
                  }}>
                    <option value="">— Sin ligar / manual —</option>
                    {costoBatches.map((b: any) => (
                      <option key={b.id} value={b.id}>{(b.created_at || "").slice(0, 10)} · {Number(b.qq_producidos).toFixed(2)} QQ · {b.status}</option>
                    ))}
                  </select>
                </label>
                <label style={{ margin: 0 }}><span>Fecha</span>
                  <input type="date" value={costoForm.fecha} onChange={(e) => setCostoForm({ ...costoForm, fecha: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>QQ producidos</span>
                  <input type="number" step="0.01" min="0" value={costoForm.qq_producidos} onChange={(e) => setCostoForm({ ...costoForm, qq_producidos: e.target.value })} style={{ width: 110 }} /></label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
                <label style={{ margin: 0 }}><span>Luz</span><input type="number" step="0.01" min="0" value={costoForm.luz} onChange={(e) => setCostoForm({ ...costoForm, luz: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Mantenimiento</span><input type="number" step="0.01" min="0" value={costoForm.mantenimiento} onChange={(e) => setCostoForm({ ...costoForm, mantenimiento: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Mano de obra</span><input type="number" step="0.01" min="0" value={costoForm.mano_obra} onChange={(e) => setCostoForm({ ...costoForm, mano_obra: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Combustible</span><input type="number" step="0.01" min="0" value={costoForm.combustible} onChange={(e) => setCostoForm({ ...costoForm, combustible: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Desgaste</span><input type="number" step="0.01" min="0" value={costoForm.desgaste} onChange={(e) => setCostoForm({ ...costoForm, desgaste: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Otros</span><input type="number" step="0.01" min="0" value={costoForm.otros} onChange={(e) => setCostoForm({ ...costoForm, otros: e.target.value })} /></label>
              </div>
              {(() => {
                const total = costoFormTotal();
                const qq = parseFloat(costoForm.qq_producidos) || 0;
                return <p style={{ fontWeight: 700, margin: "8px 0" }}>Costo total: ${total.toFixed(2)}{qq > 0 && ` · Costo por QQ: $${(total / qq).toFixed(2)}`}</p>;
              })()}
              <button type="button" className="primary" onClick={submitCosto}>Registrar costo</button>
              <hr className="divider" />
              <h2 style={{ marginBottom: 0 }}>Costos registrados</h2>
              {costos.length === 0 && <p className="muted">Sin costos registrados.</p>}
              <div className="equipList">
                {costos.map((c: any) => (
                  <div key={c.id} className="equipItem">
                    <div>
                      <strong>{(c.fecha || "").slice(0, 10)} · {Number(c.qq_producidos).toFixed(2)} QQ</strong>
                      <small>Luz {Number(c.luz).toFixed(0)} · Mant {Number(c.mantenimiento).toFixed(0)} · M.obra {Number(c.mano_obra).toFixed(0)} · Comb {Number(c.combustible).toFixed(0)} · Desg {Number(c.desgaste).toFixed(0)} · Otros {Number(c.otros).toFixed(0)}</small>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong>${Number(c.costo_total).toFixed(2)}</strong>
                      <small>${Number(c.costo_por_qq).toFixed(2)}/QQ</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {millingDrafts.length > 0 && (
              <div id="procesos-guardados" className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                <h2>📋 Procesos guardados (en curso)</h2>
                <p className="muted">Pilados guardados sin finalizar. Se guardan en el servidor, así que puedes seguirlos desde cualquier equipo.</p>
                <table className="cajaTable" style={{ marginTop: 8 }}>
                  <thead><tr><th>Lote</th><th>Túnel</th><th>Tipo</th><th className="num">QQ</th><th>Guardado</th><th>Estado</th><th /></tr></thead>
                  <tbody>
                    {millingDrafts.map((d) => (
                      <tr key={d.drying_report_id}>
                        <td style={{ fontWeight: 600 }}>{d.lot_code ?? "—"}</td>
                        <td>Túnel {d.tunnel_number}</td>
                        <td>{d.rice_type === "CORRIENTE" ? "Corriente" : "0.11"}</td>
                        <td className="num">{Number(d.total_quintals ?? 0).toFixed(2)}</td>
                        <td className="muted">{new Date(d.saved_at).toLocaleString("es-EC")}</td>
                        <td>
                          {d.has_open_batch ? (
                            <span className="chip warn" title="El lote quedó abierto; presiona Continuar para cerrarlo">Abierto</span>
                          ) : (
                            <span className="chip info">Guardado</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button type="button" className="btnSecondary"
                            onClick={() => updateProductionDryingId(d.drying_report_id)}>
                            Continuar / Finalizar lote
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <section className="formPanel productionQuickCard">
              <h2>Secadora en produccion</h2>
              <label>
                <span>Secadora desde Secadoras</span>
                <select value={productionDryingId} onChange={(event) => updateProductionDryingId(event.target.value)} required>
                  <option value="">Seleccione</option>
                  {productionDryingReports.map((report) => (
                    <option key={report.id} value={report.id}>
                      Secadora {report.tunnel_number} - {report.rice_type === "CORRIENTE" ? "Corriente" : "0.11"} - {Number(report.total_quintals ?? 0).toFixed(2)} QQ
                    </option>
                  ))}
                </select>
              </label>
              {selectedProductionDrying ? (
                <div className="totalBox dryerTotalBox">
                  <span>Total cascara desde Secadoras</span>
                  <strong>{Number(selectedProductionDrying.total_quintals ?? 0).toFixed(2)} QQ</strong>
                  <small>Secadora {selectedProductionDrying.tunnel_number} - {selectedProductionDrying.lots.length} lote(s)</small>
                  <small>{selectedProductionDrying.lots.map((lot) => `${lot.farmer_name ?? "Sin agricultor"} (${Number(lot.quintals ?? 0).toFixed(2)} QQ)`).join(" + ")}</small>
                </div>
              ) : (
                <div className="muted" style={{ padding: 10, background: "#fef3c7", borderRadius: 8, border: "1px solid #fde68a" }}>
                  <strong>No hay secadoras finalizadas sin procesar.</strong>
                  <p style={{ margin: "4px 0 0" }}>
                    Ve a la pestaña <strong>Secadoras</strong>, finaliza un secado y vuelve aquí. Si ya guardaste un proceso,
                    aparecerá arriba en <strong>Procesos guardados</strong>; presiona <em>Continuar / Finalizar lote</em>.
                  </p>
                </div>
              )}
            </section>

            <section className="formPanel productionQuickCard">
              <h2>Reporte de pilado</h2>

              {/* Pilador, Estibador y N.º de tulas */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12, padding: "10px 12px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                <label style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 700, display: "block", marginBottom: 3 }}>👷 Pilador</span>
                  <input value={piladorName} onChange={e => setPiladorName(e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
                    placeholder="Nombre del pilador" />
                </label>
                <label style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 700, display: "block", marginBottom: 3 }}>🧱 Estibador</span>
                  <input value={estibadorName} onChange={e => setEstibadorName(e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
                    placeholder="Nombre del estibador" />
                </label>
                <label style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 700, display: "block", marginBottom: 3 }}>🟤 Encargado de llenar polvillo</span>
                  <input value={polvilloWorkerName} onChange={e => setPolvilloWorkerName(e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
                    placeholder="Nombre del encargado" />
                </label>
                <label style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 700, display: "block", marginBottom: 3 }}>📦 N.º de tulas</span>
                  <input type="number" min="0" step="1" value={millingReport.tulas}
                    onChange={e => setMillingReport(p => ({ ...p, tulas: e.target.value }))}
                    style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
                    placeholder="Ej: 6" />
                </label>
                <label style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 700, display: "block", marginBottom: 3 }}>⚖️ Total QQ de tulas</span>
                  <input type="number" min="0" step="0.01" value={millingReport.qqTulas}
                    onChange={e => setMillingReport(p => ({ ...p, qqTulas: e.target.value }))}
                    style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
                    placeholder="Ej: 12.50" />
                </label>
              </div>
              <div className="millingPiladoBuilder">
                <label>
                  <span>Pilado (QQ)</span>
                  <select value={millingPiladoPresentation} onChange={(event) => setMillingPiladoPresentation(event.target.value)}>
                    {piladoPresentations.map((presentation) => (
                      <option key={presentation} value={presentation}>
                        {presentation}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Cantidad en QQ</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={millingPiladoQq}
                    onChange={(event) => setMillingPiladoQq(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <button className="addLineButton" type="button" onClick={addMillingPiladoEntry}>
                  <span>+</span> Añadir
                </button>
              </div>
              <section className="millingEntryList">
                {millingPiladoEntries.length === 0 && <p className="muted">Agrega una o varias presentaciones de pilado.</p>}
                {millingPiladoEntries.map((entry) => (
                  <div className="dryerEntryRow" key={entry.id}>
                    <strong>{entry.presentation}</strong>
                    <span>{entry.quantityQq.toFixed(2)} QQ</span>
                    <button type="button" onClick={() => removeMillingPiladoEntry(entry.id)}>
                      Quitar
                    </button>
                  </div>
                ))}
              </section>
              <div className="totalBox" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
                <span>⚖️ TOTAL QQ DE TULAS</span>
                <strong>{Number(millingReport.qqTulas || 0).toFixed(2)} QQ</strong>
                <small>Independiente de las presentaciones; base para pagar al pilador</small>
              </div>

              <div className="totalBox">
                <span>🌾 TOTAL ARROZ PILADO</span>
                <strong>{millingPiladoTotalQq.toFixed(2)} QQ</strong>
                <small>Suma de las presentaciones (10 LB, 25 LB, 50 LB, etc.)</small>
              </div>

              <div className="productionSackGrid">
                <ControlledNumberInput label="Arrocillo 3/4" value={millingReport.broken34} onChange={(value) => updateMillingField("broken34", value)} />
                <ControlledNumberInput label="Arrocillo Fino" value={millingReport.fineBroken} onChange={(value) => updateMillingField("fineBroken", value)} />
                <ControlledNumberInput label="Polvillo" value={millingReport.polvillo} onChange={(value) => updateMillingField("polvillo", value)} />
              </div>
              {/* Pago por llenado de polvillo: OCULTO a petición. El pago se sigue
                  registrando en Nómina (backend) con el rol Polvillo; solo no se
                  muestra el cálculo aquí. */}

              <div className="buttonRow">
                <button type="button" onClick={() => saveMillingProcess().catch((e) => addToast(e.message, "error"))} disabled={!selectedProductionDrying}>
                  Guardar Proceso
                </button>
                <button className="primary" type="button" onClick={() => finalizeMillingLot().catch((error) => setMessage(error.message))} disabled={!selectedProductionDrying}>
                  Finalizar Lote
                </button>
              </div>
              <p className="muted">
                Guardar Proceso deja el pilado a medias en «Procesos guardados» y limpia el formulario; para seguir editándolo presiona «Continuar / Finalizar lote». Finalizar Lote agrega la produccion al stock.
              </p>
              {millingDraftSavedAt && <p className="muted">💾 Guardado en el servidor: {new Date(millingDraftSavedAt).toLocaleString("es-EC")}</p>}

              {millingYields && (
                <section className="yieldResults">
                  <Metric title="Rend. Pilado" value={formatYield(millingYields.pilado)} />
                  <Metric title="Rend. Arrocillo" value={formatYield(millingYields.arrocillo)} />
                  <Metric title="Rend. Polvillo" value={formatYield(millingYields.polvillo)} />
                </section>
              )}
            </section>

            {/* Historial de pilados cerrados. Plegado por defecto para no tapar
                la pantalla de trabajo. */}
            <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
              <button
                type="button"
                onClick={() => setProductionHistoryOpen((open) => !open)}
                style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", color: "inherit"
                }}
              >
                <h2 style={{ margin: 0 }}>📚 Historial de produccion ({productionHistory.length})</h2>
                <span className="muted">{productionHistoryOpen ? "▲ Ocultar" : "▼ Ver"}</span>
              </button>

              {productionHistoryOpen && (
                productionHistory.length === 0 ? (
                  <p className="tableEmpty">Todavia no hay pilados cerrados para este accionista.</p>
                ) : (
                  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                    {productionHistory.map((item) => (
                      <article key={item.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: 12 }}>
                        <header style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "baseline" }}>
                          <div>
                            {item.is_service ? (
                              <>
                                <span className="chip warn">Servicio de pilado</span>
                                <strong style={{ marginLeft: 8 }}>{item.client_name ?? "Cliente"}</strong>
                                <span className="muted"> · {Number(item.white_rice_qty ?? 0).toFixed(2)} QQ</span>
                              </>
                            ) : (
                              <>
                                <strong>{item.lot_code}</strong>
                                <span className="muted">
                                  {item.tunnel_number ? ` · Tunel ${item.tunnel_number}` : ""}
                                  {item.rice_type ? ` · ${item.rice_type}` : ""}
                                </span>
                              </>
                            )}
                          </div>
                          <span className="muted">{new Date(item.finished_at).toLocaleString("es-EC")}</span>
                        </header>

                        {item.is_service ? (
                          <section className="yieldResults" style={{ marginTop: 8 }}>
                            <Metric title="QQ pilados" value={`${Number(item.white_rice_qty ?? 0).toFixed(2)} QQ`} />
                            <Metric title="Tarifa" value={`$${Number(item.service_rate ?? 0).toFixed(2)}/QQ`} />
                            <Metric title="Total" value={money(Number(item.service_total ?? 0))} />
                          </section>
                        ) : (
                          <section className="yieldResults" style={{ marginTop: 8 }}>
                            <Metric title="Rendimiento" value={`${Number(item.yield_percent ?? 0).toFixed(2)} %`} />
                            <Metric title="Pilado" value={`${Number(item.white_rice_qty ?? 0).toFixed(2)} QQ`} />
                            <Metric title="Arrocillo 3/4" value={`${Number(item.broken_rice_qty ?? 0).toFixed(2)} QQ`} />
                            <Metric title="Arrocillo fino" value={`${Number(item.fine_broken_rice_qty ?? 0).toFixed(2)} QQ`} />
                            <Metric title="Polvillo" value={`${Number(item.bran_qty ?? 0).toFixed(2)} QQ`} />
                            {/* "Pago polvillo" oculto a petición: el pago sigue
                                registrándose en Nómina, solo no se muestra aquí. */}
                          </section>
                        )}

                        {(item.pilador_name || item.estibador_name || item.polvillo_worker_name) && (
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            Pilador: {item.pilador_name ?? "—"} · Estibador: {item.estibador_name ?? "—"} · Polvillo: {item.polvillo_worker_name ?? "—"}
                          </p>
                        )}

                        {!item.is_service && (
                          <p style={{ margin: "10px 0 0" }}>
                            <span className="muted">Presentaciones: </span>
                            {item.presentaciones.every((p) => !p.presentation) ? (
                              <span className="muted">sin desglose (se guardo solo el total)</span>
                            ) : (
                              item.presentaciones
                                .filter((p) => p.presentation)
                                .map((p, index, lista) => (
                                  <span key={`${item.id}-${index}`}>
                                    <strong>{Number(p.quantity).toFixed(2)} QQ</strong> en {p.presentation}
                                    {index < lista.length - 1 ? " · " : ""}
                                  </span>
                                ))
                            )}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                )
              )}
            </div>

          </section>
        )}

        {activeTab === "Ventas" && (
          <section className="panelGrid">
            {/* Formulario de venta */}
            {showQuickNewCustomer && (
              <div className="modalOverlay" onClick={() => { setShowQuickNewCustomer(false); setQuickNewCustomerForm({ full_name: "", phone: "" }); }}>
                <div className="modalCard" onClick={(e) => e.stopPropagation()}>
                  <h3>Nuevo cliente rápido</h3>
                  <label>
                    <span>Nombre *</span>
                    <input
                      type="text"
                      placeholder="Ej: Juan García"
                      value={quickNewCustomerForm.full_name}
                      onChange={(e) => setQuickNewCustomerForm({ ...quickNewCustomerForm, full_name: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Teléfono</span>
                    <input
                      type="text"
                      placeholder="0987654321"
                      value={quickNewCustomerForm.phone}
                      onChange={(e) => setQuickNewCustomerForm({ ...quickNewCustomerForm, phone: e.target.value })}
                    />
                  </label>
                  <div className="buttonRow">
                    <button type="button" className="primary" onClick={submitQuickNewCustomer}>
                      Crear cliente
                    </button>
                    <button type="button" onClick={() => { setShowQuickNewCustomer(false); setQuickNewCustomerForm({ full_name: "", phone: "" }); }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SECCIÓN 1: Cliente */}
            <div className="formPanel stepPanel stepInfo" style={{ gridColumn: "1 / -1" }}>
              <h2 style={{ marginTop: 0 }}><span className="stepBadge">1</span>Cliente</h2>
              <label>
                <span>Busca cliente o crea uno nuevo</span>
                <div style={{ position: "relative", display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Busca por nombre o teléfono..."
                    value={customerSearch}
                    onChange={(e) => handleCustomerSearch(e.target.value)}
                    style={{ flex: 1, padding: 8, border: "1px solid #d1d5db", borderRadius: 4 }}
                  />
                  <button type="button" onClick={() => setShowQuickNewCustomer(true)} style={{ padding: "8px 12px", background: "#059669", color: "white", border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                    + Nuevo
                  </button>
                </div>
                {filteredCustomers.length > 0 && (
                  <div style={{ border: "1px solid #d1d5db", borderRadius: 4, marginTop: 4, maxHeight: 150, overflowY: "auto" }}>
                    {filteredCustomers.map((c) => (
                      <button key={c.id} type="button" onClick={() => { setSelectedCustomerId(c.id); setCustomerSearch(c.full_name); setFilteredCustomers([]); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "white", border: "none", borderBottom: "1px solid #e5e7eb", cursor: "pointer", fontSize: 13 }}>
                        {c.full_name} {c.phone ? `(${c.phone})` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </label>
              {selectedCustomerId && (
                <div style={{ padding: 10, background: "#dcfce7", borderRadius: 6, marginTop: 8, fontSize: 13, fontWeight: 600, color: "#16a34a" }}>
                  ✓ {customers.find(c => c.id === selectedCustomerId)?.full_name} seleccionado
                </div>
              )}
            </div>

            {/* SECCIÓN 2: Agregar líneas de pedido */}
            <div className="formPanel stepPanel stepWarn" style={{ gridColumn: "1 / -1" }}>
              <h2 style={{ marginTop: 0 }}><span className="stepBadge">2</span>Agregar productos al pedido</h2>

              {/* FILA 1: Marca y Presentación lado a lado */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <label>
                  <span>Marca / Producto *</span>
                  <select
                    value={saleLineForm.product_id}
                    onChange={(e) => handleSaleLineProductChange(e.target.value)}
                    style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13 }}
                  >
                    <option value="">Selecciona marca</option>
                    <option value="" disabled>━━━ MARCAS ━━━</option>
                    {['Flor', 'Oso', 'Lira Verde', 'Lira Azul', 'Conejo'].map(brandName => {
                      const prod = products.find(p => p.name === brandName);
                      return prod ? <option key={prod.id} value={prod.id}>{prod.name}</option> : null;
                    })}
                    <option value="" disabled>━━━ ARROCILLOS ━━━</option>
                    {['Arrocillo 3/4', 'Arrocillo Fino', 'Polvillo / Afrecho'].map(brandName => {
                      const prod = products.find(p => p.name === brandName);
                      return prod ? <option key={prod.id} value={prod.id}>{prod.name}</option> : null;
                    })}
                    {/* Productos vendibles nuevos: aparecen solos, sin tocar código. */}
                    {(() => {
                      const yaListados = new Set(['Flor', 'Oso', 'Lira Verde', 'Lira Azul', 'Conejo', 'Arrocillo 3/4', 'Arrocillo Fino', 'Polvillo / Afrecho']);
                      const otros = products.filter(p =>
                        !yaListados.has(p.name) &&
                        (p.product_type === "FINISHED_GOOD" || p.product_type === "BYPRODUCT") &&
                        !String(p.code || "").startsWith("ARROZ-PILADO") &&
                        !String(p.code || "").startsWith("CASCARA")
                      );
                      return otros.length ? (
                        <>
                          <option value="" disabled>━━━ OTROS ━━━</option>
                          {otros.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </>
                      ) : null;
                    })()}
                  </select>
                  {saleLineForm.product_id && (() => {
                    const disponible = stockDisponibleDeMarca(saleLineForm.product_id);
                    return (
                      <small style={{ marginTop: 4, fontWeight: 700, color: disponible !== null && disponible > 0 ? "#15803d" : "#b91c1c" }}>
                        {disponible !== null && disponible > 0
                          ? `📦 Disponible: ${disponible.toFixed(2)} QQ`
                          : "⚠ Sin stock de este producto"}
                      </small>
                    );
                  })()}
                </label>

                <label>
                  <span>Presentación *</span>
                  <select
                    value={saleLineForm.presentation_id}
                    onChange={(e) => setSaleLineForm({...saleLineForm, presentation_id: e.target.value})}
                    style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13 }}
                    disabled={saleProductPresentations.length === 0}
                  >
                    <option value="">Selecciona presentación</option>
                    {saleProductPresentations.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              {/* FILA 2: Cantidad y Precio */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                <label>
                  <span>Cantidad *</span>
                  <input
                    type="number"
                    placeholder="0"
                    value={saleLineForm.quantity}
                    onChange={(e) => setSaleLineForm({...saleLineForm, quantity: e.target.value})}
                    style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4 }}
                    min="0"
                    step="0.01"
                  />
                </label>

                <label>
                  <span>Precio $ (manual) *</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={saleLineForm.unit_price}
                    onChange={(e) => setSaleLineForm({...saleLineForm, unit_price: e.target.value})}
                    style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4 }}
                    min="0"
                    step="0.01"
                  />
                </label>

                <button
                  type="button"
                  onClick={addSaleLineItem}
                  style={{ padding: "8px 12px", background: "#f59e0b", color: "white", border: "none", borderRadius: 4, fontWeight: 700, cursor: "pointer", alignSelf: "flex-end", fontSize: 13 }}
                >
                  ➕ Agregar
                </button>
              </div>
            </div>

            {/* SECCIÓN 3: Líneas agregadas (carrito) */}
            {saleLineItems.length > 0 && (
              <div className="formPanel stepPanel" style={{ gridColumn: "1 / -1" }}>
                <h2 style={{ marginTop: 0 }}><span className="stepBadge">3</span>Líneas del pedido ({saleLineItems.length})</h2>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#6b7280", color: "#fff" }}>
                        <th style={{ padding: "8px 10px", textAlign: "left" }}>Marca</th>
                        <th style={{ padding: "8px 10px", textAlign: "left" }}>Presentación</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Sacos</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>QQ</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Precio $</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Subtotal $</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // QQ acumulados por producto de inventario, para avisar
                        // AQUÍ si el pedido supera el stock (no al guardar).
                        const pedidoPorProducto = new Map<string, number>();
                        return saleLineItems.map((item, i) => {
                          const product = products.find(p => p.id === item.product_id);
                          const inventoryId = getInventoryProductForBrand(product?.name || "") || item.product_id;
                          const qq = qqDeLinea(item);
                          const acumulado = (pedidoPorProducto.get(inventoryId) ?? 0) + qq;
                          pedidoPorProducto.set(inventoryId, acumulado);
                          const disponible = stockDisponibleDeMarca(item.product_id);
                          const excede = disponible !== null && acumulado > disponible + 0.001;
                          const subtotal = item.quantity * item.unit_price;
                          return (
                            <tr key={item.id} style={{ background: excede ? "#fee2e2" : i % 2 === 0 ? "#fff" : "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                              <td style={{ padding: "8px 10px" }}>
                                <strong>{product?.name}</strong>
                                {excede && <small style={{ display: "block", color: "#b91c1c", fontWeight: 700 }}>⚠ Supera el stock ({(disponible ?? 0).toFixed(2)} QQ disponibles)</small>}
                              </td>
                              <td style={{ padding: "8px 10px" }}>{item.presentation_name || "—"}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right" }}>{item.quantity}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right" }}>{qq.toFixed(2)}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right" }}>${item.unit_price.toFixed(2)}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>${subtotal.toFixed(2)}</td>
                              <td style={{ padding: "8px 10px", textAlign: "center" }}>
                                <button
                                  type="button"
                                  onClick={() => removeSaleLineItem(item.id)}
                                  style={{ padding: "4px 8px", background: "#ef4444", color: "white", border: "none", borderRadius: 3, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                                >
                                  Eliminar
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#f0fdf4", fontWeight: 800 }}>
                        <td colSpan={2} style={{ padding: "8px 10px" }}>TOTAL</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{saleLineItems.reduce((s, l) => s + l.quantity, 0)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{saleLineItems.reduce((s, l) => s + qqDeLinea(l), 0).toFixed(2)}</td>
                        <td />
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#15803d" }}>${calculateSaleTotal().toFixed(2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* SECCIÓN 4: Guardar el pedido (preventa: se cobra al despachar) */}
            <form className="formPanel stepPanel stepSuccess" onSubmit={(event) => submitOrderSale(event).catch((error) => setMessage(error.message))} style={{ gridColumn: "1 / -1" }}>
              <h2 style={{ marginTop: 0 }}><span className="stepBadge">4</span>Guardar pedido</h2>
              <p className="muted" style={{ marginTop: -4 }}>
                El pedido es la promesa al cliente: no mueve inventario ni plata. El cobro y la salida de
                bodega ocurren al <strong>despacharlo</strong> desde «Pedidos pendientes».
              </p>

              <div className="totalBox" style={{ background: "#dcfce7", padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14 }}>TOTAL DEL PEDIDO</span>
                <strong style={{ fontSize: 28, color: "#16a34a" }}>${calculateSaleTotal().toFixed(2)}</strong>
                <small style={{ color: "#6b7280" }}>Suma de todos los subtotales</small>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                <Input name="delivery_date" label="Fecha de entrega" type="date" required={false} />
                <Input name="order_notes" label="Nota (opcional)" required={false} />
              </div>

              {pedidoEditando ? (
                <div className="buttonRow">
                  <button type="button" className="primary" style={{ flex: 1, padding: 12, fontSize: 15 }}
                    onClick={() => guardarEdicionPedido().catch((e) => addToast(e.message, "error"))}>
                    💾 GUARDAR CAMBIOS DEL PEDIDO
                  </button>
                  <button type="button" onClick={cancelarEdicionPedido}>Cancelar edición</button>
                </div>
              ) : (
                <button className="primary" style={{ width: "100%", padding: 12, fontSize: 16 }}>
                  📋 TOMAR PEDIDO
                </button>
              )}
            </form>

            {/* Pedidos pendientes: aquí se despacha y cobra */}
            {salesOrders.some((o) => o.status === "PENDING") && (
              <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                <h2>🚚 Pedidos pendientes ({salesOrders.filter((o) => o.status === "PENDING").length})</h2>
                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                  {salesOrders.filter((o) => o.status === "PENDING").map((o) => (
                    <article key={o.id} style={{ border: "1px solid var(--c-border)", borderLeft: "4px solid var(--c-warning)", borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                        <div>
                          <strong>{o.order_number}</strong> · {o.customer_name}
                          {o.delivery_date && <span className="muted"> · entrega {new Date(o.delivery_date + "T12:00:00").toLocaleDateString("es-EC")}</span>}
                        </div>
                        <strong style={{ color: "#b45309" }}>{money(Number(o.total_amount))}</strong>
                      </div>
                      <div className="muted" style={{ fontSize: 12.5, margin: "4px 0 8px" }}>
                        {o.items.map((it) => `${it.product_name}${it.presentation_name ? ` ${it.presentation_name}` : ""} × ${Number(it.quantity)}`).join(" · ")}
                        {o.notes ? ` — ${o.notes}` : ""}
                        <span style={{ display: "block", color: "#b45309", fontWeight: 700, marginTop: 2 }}>
                          Ya figura en Por Cobrar aunque no se haya despachado
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <select
                          value={orderPayMethod[o.id] ?? "CASH"}
                          onChange={(e) => setOrderPayMethod((cur) => ({ ...cur, [o.id]: e.target.value }))}
                          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--c-border)", fontSize: 12.5 }}
                        >
                          <option value="CASH">💵 Efectivo</option>
                          <option value="TRANSFER">📱 Transferencia</option>
                          <option value="CARD">💳 Tarjeta</option>
                          <option value="CHECK">✓ Cheque</option>
                          <option value="CREDIT">📋 Crédito</option>
                        </select>
                        <button type="button" className="primary" onClick={() => despacharPedido(o).catch((e) => addToast(e.message, "error"))}>
                          🚚 Despachar y cobrar
                        </button>
                        <button type="button" onClick={() => editarPedido(o).catch((e) => addToast(e.message, "error"))}>
                          ✎ Editar
                        </button>
                        <button type="button" onClick={() => cancelarPedido(o).catch((e) => addToast(e.message, "error"))}>
                          ✕ Cancelar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {/* Historial de ventas */}
            {sales.length > 0 && (
              <div style={{ gridColumn: "1 / -1", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
                <h3 style={{ marginTop: 0, marginBottom: 12 }}>📊 Ventas realizadas</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "var(--c-brand)", color: "#fff" }}>
                        <th style={{ padding: "6px 10px", textAlign: "left" }}>Número</th>
                        <th style={{ padding: "6px 10px", textAlign: "left" }}>Cliente</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Monto</th>
                        <th style={{ padding: "6px 10px", textAlign: "left" }}>Pago</th>
                        <th style={{ padding: "6px 10px", textAlign: "left" }}>Fecha</th>
                        <th style={{ padding: "6px 10px", textAlign: "center" }}>Recibo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.map((s, i) => (
                        <tr key={s.id} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                          <td style={{ padding: "5px 10px" }}><strong>{s.sale_number}</strong></td>
                          <td style={{ padding: "5px 10px" }}>{s.customer_name ?? "Sin cliente"}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700 }}>${Number(s.total_amount).toFixed(2)}</td>
                          <td style={{ padding: "5px 10px" }}>
                            <span style={{
                              padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                              background: s.payment_status === "PAID" ? "#dcfce7" : "#fef3c7",
                              color: s.payment_status === "PAID" ? "#16a34a" : "#92400e"
                            }}>
                              {s.payment_status === "PAID" ? "✓ Pagado" : s.payment_status === "PARTIAL" ? "⏳ Parcial" : "📋 Pendiente"}
                            </span>
                          </td>
                          <td style={{ padding: "5px 10px" }}>{new Date(s.created_at).toLocaleDateString("es-EC")}</td>
                          <td style={{ padding: "5px 10px", textAlign: "center" }}>
                            <button type="button" title="Imprimir comprobante" onClick={() => printSaleReceipt(s.id).catch((e) => addToast(e.message, "error"))}
                              style={{ padding: "3px 10px", fontSize: 13, cursor: "pointer" }}>
                              🖨
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Las cuentas por cobrar se administran en la pestaña "Por Cobrar" (grupo Cuentas). */}
          </section>
        )}

        {activeTab === "Compras" && (
          <div>
            {/* ── Registrar compra ── */}
            <div className="formPanel" style={{ marginBottom: 16 }}>
              <h2>🛒 Registrar compra</h2>
              <label><span>Proveedor *</span>
                <select value={purchaseForm.supplier_id}
                  onChange={(e: any) => setPurchaseForm({ ...purchaseForm, supplier_id: e.target.value })}>
                  <option value="">— Selecciona —</option>
                  {suppliers.filter((s) => s.is_active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label><span>Tipo de pago</span>
                <select value={purchaseForm.payment_type}
                  onChange={(e: any) => setPurchaseForm({ ...purchaseForm, payment_type: e.target.value })}>
                  <option value="CASH">Contado (paga de caja)</option>
                  <option value="CREDIT">Credito (cuenta por pagar)</option>
                </select>
              </label>
              {purchaseForm.payment_type === "CASH" ? (
                <p className="muted">
                  {dashboard.current_cash_register?.id ? "Se registrara el gasto en la caja abierta." : "⚠️ No hay caja abierta; abre una para comprar a contado."}
                </p>
              ) : (
                <label><span>Vencimiento (opcional)</span>
                  <input type="date" value={purchaseForm.due_date}
                    onChange={(e: any) => setPurchaseForm({ ...purchaseForm, due_date: e.target.value })} />
                </label>
              )}
              <label><span>N° factura (opcional)</span>
                <input type="text" value={purchaseForm.invoice_number}
                  onChange={(e: any) => setPurchaseForm({ ...purchaseForm, invoice_number: e.target.value })} />
              </label>
              <label><span>Notas (opcional)</span>
                <input type="text" value={purchaseForm.notes}
                  onChange={(e: any) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} />
              </label>

              <h3 style={{ marginBottom: 6 }}>Items</h3>
              {purchaseItems.map((it, idx) => (
                <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <select value={it.item_type}
                    onChange={(e: any) => updatePurchaseItem(idx, { item_type: e.target.value, insumo_id: "", product_id: "", warehouse_id: "" })}>
                    <option value="INSUMO">Insumo</option>
                    <option value="PRODUCT">Producto</option>
                  </select>
                  {it.item_type === "INSUMO" ? (
                    <select value={it.insumo_id} onChange={(e: any) => updatePurchaseItem(idx, { insumo_id: e.target.value })}>
                      <option value="">— Insumo —</option>
                      {insumos.map((i) => (<option key={i.id} value={i.id}>{i.nombre}</option>))}
                    </select>
                  ) : (
                    <>
                      <select value={it.product_id} onChange={(e: any) => updatePurchaseItem(idx, { product_id: e.target.value })}>
                        <option value="">— Producto —</option>
                        {products.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.product_type})</option>))}
                      </select>
                      <select value={it.warehouse_id} onChange={(e: any) => updatePurchaseItem(idx, { warehouse_id: e.target.value })}>
                        <option value="">— Bodega —</option>
                        {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.name} ({w.type})</option>))}
                      </select>
                    </>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="number" step="0.001" min="0" placeholder="Cantidad" value={it.quantity}
                      onChange={(e: any) => updatePurchaseItem(idx, { quantity: e.target.value })} style={{ flex: 1 }} />
                    <input type="number" step="0.0001" min="0" placeholder="Precio unit." value={it.unit_price}
                      onChange={(e: any) => updatePurchaseItem(idx, { unit_price: e.target.value })} style={{ flex: 1 }} />
                    {purchaseItems.length > 1 && (
                      <button type="button" className="equipDelBtn" onClick={() => removePurchaseItem(idx)}>✕</button>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" onClick={addPurchaseItem} style={{ marginBottom: 8 }}>+ Agregar item</button>
              <p style={{ fontWeight: 600 }}>Total: ${purchaseTotal().toFixed(2)}</p>
              <button type="button" className="primary" onClick={submitPurchase}>Registrar compra</button>
            </div>

            {/* ── Compras (reporte) ── */}
            <div className="formPanel" style={{ marginBottom: 16 }}>
              <h2 style={{ marginBottom: 8 }}>Compras (reporte)</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "flex-end" }}>
                <label style={{ margin: 0 }}><span>Desde</span>
                  <input type="date" value={purchaseFilter.from} onChange={(e: any) => setPurchaseFilter({ ...purchaseFilter, from: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Hasta</span>
                  <input type="date" value={purchaseFilter.to} onChange={(e: any) => setPurchaseFilter({ ...purchaseFilter, to: e.target.value })} /></label>
                <label style={{ margin: 0 }}><span>Proveedor</span>
                  <select value={purchaseFilter.supplier_id} onChange={(e: any) => setPurchaseFilter({ ...purchaseFilter, supplier_id: e.target.value })}>
                    <option value="">Todos</option>
                    {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select></label>
                <label style={{ margin: 0 }}><span>Pago</span>
                  <select value={purchaseFilter.payment_type} onChange={(e: any) => setPurchaseFilter({ ...purchaseFilter, payment_type: e.target.value })}>
                    <option value="">Todos</option>
                    <option value="CASH">Contado</option>
                    <option value="CREDIT">Credito</option>
                  </select></label>
                <button type="button" onClick={exportPurchCsv}>Exportar CSV</button>
                <button type="button" onClick={printPurchReport}>Imprimir</button>
              </div>
              {(() => {
                const vis = purchasesFiltered();
                const total = vis.reduce((s: number, c: any) => s + Number(c.total_amount || 0), 0);
                return (
                  <>
                    <p style={{ fontWeight: 600, margin: "4px 0" }}>{vis.length} compras · Total: ${total.toFixed(2)}</p>
                    {vis.length === 0 && <p className="muted">Sin compras</p>}
                    <div className="equipList">
                      {vis.map((c: any) => (
                        <div key={c.id} className="equipItem">
                          <div>
                            <strong>{c.purchase_number} — {c.supplier_name}</strong>
                            <small>{(c.purchase_date || "").slice(0, 10)} · {c.payment_type === "CASH" ? "Contado" : "Credito"} · {c.status}</small>
                          </div>
                          <strong>${Number(c.total_amount).toFixed(2)}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* ── Catalogo de proveedores (existente) ── */}
            <div className="maintLayout">
              <div className="formPanel">
                <h2>🏷️ Nuevo proveedor</h2>
              <label><span>Nombre *</span>
                <input type="text" value={supplierForm.name}
                  onChange={(e: any) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  placeholder="Razon social o nombre" />
              </label>
              <label><span>Identificacion (RUC/Cedula)</span>
                <input type="text" value={supplierForm.identification}
                  onChange={(e: any) => setSupplierForm({ ...supplierForm, identification: e.target.value })} />
              </label>
              <label><span>Telefono</span>
                <input type="text" value={supplierForm.phone}
                  onChange={(e: any) => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
              </label>
              <label><span>Email</span>
                <input type="email" value={supplierForm.email}
                  onChange={(e: any) => setSupplierForm({ ...supplierForm, email: e.target.value })} />
              </label>
              <label><span>Direccion</span>
                <input type="text" value={supplierForm.address}
                  onChange={(e: any) => setSupplierForm({ ...supplierForm, address: e.target.value })} />
              </label>
              <label><span>Notas</span>
                <input type="text" value={supplierForm.notes}
                  onChange={(e: any) => setSupplierForm({ ...supplierForm, notes: e.target.value })} />
              </label>
              <button type="button" className="primary" onClick={submitNewSupplier}>Agregar proveedor</button>
            </div>

            <div className="formPanel">
              <h2 style={{ marginBottom: 0 }}>Proveedores</h2>
              {suppliers.length === 0 && <p className="muted">Sin proveedores aun</p>}
              <div className="equipList">
                {suppliers.map((s) => (
                  <div key={s.id} className="equipItem" style={{ opacity: s.is_active ? 1 : 0.5 }}>
                    {editingSupplierId === s.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
                        <input type="text" value={supplierEdit.name}
                          onChange={(e: any) => setSupplierEdit({ ...supplierEdit, name: e.target.value })} placeholder="Nombre" />
                        <input type="text" value={supplierEdit.identification}
                          onChange={(e: any) => setSupplierEdit({ ...supplierEdit, identification: e.target.value })} placeholder="RUC/Cedula" />
                        <input type="text" value={supplierEdit.phone}
                          onChange={(e: any) => setSupplierEdit({ ...supplierEdit, phone: e.target.value })} placeholder="Telefono" />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" className="primary" onClick={() => saveSupplierEdit(s.id)}>Guardar</button>
                          <button type="button" onClick={() => setEditingSupplierId(null)}>Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <strong>{s.name}</strong>
                          <small>{[s.identification, s.phone].filter(Boolean).join(" · ") || "—"}{s.is_active ? "" : " · inactivo"}</small>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" onClick={() => startEditSupplier(s)}>Editar</button>
                          <button type="button" className="equipDelBtn" onClick={() => toggleSupplierActive(s)}>
                            {s.is_active ? "Desactivar" : "Reactivar"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          </div>
        )}

        {activeTab === "Caja" && (
          <section className="cajaLayout">
            {/* ── Sin caja abierta ── */}
            {!dashboard.current_cash_register && (
              <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20, maxWidth: 600, margin: "40px auto", width: "100%" }}>
                <div className="emptyState">
                  <div className="emptyIcon">💼</div>
                  <h2>No hay caja abierta</h2>
                  <p>Abre una caja para comenzar a registrar movimientos de dinero</p>
                </div>
                <form className="formPanel" onSubmit={(event) => submitCash(event).catch((error) => addToast(error.message, "error"))} style={{ padding: 24 }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Abrir caja nueva</h3>
                  <Input name="name" label="Nombre de la caja" value={newCajaName} onChange={(e) => setNewCajaName(e.target.value)} />
                  <Select
                    name="tipo"
                    label="Tipo"
                    rows={[["EFECTIVO", "💵 Efectivo"], ["BANCO", "🏦 Banco"]]}
                    value={newCajaTipo}
                    onChange={(e) => {
                      const tipo = e.target.value as "EFECTIVO" | "BANCO";
                      setNewCajaTipo(tipo);
                      loadPreviousBalance(tipo).catch(() => undefined);
                    }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <Input name="opening_balance_cash" label="Saldo inicial efectivo $" type="number" value={newCajaCash} onChange={(e) => setNewCajaCash(e.target.value)} />
                    <Input name="opening_balance_bank" label="Saldo inicial banco $" type="number" value={newCajaBank} onChange={(e) => setNewCajaBank(e.target.value)} />
                  </div>
                  <button type="button" className="btnSecondary" onClick={() => loadPreviousBalance(newCajaTipo).catch(() => undefined)}>
                    🔄 Traer saldo anterior ({newCajaTipo === "EFECTIVO" ? "efectivo" : "banco"})
                  </button>
                  <button className="primary" style={{ width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 700 }}>💰 Abrir caja</button>
                </form>
              </section>
            )}

            {/* ── Con caja abierta ── */}
            {dashboard.current_cash_register && (
              <>
                {/* Header profesional */}
                <div style={{ background: "linear-gradient(135deg, #1f2937 0%, #111827 100%)", color: "white", padding: "24px", borderRadius: "10px", marginBottom: 24, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                    <div>
                      <h2 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700 }}>💰 {dashboard.current_cash_register.name}</h2>
                      <p style={{ margin: 0, color: "#d1d5db", fontSize: 12 }}>Sesión activa | {new Date().toLocaleDateString("es-EC")}</p>
                    </div>
                    <button type="button" style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 }} onClick={() => closeCaja().catch((e) => addToast(e.message, "error"))}>
                      ✕ Cerrar caja
                    </button>
                  </div>

                  {/* Métricas principales */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
                    <div style={{ background: "rgba(255,255,255,0.1)", padding: "14px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)" }}>
                      <div style={{ color: "#9ca3af", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>SALDO ACTUAL</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{money(cashSummary?.current_balance ?? Number(dashboard.current_cash_register.opening_balance))}</div>
                    </div>
                    <div style={{ background: "rgba(16, 185, 129, 0.15)", padding: "14px 16px", borderRadius: 8, border: "1px solid #10b98130" }}>
                      <div style={{ color: "#10b981", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>INGRESOS</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#10b981" }}>+{money(cashSummary?.total_income ?? 0)}</div>
                    </div>
                    <div style={{ background: "rgba(239, 68, 68, 0.15)", padding: "14px 16px", borderRadius: 8, border: "1px solid #ef444430" }}>
                      <div style={{ color: "#ef4444", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>EGRESOS</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444" }}>-{money(cashSummary?.total_expense ?? 0)}</div>
                    </div>
                    <div style={{ background: "rgba(59, 130, 246, 0.15)", padding: "14px 16px", borderRadius: 8, border: "1px solid #3b82f630" }}>
                      <div style={{ color: "#3b82f6", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>SALDO INICIAL EFECTIVO</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#3b82f6" }}>{money(Number(dashboard.current_cash_register.opening_balance_cash ?? 0))}</div>
                    </div>
                    <div style={{ background: "rgba(59, 130, 246, 0.15)", padding: "14px 16px", borderRadius: 8, border: "1px solid #3b82f630" }}>
                      <div style={{ color: "#3b82f6", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>SALDO INICIAL BANCO</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#3b82f6" }}>{money(Number(dashboard.current_cash_register.opening_balance_bank ?? 0))}</div>
                    </div>
                    <div style={{ background: "rgba(59, 130, 246, 0.15)", padding: "14px 16px", borderRadius: 8, border: "1px solid #3b82f630" }}>
                      <div style={{ color: "#3b82f6", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>SALDO INICIAL TOTAL</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#3b82f6" }}>{money(Number(dashboard.current_cash_register.opening_balance))}</div>
                    </div>
                  </div>

                  {/* Acciones rápidas */}
                  <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={downloadCajaExcel} style={{ padding: "6px 12px", background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }} title="Descargar Excel">
                      📥 Descargar Excel
                    </button>
                    <button type="button" onClick={printCajaMovimientos} style={{ padding: "6px 12px", background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }} title="Imprimir PDF">
                      🖨 Imprimir PDF
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewCajaCash(String(Number(dashboard.current_cash_register?.opening_balance_cash ?? 0).toFixed(2)));
                          setNewCajaBank(String(Number(dashboard.current_cash_register?.opening_balance_bank ?? 0).toFixed(2)));
                          setEditOpeningBalance(true);
                        }}
                        style={{ padding: "6px 12px", background: "rgba(59,130,246,0.25)", border: "1px solid rgba(59,130,246,0.4)", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                      >
                        ✏️ Editar saldo inicial
                      </button>
                    )}
                  </div>
                  {editOpeningBalance && (
                    <div style={{ marginTop: 12, padding: 12, background: "rgba(0,0,0,0.2)", borderRadius: 8, maxWidth: 420 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <Input name="edit_cash" label="Efectivo $" type="number" value={newCajaCash} onChange={(e) => setNewCajaCash(e.target.value)} />
                        <Input name="edit_bank" label="Banco $" type="number" value={newCajaBank} onChange={(e) => setNewCajaBank(e.target.value)} />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="primary" onClick={() => updateOpeningBalance().catch((e) => addToast(e.message, "error"))}>Guardar</button>
                        <button type="button" onClick={() => setEditOpeningBalance(false)}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sub-tabs profesional */}
                <nav className="cajaSubNav">
                  {(["resumen", "venta_detalle", "anticipo", "movimiento", "gastos", "sacos", "mantenimiento", "equipos", "fomentos"] as const).map((t) => {
                    const icons = {
                      resumen: "📋",
                      anticipo: "💸",
                      movimiento: "💳",
                      gastos: "🧾",
                      sacos: "📦",
                      mantenimiento: "🔧",
                      equipos: "⚙️",
                      venta_detalle: "🛒",
                      cuentas: "📊",
                      fomentos: "🌾"
                    };
                    const labels = {
                      resumen: "Movimientos",
                      anticipo: "Anticipo",
                      movimiento: "Movimiento",
                      gastos: "Gastos",
                      sacos: "Sacos",
                      mantenimiento: "Mantenimiento",
                      equipos: "Equipos",
                      venta_detalle: "Venta Detalle",
                      cuentas: `Por pagar${cashPayables.length > 0 ? ` (${cashPayables.length})` : ""}`,
                      fomentos: `Fomentos${fomentos.filter(f=>f.status==="ACTIVOS").length > 0 ? ` (${fomentos.filter(f=>f.status==="ACTIVOS").length})` : ""}`
                    };
                    return (
                      <button
                        key={t}
                        type="button"
                        className={cajaSubTab === t ? "active" : ""}
                        onClick={() => {
                          setCajaSubTab(t);
                          if (t === "mantenimiento") { if (equipment.length === 0) refreshEquipment(); refreshMaintenanceHistory(); }
                          if (t === "equipos" && equipment.length === 0) refreshEquipment();
                        }}
                      >
                        <span style={{ marginRight: 4 }}>{icons[t]}</span>{labels[t]}
                      </button>
                    );
                  })}
                </nav>

                {/* ── Movimientos ── */}
                {cajaSubTab === "resumen" && (
                  <div className="cajaMovimientosPanel" style={{ padding: 0, overflow: "hidden" }}>
                    {cashMovements.length === 0 ? (
                      <div className="emptyState">
                        <div className="emptyIcon">📭</div>
                        <p>Sin movimientos registrados aún</p>
                      </div>
                    ) : (
                      <div style={{ maxHeight: "600px", overflowY: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0 }}>
                            <tr>
                              <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "#374151" }}>Hora</th>
                              <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "#374151" }}>Tipo</th>
                              <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "#374151" }}>Categoría</th>
                              <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "#374151" }}>Descripción</th>
                              <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#374151" }}>Monto</th>
                              {isAdmin && <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#374151" }} />}
                            </tr>
                          </thead>
                          <tbody>
                            {cashMovements.map((m, idx) => {
                              const isReversed = !!m.reversed_at;
                              const isReversal = !!m.reversal_of;
                              return (
                              <tr key={m.id} style={{ borderBottom: "1px solid #e5e7eb", background: isReversed ? "#fef2f2" : isReversal ? "#f5f3ff" : idx % 2 === 0 ? "white" : "#fafafa", opacity: isReversed ? 0.7 : 1 }}>
                                <td style={{ padding: "12px 16px", color: "#6b7280" }}>
                                  {new Date(m.created_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}
                                </td>
                                <td style={{ padding: "12px 16px" }}>
                                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: "4px", background: m.movement === "INCOME" ? "#dcfce7" : "#fee2e2", color: m.movement === "INCOME" ? "#16a34a" : "#dc2626", fontWeight: 600, fontSize: 11 }}>
                                    {m.movement === "INCOME" ? "⬆ Ingreso" : "⬇ Egreso"}
                                  </span>
                                  {isReversed && <span className="chip bad" style={{ marginLeft: 6 }}>ANULADO</span>}
                                  {isReversal && <span className="chip info" style={{ marginLeft: 6 }}>Anulación</span>}
                                </td>
                                <td style={{ padding: "12px 16px", color: "#6b7280" }}>{categoryLabel(m.category)}</td>
                                <td style={{ padding: "12px 16px", color: "#6b7280" }}>
                                  {m.description ?? "—"}
                                  {isReversed && m.reversed_reason && <div style={{ fontSize: 11, color: "#b91c1c" }}>Motivo: {m.reversed_reason}</div>}
                                </td>
                                <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, color: m.movement === "EXPENSE" ? "#dc2626" : "#16a34a", textDecoration: isReversed ? "line-through" : "none" }}>
                                  {m.movement === "EXPENSE" ? "-" : "+"}{money(Number(m.amount))}
                                </td>
                                {isAdmin && (
                                  <td style={{ padding: "8px 16px", textAlign: "right" }}>
                                    {!isReversed && !isReversal && (
                                      <button type="button" className="btnGhost" onClick={() => reverseCashMovement(m)}>Anular</button>
                                    )}
                                  </td>
                                )}
                              </tr>
                            );})}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Anticipo ── */}
                {cajaSubTab === "anticipo" && (
                  <form onSubmit={(event) => submitCajaAnticipo(event).then(() => setAnticipoFarmerId("")).catch((e) => addToast(e.message, "error"))} style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "24px" }}>
                    <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>💸 Anticipo a agricultor</h2>
                    {farmersWithPendingLiq.length === 0 ? (
                      <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "6px", padding: "12px 16px", color: "#92400e", fontSize: 13 }}>
                        ⚠ No hay agricultores con saldo pendiente en liquidaciones
                      </div>
                    ) : (
                      <>
                        <label style={{ display: "block", marginBottom: 16 }}>
                          <span style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Agricultor</span>
                          <select name="farmer_id" required value={anticipoFarmerId} onChange={(e) => setAnticipoFarmerId(e.target.value)}
                            style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
                            <option value="">Seleccione un agricultor</option>
                            {farmersWithPendingLiq.map((f) => (
                              <option key={f.id} value={f.id}>{f.full_name} (Pendiente: ${f.pending_advance_balance.toFixed(2)})</option>
                            ))}
                          </select>
                        </label>
                        <Input name="amount" label="Monto $" type="number" />
                        <Input name="concept" label="Concepto" />
                        <button className="primary" style={{ width: "100%", padding: "10px 0" }} disabled={farmersWithPendingLiq.length === 0}>💰 Registrar anticipo</button>
                      </>
                    )}
                  </form>
                )}

                {/* ── Registrar movimiento (consolidado) ── */}
                {cajaSubTab === "movimiento" && (
                  <form onSubmit={(event) => submitCajaMovimiento(event).catch((e) => addToast(e.message, "error"))} style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "24px", maxWidth: 500 }}>
                    <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>💳 Registrar movimiento</h2>

                    <fieldset style={{ border: "none", padding: 0, margin: 0, marginBottom: 16 }}>
                      <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: "block" }}>Tipo de movimiento</legend>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 6, cursor: "pointer" }}>
                          <input type="radio" name="movement" value="EXPENSE" defaultChecked style={{ cursor: "pointer" }} />
                          <span style={{ fontWeight: 600 }}>⬇ Egreso</span>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 6, cursor: "pointer" }}>
                          <input type="radio" name="movement" value="INCOME" style={{ cursor: "pointer" }} />
                          <span style={{ fontWeight: 600 }}>⬆ Ingreso</span>
                        </label>
                      </div>
                    </fieldset>

                    <label style={{ display: "block", marginBottom: 16 }}>
                      <span style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Categoría</span>
                      {(() => {
                        const activeTipo = accionistas.find((a) => a.id === activeAccionistaId)?.tipo;
                        const esSocio = activeTipo === "SOCIO";
                        const visibles = CASH_CATEGORIES.filter((c) => esSocio ? (c.tipo === "SOCIO" || c.tipo === "AMBOS") : (c.tipo === "MATRIZ" || c.tipo === "AMBOS"));
                        const egresos = visibles.filter((c) => c.movement === "EXPENSE");
                        const ingresos = visibles.filter((c) => c.movement === "INCOME");
                        return (
                          <select name="category" required value={movCategory} onChange={(e: any) => setMovCategory(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
                            <option value="">Seleccione una categoría</option>
                            <optgroup label="Egresos">
                              {egresos.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                            </optgroup>
                            <optgroup label="Ingresos">
                              {ingresos.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                            </optgroup>
                          </select>
                        );
                      })()}
                    </label>
                    {(() => {
                      const cat = CASH_CATEGORIES.find((c) => c.code === movCategory);
                      if (!cat?.reuse) return null;
                      const info = cat.reuse === "pilado"
                        ? { txt: "Para que el pago abone la cuenta de CEYRO, regístralo en Por Pagar (descuenta tu caja y abona la cuenta por cobrar de CEYRO).", go: () => setCajaSubTab("cuentas"), lbl: "Ir a Por Pagar" }
                        : cat.reuse === "fomento"
                        ? { txt: "Para enlazarlo con el agricultor, regístralo en Fomentos.", go: () => setCajaSubTab("fomentos"), lbl: "Ir a Fomentos" }
                        : { txt: "Para enlazarlo a la liquidación del agricultor, regístralo en Liquidaciones.", go: () => setActiveTab("Liquidaciones"), lbl: "Ir a Liquidaciones" };
                      return (
                        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 12 }}>
                          <span style={{ display: "block", marginBottom: 6 }}>⚠️ {info.txt}</span>
                          <button type="button" onClick={info.go} style={{ fontSize: 12, padding: "4px 10px" }}>{info.lbl}</button>
                        </div>
                      );
                    })()}

                    <Input name="amount" label="Monto $" type="number" />
                    <Input name="description" label="Descripción (opcional)" required={false} />
                    <button className="primary" disabled={CASH_CATEGORIES.find((c) => c.code === movCategory)?.reuse !== undefined} style={{ width: "100%", padding: "10px 0", marginTop: 8 }}>💾 Registrar movimiento</button>
                  </form>
                )}

                {/* ── Gastos operativos ── */}
                {cajaSubTab === "gastos" && (
                  <section className="panelGrid">
                    <form className="formPanel" onSubmit={(e) => submitExpense(e).catch((err) => addToast(err.message, "error"))}>
                      <h2>🧾 Registrar gasto operativo</h2>
                      <p className="muted">Se guarda en el registro de gastos y se descuenta automáticamente de la caja abierta.</p>
                      <label>
                        <span>Monto $ *</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={expenseForm.amount}
                          onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                        />
                      </label>
                      <label>
                        <span>Descripción *</span>
                        <input
                          type="text"
                          placeholder="Ej: Compra de repuestos, combustible…"
                          value={expenseForm.description}
                          onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                        />
                      </label>
                      <label>
                        <span>Pagado a (opcional)</span>
                        <input
                          type="text"
                          placeholder="Nombre del proveedor o persona"
                          value={expenseForm.paid_to}
                          onChange={(e) => setExpenseForm({ ...expenseForm, paid_to: e.target.value })}
                        />
                      </label>
                      <button className="primary" disabled={busy}>Registrar gasto</button>
                    </form>

                    <form className="formPanel" onSubmit={(e) => submitLaborPayment(e).catch((err) => addToast(err.message, "error"))}>
                      <h2>👷 Pago de cuadrilla (estibaje)</h2>
                      <p className="muted">Calcula el total por sacos movidos y lo registra como egreso de caja.</p>
                      <label>
                        <span>Cuadrilla / Grupo *</span>
                        <input
                          type="text"
                          placeholder="Ej: Cuadrilla de Juan"
                          value={laborForm.worker_group}
                          onChange={(e) => setLaborForm({ ...laborForm, worker_group: e.target.value })}
                        />
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <label>
                          <span>Sacos movidos *</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            placeholder="0"
                            value={laborForm.sacks_moved}
                            onChange={(e) => setLaborForm({ ...laborForm, sacks_moved: e.target.value })}
                          />
                        </label>
                        <label>
                          <span>Precio por saco $ *</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={laborForm.price_per_sack}
                            onChange={(e) => setLaborForm({ ...laborForm, price_per_sack: e.target.value })}
                          />
                        </label>
                      </div>
                      <div className="totalBox">
                        <span>Total a pagar</span>
                        <strong>{money(round2((Number(laborForm.sacks_moved) || 0) * (Number(laborForm.price_per_sack) || 0)))}</strong>
                        <small>{laborForm.sacks_moved || 0} sacos × ${Number(laborForm.price_per_sack || 0).toFixed(2)}</small>
                      </div>
                      <button className="primary" disabled={busy}>Registrar pago</button>
                    </form>

                    <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                      <h2>Historial de gastos</h2>
                      {expenses.length === 0 ? (
                        <div className="emptyState">
                          <div className="emptyIcon">🧾</div>
                          <p>Aún no hay gastos registrados</p>
                        </div>
                      ) : (
                        <table className="cajaTable" style={{ marginTop: 10 }}>
                          <thead>
                            <tr>
                              <th>Fecha</th>
                              <th>Descripción</th>
                              <th>Pagado a</th>
                              <th style={{ textAlign: "right" }}>Monto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {expenses.map((exp) => (
                              <tr key={exp.id} className="rowExpense">
                                <td>{new Date(exp.created_at).toLocaleDateString("es-EC")}</td>
                                <td>{exp.description}</td>
                                <td>{exp.paid_to || "—"}</td>
                                <td className="amountCell">-{money(Number(exp.amount))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>
                )}

                {/* ── Compra de Sacos ── */}
                {cajaSubTab === "sacos" && (
                  <form onSubmit={(e) => { e.preventDefault(); submitSackBuy(); }} style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "24px", maxWidth: 500 }}>
                    <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>📦 Compra de Sacos</h2>
                    <label style={{ display: "block", marginBottom: 16 }}>
                      <span style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Tipo de saco</span>
                      <select value={sackBuyForm.sack_id} onChange={(e) => setSackBuyForm({ ...sackBuyForm, sack_id: e.target.value })} required
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
                        <option value="">Seleccione un tipo</option>
                        {sackInventory.map((s) => (
                          <option key={s.id} value={s.id}>{s.tipo} (Stock actual: {s.stock})</option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                      <label style={{ display: "block" }}>
                        <span style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Cantidad</span>
                        <input type="number" value={sackBuyForm.cantidad} onChange={(e: any) => setSackBuyForm({ ...sackBuyForm, cantidad: e.target.value })} required
                          style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }} min="1" />
                      </label>
                      <label style={{ display: "block" }}>
                        <span style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Precio unitario $</span>
                        <input type="number" step="0.01" value={sackBuyForm.precio} onChange={(e: any) => setSackBuyForm({ ...sackBuyForm, precio: e.target.value })} required
                          style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }} min="0" />
                      </label>
                    </div>
                    {sackBuyForm.cantidad && sackBuyForm.precio && (
                      <div style={{ background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: 6, padding: "12px 16px", marginBottom: 16, fontSize: 13 }}>
                        <div style={{ color: "#1e40af", marginBottom: 4 }}>Resumen de compra</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#1e40af" }}>
                          ${(parseInt(sackBuyForm.cantidad || "0") * parseFloat(sackBuyForm.precio || "0")).toFixed(2)}
                        </div>
                        <div style={{ fontSize: 11, color: "#3b82f6", marginTop: 4 }}>
                          {sackBuyForm.cantidad} unidades × ${parseFloat(sackBuyForm.precio || "0").toFixed(2)}
                        </div>
                      </div>
                    )}
                    <button className="primary" style={{ width: "100%", padding: "10px 0" }}>💾 Registrar compra</button>
                  </form>
                )}

                {/* ── Mantenimiento de Equipos ── */}
                {cajaSubTab === "equipos" && (
                  <div className="maintLayout">
                    {/* Catálogo de máquinas */}
                    <div className="formPanel">
                      <h2>🔧 Agregar máquina</h2>
                      <label>
                        <span>Nombre</span>
                        <input
                          type="text"
                          value={newEquipmentForm.name}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, name: e.target.value })}
                          placeholder="Ej: Piladora 1, Motor Túnel 1"
                        />
                      </label>
                      <label>
                        <span>Tipo</span>
                        <select
                          value={newEquipmentForm.type}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, type: e.target.value })}
                        >
                          <option value="PILADORA">Piladora</option>
                          <option value="SECADORA">Secadora</option>
                          <option value="MOTOR">Motor</option>
                          <option value="OTRO">Otro</option>
                        </select>
                      </label>
                      <label>
                        <span>Código</span>
                        <input type="text" value={newEquipmentForm.code}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, code: e.target.value })}
                          placeholder="Ej: M-01" />
                      </label>
                      <label>
                        <span>Marca</span>
                        <input type="text" value={newEquipmentForm.brand}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, brand: e.target.value })} />
                      </label>
                      <label>
                        <span>Modelo</span>
                        <input type="text" value={newEquipmentForm.model}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, model: e.target.value })} />
                      </label>
                      <label>
                        <span>Serie</span>
                        <input type="text" value={newEquipmentForm.serial}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, serial: e.target.value })} />
                      </label>
                      <label>
                        <span>Ubicación</span>
                        <input type="text" value={newEquipmentForm.location}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, location: e.target.value })} />
                      </label>
                      <button type="button" className="primary" onClick={submitNewEquipment}>
                        Agregar
                      </button>
                      <hr className="divider" />
                      <h2 style={{ marginBottom: 0 }}>Equipos</h2>
                      {equipment.length === 0 && <p className="muted">Sin equipos aún</p>}
                      <div className="equipList">
                        {equipment.filter((e) => e.status !== "FUERA_SERVICIO").map((eq) => (
                          <div key={eq.id} className="equipItem">
                            <div>
                              <strong>{eq.name}</strong>
                              <small>{eq.type}</small>
                            </div>
                            <button type="button" className="equipDelBtn" onClick={() => deleteEquipment(eq.id)}>
                              Eliminar
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {cajaSubTab === "mantenimiento" && (
                  <div className="maintLayout">
                    {/* Formulario Registrar Mantenimiento */}
                    <form className="formPanel cajaForm" onSubmit={(event: any) => {
                      event.preventDefault();
                      const fileInput = event.currentTarget.querySelector('input[type="file"]');
                      const file = fileInput?.files?.[0];
                      submitEquipmentMaintenance(file);
                    }}>
                      <h2>Registrar Mantenimiento</h2>
                    <label>
                      <span>Área</span>
                      <select
                        value={maintenanceForm.area}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, area: event.target.value, section: "" })}
                        required
                      >
                        <option value="">Seleccione</option>
                        {Object.keys(SECCIONES_POR_AREA).map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Sección a reparar</span>
                      <select
                        value={maintenanceForm.section}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, section: event.target.value })}
                        required
                        disabled={!maintenanceForm.area}
                      >
                        <option value="">Seleccione</option>
                        {(SECCIONES_POR_AREA[maintenanceForm.area] || []).map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Tipo de mantenimiento</span>
                      <select
                        value={maintenanceForm.maintenance_type}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, maintenance_type: event.target.value as any })}
                      >
                        <option value="CORRECTIVO">Correctivo (reparación)</option>
                        <option value="PREVENTIVO">Preventivo</option>
                        <option value="REPUESTO">Repuesto</option>
                        <option value="MANO_OBRA">Mano de obra</option>
                      </select>
                    </label>
                    <label>
                      <span>Descripción del trabajo/repuesto</span>
                      <textarea
                        placeholder={getDescriptionPlaceholder()}
                        value={maintenanceForm.description}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, description: event.target.value })}
                        required
                      />
                    </label>
                    <label>
                      <span>Proveedor/Técnico</span>
                      <input
                        type="text"
                        value={maintenanceForm.provider}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, provider: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Número de factura</span>
                      <input
                        type="text"
                        value={maintenanceForm.invoice_number}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, invoice_number: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Monto $</span>
                      <input
                        type="number"
                        step="0.01"
                        value={maintenanceForm.amount}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, amount: event.target.value })}
                        required
                      />
                    </label>
                    <label>
                      <span>📸 Foto del comprobante (JPG, PNG, máx 5MB)</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/jpg"
                      />
                    </label>
                    <button className="primary">Registrar mantenimiento</button>
                    </form>
                    <div className="formPanel">
                      <h2 style={{ marginBottom: 8 }}>Historial de mantenimientos</h2>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "flex-end" }}>
                        <label style={{ margin: 0 }}><span>Desde</span>
                          <input type="date" value={maintFilter.from} onChange={(e: any) => setMaintFilter({ ...maintFilter, from: e.target.value })} /></label>
                        <label style={{ margin: 0 }}><span>Hasta</span>
                          <input type="date" value={maintFilter.to} onChange={(e: any) => setMaintFilter({ ...maintFilter, to: e.target.value })} /></label>
                        <label style={{ margin: 0 }}><span>Área</span>
                          <select value={maintFilter.area} onChange={(e: any) => setMaintFilter({ ...maintFilter, area: e.target.value })}>
                            <option value="">Todas</option>
                            {Object.keys(SECCIONES_POR_AREA).map((a) => (<option key={a} value={a}>{a}</option>))}
                          </select></label>
                        <label style={{ margin: 0 }}><span>Tipo</span>
                          <select value={maintFilter.type} onChange={(e: any) => setMaintFilter({ ...maintFilter, type: e.target.value })}>
                            <option value="">Todos</option>
                            <option value="CORRECTIVO">Correctivo</option>
                            <option value="PREVENTIVO">Preventivo</option>
                            <option value="REPUESTO">Repuesto</option>
                            <option value="MANO_OBRA">Mano de obra</option>
                          </select></label>
                        <button type="button" onClick={refreshMaintenanceHistory}>Filtrar</button>
                        <button type="button" onClick={exportMaintCsv}>Exportar CSV</button>
                        <button type="button" onClick={printMaintReport}>Imprimir</button>
                      </div>
                      {(() => {
                        const vis = maintenanceHistory.filter((m: any) => !maintFilter.type || m.maintenance_type === maintFilter.type);
                        const total = vis.reduce((s: number, m: any) => s + Number(m.amount || 0), 0);
                        return (
                          <>
                            <p style={{ fontWeight: 600, margin: "4px 0" }}>{vis.length} registros · Total: ${total.toFixed(2)}</p>
                            {vis.length === 0 && <p className="muted">Sin mantenimientos</p>}
                            <div className="equipList">
                              {vis.map((m: any) => (
                                <div key={m.id} className="equipItem">
                                  <div>
                                    <strong>{m.area_label}{m.section_label ? " / " + m.section_label : ""}</strong>
                                    <small>{(m.created_at || "").slice(0, 10)} · {m.maintenance_type} · {m.description}{m.provider ? " · " + m.provider : ""}</small>
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                                    <strong>${Number(m.amount).toFixed(2)}</strong>
                                    {m.receipt_photo_signed_url && <a href={m.receipt_photo_signed_url} target="_blank" rel="noreferrer">foto</a>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    </div>
                )}

                {/* ── Venta Detalle (por libra) ── */}
                {cajaSubTab === "venta_detalle" && (
                  <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submitVentaDetalle(); }} style={{ maxWidth: 600 }}>
                    <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>🛒 Venta Detalle por Libra</h2>
                    <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>Registra ventas pequeñas. Se restan automáticamente del inventario y entra el dinero a la caja.</p>

                    <Select name="product_id" label="Producto"
                      rows={products.filter(p => ['Flor', 'Oso', 'Lira Verde', 'Lira Azul', 'Conejo', 'Arrocillo 3/4', 'Arrocillo Fino', 'Polvillo / Afrecho'].includes(p.name))
                        .map((product) => [product.id, product.name])}
                      onChange={(e: any) => setVentaDetalleForm({ ...ventaDetalleForm, product_id: e.target.value })} />

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                      <Input name="cantidad_libras" label="Cantidad (Libras)" type="number"
                        value={ventaDetalleForm.cantidad_libras}
                        onChange={(e: any) => setVentaDetalleForm({ ...ventaDetalleForm, cantidad_libras: e.target.value })}
                        placeholder="0" required />
                      <Input name="precio_por_libra" label="Precio por Libra $" type="number"
                        value={ventaDetalleForm.precio_por_libra}
                        onChange={(e: any) => setVentaDetalleForm({ ...ventaDetalleForm, precio_por_libra: e.target.value })}
                        placeholder="0.00" required step="0.01" />
                    </div>

                    <Select name="customer_id" label="Cliente (opcional)"
                      rows={customers.map((c) => [c.id, c.full_name])}
                      onChange={(e: any) => setVentaDetalleForm({ ...ventaDetalleForm, customer_id: e.target.value })}
                      required={false} />

                    {ventaDetalleForm.cantidad_libras && ventaDetalleForm.precio_por_libra && (
                      <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "16px", marginBottom: 16 }}>
                        <div style={{ color: "#166534", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>💰 RESUMEN DE VENTA</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Cantidad</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "#16a34a" }}>{Number(ventaDetalleForm.cantidad_libras)} libras</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Equivalencia</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#16a34a" }}>{(Number(ventaDetalleForm.cantidad_libras) / 100).toFixed(2)} QQ</div>
                          </div>
                        </div>
                        <div style={{ borderTop: "1px solid #86efac", paddingTop: 8 }}>
                          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Total a cobrar</div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>${(Number(ventaDetalleForm.cantidad_libras) * Number(ventaDetalleForm.precio_por_libra)).toFixed(2)}</div>
                        </div>
                      </div>
                    )}

                    <button className="primary" style={{ width: "100%", padding: "10px 0" }}>✓ Registrar venta detalle</button>
                  </form>
                )}

                {/* Las cuentas por pagar se administran en la pestaña "Por Pagar" (grupo Cuentas). */}

                {cajaSubTab === "fomentos" && (
                  <div className="cajaMovimientosPanel">
                    {/* Form de acción */}
                    <form onSubmit={submitCajaFomento} style={{ background: "var(--c-surface)", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 16 }}>
                      <h4 style={{ margin: "0 0 12px" }}>Operación de Fomento desde Caja</h4>

                      {/* Tipo de acción */}
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        <button type="button"
                          style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "2px solid",
                            borderColor: cajaFomentoAccion === "entrega" ? "var(--c-brand)" : "#d1d5db",
                            background: cajaFomentoAccion === "entrega" ? "var(--c-brand)" : "transparent",
                            color: cajaFomentoAccion === "entrega" ? "#fff" : "inherit",
                            cursor: "pointer", fontWeight: 700, fontSize: 13 }}
                          onClick={() => setCajaFomentoAccion("entrega")}>
                          ⬇ Entregar Fomento
                        </button>
                        <button type="button"
                          style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "2px solid",
                            borderColor: cajaFomentoAccion === "pago" ? "#16a34a" : "#d1d5db",
                            background: cajaFomentoAccion === "pago" ? "#16a34a" : "transparent",
                            color: cajaFomentoAccion === "pago" ? "#fff" : "inherit",
                            cursor: "pointer", fontWeight: 700, fontSize: 13 }}
                          onClick={() => setCajaFomentoAccion("pago")}>
                          ⬆ Recibir Pago
                        </button>
                      </div>

                      {/* Seleccionar agricultor fomentado */}
                      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 8 }}>
                        Agricultor Fomentado
                        <select required value={cajaFomentoId} onChange={e => setCajaFomentoId(e.target.value)}
                          style={{ display: "block", width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3, fontSize: 13 }}>
                          <option value="">— Seleccionar —</option>
                          {fomentos.filter(f => f.status === "ACTIVOS").map(f => (
                            <option key={f.id} value={f.id}>
                              {f.farmer_name} | Deuda: ${Number(f.deuda_total ?? 0).toFixed(2)} | Disp: ${Number(f.falta_por_pedir).toFixed(2)}
                            </option>
                          ))}
                        </select>
                      </label>

                      {/* Resumen del fomento seleccionado */}
                      {cajaFomentoId && (() => {
                        const f = fomentos.find(x => x.id === cajaFomentoId);
                        if (!f) return null;
                        return (
                          <div style={{ background: "#f0fdf4", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                            <div><span style={{ color: "var(--c-muted)" }}>Pedido</span><br/><strong>${Number(f.total_pedido).toFixed(2)}</strong></div>
                            <div><span style={{ color: "var(--c-muted)" }}>Interés</span><br/><strong style={{ color: "#b45309" }}>${Number(f.gasto_adm).toFixed(2)}</strong></div>
                            <div><span style={{ color: "var(--c-muted)" }}>Deuda total</span><br/><strong style={{ color: "#dc2626" }}>${Number(f.deuda_total ?? 0).toFixed(2)}</strong></div>
                          </div>
                        );
                      })()}

                      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 8 }}>
                        Monto ($)
                        <input required type="number" step="0.01" min="0.01" value={cajaFomentoMonto}
                          onChange={e => setCajaFomentoMonto(e.target.value)}
                          style={{ display: "block", width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3 }}
                          placeholder="0.00" />
                      </label>

                      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 12 }}>
                        Concepto
                        <input value={cajaFomentoConcepto} onChange={e => setCajaFomentoConcepto(e.target.value)}
                          style={{ display: "block", width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3 }}
                          placeholder={cajaFomentoAccion === "entrega" ? "Entrega de insumos / semilla / etc." : "Abono / pago parcial / etc."} />
                      </label>

                      <button type="submit"
                        style={{ width: "100%", padding: "9px 0", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14,
                          background: cajaFomentoAccion === "entrega" ? "var(--c-brand)" : "#16a34a", color: "#fff" }}>
                        {cajaFomentoAccion === "entrega" ? "⬇ Registrar Entrega (sale de caja)" : "⬆ Registrar Pago (entra a caja)"}
                      </button>
                    </form>

                    {/* Lista de todos los agricultores fomentados */}
                    <h4 style={{ marginBottom: 8 }}>Agricultores Fomentados</h4>
                    {fomentos.filter(f => f.status === "ACTIVOS").length === 0 && (
                      <p style={{ color: "var(--c-muted)", textAlign: "center" }}>No hay fomentos activos</p>
                    )}
                    {fomentos.filter(f => f.status === "ACTIVOS").map(f => {
                      const deuda = Number(f.deuda_total ?? 0);
                      const pagado = Number(f.total_pagado ?? 0);
                      return (
                        <article key={f.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px", marginBottom: 8, background: "var(--c-surface)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <strong style={{ fontSize: 14 }}>{f.farmer_name}</strong>
                            <span style={{ fontSize: 11, background: f.estado_credito === "HABILITADO" ? "#dcfce7" : "#fee2e2",
                              color: f.estado_credito === "HABILITADO" ? "#16a34a" : "#dc2626",
                              borderRadius: 4, padding: "2px 8px", fontWeight: 700 }}>
                              {f.estado_credito}
                            </span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, fontSize: 12 }}>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ color: "var(--c-muted)", fontSize: 10 }}>PEDIDO</div>
                              <strong>${Number(f.total_pedido).toFixed(2)}</strong>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ color: "var(--c-muted)", fontSize: 10 }}>INTERÉS</div>
                              <strong style={{ color: "#b45309" }}>${Number(f.gasto_adm).toFixed(2)}</strong>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ color: "var(--c-muted)", fontSize: 10 }}>PAGADO</div>
                              <strong style={{ color: "#16a34a" }}>${pagado.toFixed(2)}</strong>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ color: "var(--c-muted)", fontSize: 10 }}>DEUDA</div>
                              <strong style={{ color: deuda > 0 ? "#dc2626" : "#16a34a" }}>${deuda.toFixed(2)}</strong>
                            </div>
                          </div>
                          <button type="button"
                            onClick={() => { setCajaFomentoId(f.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                            style={{ marginTop: 8, fontSize: 11, padding: "4px 10px", borderRadius: 5, border: "1px solid var(--c-brand)",
                              background: "transparent", color: "var(--c-brand)", cursor: "pointer" }}>
                            Seleccionar para operar
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "Liquidaciones" && (
          <section className="panelGrid">
            <div className="formPanel">
              {liqResult ? (
                <>
                  <h2>Liquidación realizada</h2>
                  <div className="liqResultTable">
                    <div className="liqResultHead">
                      <span>Lote</span><span>Tipo</span><span>QQ</span>
                      <span>Precio</span><span>Desc.</span><span>Neto</span>
                    </div>
                    {liqResult.map((item, i) => (
                      <div key={i} className="liqResultRow">
                        <span>{item.lot_code}</span>
                        <span>{item.rice_type ?? "—"}</span>
                        <span>{Number(item.quintals).toFixed(2)}</span>
                        <span>${Number(item.price_per_quintal).toFixed(2)}</span>
                        <span className="liqDiscount">
                          -${(Number(item.advances_discount) + Number(item.other_discounts)).toFixed(2)}
                        </span>
                        <span className="liqNet">${Number(item.net_amount).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="liqResultTotal">
                      <span>Total neto</span><span /><span />
                      <span /><span />
                      <span className="liqNet">
                        ${liqResult.reduce((s, r) => s + Number(r.net_amount), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="liqResultActions">
                    {farmerLots.length > 0 && (
                      <button type="button" className="liqAddBtn"
                        onClick={() => setLiqResult(null)}>
                        ↩ Seguir liquidando
                      </button>
                    )}
                    <button type="button" className="liqAddBtn"
                      onClick={() => { setLiqResult(null); setLiqFarmerId(""); }}>
                      + Nueva liquidación
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>Nueva liquidación</h2>

                  <label>
                    <span>Agricultor</span>
                    <select value={liqFarmerId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setLiqFarmerId(id);
                        setLiqLines([{ lot_id: "", quintals: "", price: "" }]);
                        // Auto-integración Fomento → Liquidación: si el agricultor
                        // tiene fomento activo con deuda, se carga sola como descuento;
                        // si no tiene, queda vacío y se sigue normal.
                        const f = id
                          ? fomentoDeudaDeAgricultor.get(`id:${id}`) ?? (() => {
                              const farmer = farmers.find((x) => x.id === id);
                              const nombre = String(farmer?.full_name ?? "").trim().toUpperCase();
                              return nombre ? fomentoDeudaDeAgricultor.get(`nm:${nombre}`) ?? null : null;
                            })()
                          : null;
                        setLiqDiscounts((p) => ({ ...p, fomento: f ? f.deuda.toFixed(2) : "" }));
                        if (f) setDiscountsOpen(true);
                      }}
                      required>
                      <option value="">Seleccione</option>
                      {farmersWithLots.map((f) => <option key={f.id} value={f.id}>{f.full_name}</option>)}
                    </select>
                  </label>

                  <div className="liqLinesHeader">
                    <span>Ingreso de materia prima</span><span>QQ</span><span>Precio / QQ</span>
                  </div>

                  {liqLines.map((line, i) => {
                    const takenIds = new Set(liqLines.filter((_, j) => j !== i).map((l) => l.lot_id).filter(Boolean));
                    return (
                      <div key={i} className="liqLine">
                        <select value={line.lot_id} onChange={(e) => {
                          const sel = farmerLots.find((l) => l.id === e.target.value);
                          const updated = [...liqLines];
                          updated[i] = { ...updated[i], lot_id: e.target.value, quintals: sel ? String(Number(sel.quintals ?? 0).toFixed(2)) : "" };
                          setLiqLines(updated);
                        }} required>
                          <option value="">— seleccionar ingreso —</option>
                          {farmerLots.filter((l) => !takenIds.has(l.id)).map((l) => (
                            <option key={l.id} value={l.id}>
                              {entryLabel(l)} · {l.rice_type ?? "—"} · {Number(l.quintals ?? 0).toFixed(2)} QQ{l.lot_code ? ` · ${l.lot_code}` : ""}
                            </option>
                          ))}
                        </select>
                        <input type="number" step="0.01" min="0"
                          placeholder={farmerLots.find((l) => l.id === line.lot_id) ? String(Number(farmerLots.find((l) => l.id === line.lot_id)!.quintals ?? 0).toFixed(2)) : "QQ"}
                          value={line.quintals}
                          onChange={(e) => { const u = [...liqLines]; u[i] = { ...u[i], quintals: e.target.value }; setLiqLines(u); }} />
                        <input type="number" step="0.01" min="0" placeholder="0.00"
                          value={line.price}
                          onChange={(e) => { const u = [...liqLines]; u[i] = { ...u[i], price: e.target.value }; setLiqLines(u); }}
                          required />
                        {liqLines.length > 1 && (
                          <button type="button" className="liqRemoveBtn"
                            onClick={() => setLiqLines(liqLines.filter((_, j) => j !== i))}>×</button>
                        )}
                      </div>
                    );
                  })}

                  <button type="button" className="liqAddBtn"
                    onClick={() => setLiqLines([...liqLines, { lot_id: "", quintals: "", price: "" }])}>
                    + Agregar lote
                  </button>

                  {/* ─ Descuentos ─ */}
                  <button type="button"
                    className={`liqDiscountToggle${discountsOpen ? " open" : ""}`}
                    onClick={() => setDiscountsOpen((v) => !v)}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="3" y1="8" x2="13" y2="8"/>
                      {!discountsOpen && <line x1="8" y1="3" x2="8" y2="13"/>}
                    </svg>
                    Descuentos
                    {liqDiscountsTotal > 0 && <span className="liqDiscBadge">-${liqDiscountsTotal.toFixed(2)}</span>}
                    <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polyline points="2,4 6,8 10,4"/>
                    </svg>
                  </button>

                  {discountsOpen && (
                    <div className="liqDiscountsPanel">
                      <div className="liqDiscNote">
                        <strong>Anticipo</strong> — se descuenta automáticamente del balance del agricultor
                      </div>
                      {([
                        { key: "bascula",     label: "Báscula" },
                        { key: "flete",       label: "Flete" },
                        { key: "cosechadora", label: "Cosechadora" },
                        // Fomento va de ÚLTIMO: es el apartado final del módulo
                        // Liquidación y se auto-carga con la deuda del agricultor.
                        { key: "fomento",     label: "Fomento" },
                      ] as const).map(({ key, label }) => (
                        <label key={key} className="liqDiscRow">
                          <span>{label}</span>
                          <input type="number" step="0.01" min="0" placeholder="0.00"
                            value={liqDiscounts[key]}
                            onChange={(e) => setLiqDiscounts((p) => ({ ...p, [key]: e.target.value }))} />
                        </label>
                      ))}
                      {liqFomentoAuto && (
                        <small className="muted" style={{ display: "block" }}>
                          🌾 {liqFomentoAuto.nombres.join(", ")} tiene fomento activo: deuda ${liqFomentoAuto.deuda.toFixed(2)} cargada automáticamente. Puedes ajustarla antes de liquidar.
                        </small>
                      )}
                    </div>
                  )}

                  {/* ─ Resumen ─ */}
                  <div className="liqSummary">
                    <div className="liqSummaryRow">
                      <span>Total QQ</span>
                      <strong>{liqQqTotal.toFixed(2)} QQ</strong>
                    </div>
                    <div className="liqSummaryRow">
                      <span>Total bruto</span>
                      <strong>${liqGrossTotal.toFixed(2)}</strong>
                    </div>
                    {liqDiscountsTotal > 0 && (
                      <div className="liqSummaryRow disc">
                        <span>Descuentos manuales</span>
                        <strong>-${liqDiscountsTotal.toFixed(2)}</strong>
                      </div>
                    )}
                    <div className="liqSummaryRow total">
                      <span>Estimado a pagar</span>
                      <strong>${Math.max(0, liqGrossTotal - liqDiscountsTotal).toFixed(2)}</strong>
                    </div>
                    <small>* Anticipos pendientes se descuentan automáticamente</small>
                  </div>

                  <button className="primary"
                    onClick={() => submitLiquidations().catch((e: Error) => setMessage(e.message))}>
                    Liquidar {liqLines.filter((l) => l.lot_id && l.price).length || ""} lote(s)
                  </button>
                </>
              )}
            </div>


            <DataList
              title="Materia prima por liquidar"
              headers={["Ingreso", "Tipo cáscara", "Agricultor", "Lote", "QQ"]}
              rows={pendingEntries.map((e) => [
                entryLabel(e),
                e.rice_type ?? "—",
                e.farmer_name ?? "—",
                e.lot_code ?? "sin lote aún",
                `${Number(e.quintals ?? 0).toFixed(2)} QQ`
              ])}
            />

            <div className="tablePanel liqHistPanel">
              <h2>Liquidaciones realizadas</h2>
              {liqBatches.length === 0
                ? <p className="tableEmpty">Sin liquidaciones registradas</p>
                : <div className="liqHistTable">
                    <div className="liqHistHead">
                      <span>Agricultor</span>
                      <span>Total QQ</span>
                      <span>Bruto</span>
                      <span>Anticipo</span>
                      <span>Otros desc.</span>
                      <span>Neto</span>
                      <span>Estado</span>
                      <span></span>
                    </div>
                    {liqBatches.map((b) => {
                      const paid = b.pending_total === 0;
                      const qqTotal = b.lots.reduce((s, l) => s + l.quintals, 0);
                      const lotsLabel = b.lots.map((l) => `${l.lot_code ?? "?"} (${l.rice_type ?? "—"})`).join(", ");
                      return (
                        <div key={b.key} className="liqHistRow">
                          <span>{b.farmer_name}</span>
                          <span>{qqTotal.toFixed(2)} QQ</span>
                          <span>${b.gross_total.toFixed(2)}</span>
                          <span className="liqDiscount">-${b.advances_total.toFixed(2)}</span>
                          <span className="liqDiscount">-${b.other_disc_total.toFixed(2)}</span>
                          <span className="liqNet">${b.net_total.toFixed(2)}</span>
                          <span>
                            <span className={paid ? "liqBadgePaid" : "liqBadgePending"}>
                              {paid ? "Pagado" : `Pend. $${b.pending_total.toFixed(2)}`}
                            </span>
                          </span>
                          <span className="liqActions">
                            {!paid && (
                              <>
                                <button
                                  type="button"
                                  className="liqAbonoBtn"
                                  title="Ir a Caja → Anticipo con este agricultor"
                                  onClick={() => {
                                    setAnticipoFarmerId(b.farmer_id);
                                    setCajaSubTab("anticipo");
                                    setActiveTab("Caja");
                                  }}
                                >
                                  💰 Abonar
                                </button>
                                <button
                                  type="button"
                                  className="liqApplyBtn"
                                  title="Descontar anticipos pendientes"
                                  onClick={() => aplicarAnticiposLiquidacion(b.liquidation_ids).catch((e) => addToast(e.message, "error"))}
                                >
                                  Desc. anticipo
                                </button>
                              </>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                className="liqApplyBtn"
                                title={b.unlocked ? "Bloquear edicion (candado)" : "Desbloquear para corregir precio/descuentos"}
                                onClick={() => toggleLiqLock(b).catch((e) => addToast(e.message, "error"))}
                              >
                                {b.unlocked ? "🔓" : "🔒"}
                              </button>
                            )}
                            {b.unlocked && (
                              <button
                                type="button"
                                className="liqApplyBtn"
                                title="Corregir precio o descuentos"
                                onClick={() => openLiqEdit(b)}
                              >
                                ✏ Editar
                              </button>
                            )}
                            <button type="button" className="liqPrintBtn" onClick={() => printLiqBatch(b).catch((e) => addToast(e.message, "error"))} title="Imprimir comprobante">
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="1" width="10" height="8" rx="1"/>
                                <path d="M3 9H1v5h14V9h-2"/>
                                <rect x="4" y="11" width="8" height="3" rx=".5"/>
                                <line x1="5" y1="12.5" x2="11" y2="12.5"/>
                              </svg>
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
          </section>
        )}
        {liqEdit && (
          <div className="modalOverlay" onClick={() => setLiqEdit(null)}>
            <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
              <h3>Corregir liquidacion de {liqEdit.farmer_name}</h3>
              <p className="muted">Ajusta el precio por QQ o los otros descuentos si se capturaron mal. El sistema recalcula el neto y la cuenta por pagar. Queda registrado en auditoria.</p>
              <div style={{ display: "grid", gap: 10, maxHeight: "55vh", overflowY: "auto" }}>
                {liqEditRows.map((row, i) => (
                  <div key={row.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{row.lot_code ?? "Ingreso"}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <label style={{ fontSize: 12 }}>Precio / QQ
                        <input type="number" step="0.01" min="0" value={row.price}
                          onChange={(e) => setLiqEditRows((rs) => rs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                          style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3 }} />
                      </label>
                      <label style={{ fontSize: 12 }}>Otros descuentos
                        <input type="number" step="0.01" min="0" value={row.other}
                          onChange={(e) => setLiqEditRows((rs) => rs.map((x, j) => (j === i ? { ...x, other: e.target.value } : x)))}
                          style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3 }} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="buttonRow" style={{ marginTop: 14 }}>
                <button type="button" className="primary" onClick={() => saveLiqEdit().catch((e) => addToast(e.message, "error"))}>Guardar correcciones</button>
                <button type="button" onClick={() => setLiqEdit(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
        {activeTab === "Fomentos" && (
          <section className="tabSection">
            <h2>Fomentos de Insumos</h2>

            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" onClick={() => exportFomentos().catch(() => undefined)}
                style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--c-brand)", background: "var(--c-brand)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                📥 DESCARGAR EXCEL
              </button>
              <label style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--c-brand)", background: "transparent", color: "var(--c-brand)", cursor: "pointer", fontWeight: 600, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {fomentoImporting ? <span className="spinner" /> : "📤 SUBIR EXCEL"}
                <input type="file" accept=".xlsx" disabled={fomentoImporting}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importFomentos(file).finally(() => { e.target.value = ""; });
                  }}
                  style={{ display: "none" }} />
              </label>
              {fomentoImporting && <span className="muted" style={{ fontSize: 12 }}>Importando...</span>}
            </div>

            {/* Filtro de estado */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {(["TODOS","ACTIVOS","NO ACTIVOS","APROBADOS"] as const).map(f => (
                <button key={f} type="button"
                  style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--c-brand)",
                    background: fomentoFilter === f ? "var(--c-brand)" : "transparent",
                    color: fomentoFilter === f ? "#fff" : "var(--c-brand)", cursor: "pointer", fontWeight: fomentoFilter === f ? 700 : 400 }}
                  onClick={() => { setFomentoFilter(f); setFomentoDetalle(null); }}
                >{f}</button>
              ))}
              <button type="button" style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 6, border: "1px solid #999", background: "transparent", cursor: "pointer" }}
                onClick={() => refreshFomentos().catch(() => undefined)}>↺ Actualizar</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

              {/* COLUMNA IZQUIERDA: Lista + Formulario nuevo */}
              <div>
                <h3 style={{ marginBottom: 8 }}>Lista de Fomentos</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
                  {fomentos
                    .filter(f => fomentoFilter === "TODOS" || f.status === fomentoFilter)
                    .map(f => {
                      const habilitado = f.estado_credito === "HABILITADO";
                      const statusColor = f.status === "ACTIVOS" ? "#16a34a" : f.status === "APROBADOS" ? "#1d4ed8" : "#6b7280";
                      return (
                        <div key={f.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", cursor: "pointer",
                          background: fomentoDetalle?.id === f.id ? "#f0fdf4" : "var(--c-surface)" }}
                          onClick={() => loadFomentoDetalle(f.id).catch(() => undefined)}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <strong style={{ fontSize: 14 }}>{f.farmer_name}</strong>
                            <span style={{ fontSize: 11, background: statusColor, color: "#fff", borderRadius: 4, padding: "2px 6px" }}>{f.status}</span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--c-muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                            <span>{f.cuadras} cuadras</span>
                            <span>Límite: ${Number(f.monto_limite).toFixed(2)}</span>
                            <span>Pedido: ${Number(f.total_pedido).toFixed(2)}</span>
                            <span style={{ color: habilitado ? "#16a34a" : "#dc2626", fontWeight: 700 }}>{f.estado_credito}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--c-muted)", marginTop: 2 }}>
                            Inicio: {f.inicio?.slice(0,10)} | Cosecha: {f.cosecha?.slice(0,10) ?? "—"} | Interés: ${Number(f.gasto_adm).toFixed(2)}
                          </div>
                        </div>
                      );
                    })}
                  {fomentos.filter(f => fomentoFilter === "TODOS" || f.status === fomentoFilter).length === 0 && (
                    <p style={{ color: "var(--c-muted)", textAlign: "center", padding: 20 }}>No hay fomentos {fomentoFilter !== "TODOS" ? `con estado ${fomentoFilter}` : "registrados"}</p>
                  )}
                </div>

                {/* Formulario nuevo fomento */}
                <details style={{ marginTop: 16 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--c-brand)", padding: "6px 0" }}>+ Nuevo Fomento</summary>
                  <form onSubmit={submitFomento} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Agricultor / Cliente
                      <input required value={fomentoForm.farmer_name} onChange={e => setFomentoForm(p => ({...p, farmer_name: e.target.value}))}
                        style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} placeholder="Nombre completo" />
                    </label>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Cuadras
                      <input required type="number" step="0.01" min="0.01" value={fomentoForm.cuadras} onChange={e => setFomentoForm(p => ({...p, cuadras: e.target.value}))}
                        style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} placeholder="Ej: 2.5" />
                    </label>
                    {fomentoForm.cuadras && (
                      <div style={{ fontSize: 12, color: "var(--c-muted)", background: "#f0fdf4", borderRadius: 6, padding: "4px 8px" }}>
                        Paradas: {(Number(fomentoForm.cuadras)*16).toFixed(0)} | Límite: ${(Number(fomentoForm.cuadras)*800).toFixed(2)}
                      </div>
                    )}
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Fecha Inicio
                      <input required type="date" value={fomentoForm.inicio} onChange={e => setFomentoForm(p => ({...p, inicio: e.target.value}))}
                        style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} />
                    </label>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Estado
                      <select value={fomentoForm.status} onChange={e => setFomentoForm(p => ({...p, status: e.target.value as "ACTIVOS"|"NO ACTIVOS"|"APROBADOS"}))}
                        style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }}>
                        <option>ACTIVOS</option>
                        <option>NO ACTIVOS</option>
                        <option>APROBADOS</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Notas
                      <input value={fomentoForm.notes} onChange={e => setFomentoForm(p => ({...p, notes: e.target.value}))}
                        style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} placeholder="Opcional" />
                    </label>
                    <button type="submit" style={{ background: "var(--c-brand)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 700 }}>
                      Guardar Fomento
                    </button>
                  </form>
                </details>
              </div>

              {/* COLUMNA DERECHA: Detalle del fomento seleccionado */}
              <div>
                {fomentoDetalle ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <h3 style={{ margin: 0 }}>{fomentoDetalle.farmer_name}</h3>
                      <button type="button" onClick={() => setFomentoDetalle(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--c-muted)" }}>✕</button>
                    </div>

                    {/* Tasa de interés editable */}
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Tasa de interés:</span>
                      {fomentoEditingRenta === fomentoDetalle.id ? (
                        <>
                          <input type="number" step="0.01" min="0.1" max="100" value={fomentoRentaInput}
                            onChange={e => setFomentoRentaInput(e.target.value)}
                            style={{ width: 70, padding: "3px 6px", borderRadius: 5, border: "1px solid #d1d5db", fontSize: 13 }}
                            placeholder="7" />
                          <span style={{ fontSize: 12 }}>%</span>
                          <button type="button" onClick={() => saveRenta(fomentoDetalle.id).catch(e => addToast(e.message,"error"))}
                            style={{ background: "var(--c-brand)", color: "#fff", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                            Guardar
                          </button>
                          <button type="button" onClick={() => setFomentoEditingRenta(null)}
                            style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 12 }}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <strong style={{ fontSize: 15, color: "#b45309" }}>{(Number(fomentoDetalle.renta) * 100).toFixed(2)}%</strong>
                          <span style={{ fontSize: 10, color: "var(--c-muted)" }}>mensual</span>
                          <button type="button" onClick={() => { setFomentoEditingRenta(fomentoDetalle.id); setFomentoRentaInput((Number(fomentoDetalle.renta)*100).toFixed(2)); }}
                            style={{ background: "none", border: "1px solid #fcd34d", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: "#92400e" }}>
                            ✏ Editar %
                          </button>
                        </>
                      )}
                    </div>

                    {/* Resumen */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                      {([
                        ["Cuadras", fomentoDetalle.cuadras],
                        ["Paradas", Number(fomentoDetalle.paradas).toFixed(0)],
                        ["Monto Límite", `$${Number(fomentoDetalle.monto_limite).toFixed(2)}`],
                        ["Total Pedido", `$${Number(fomentoDetalle.total_pedido).toFixed(2)}`],
                        ["Disponible", `$${Number(fomentoDetalle.falta_por_pedir).toFixed(2)}`],
                        ["Interés Acum.", `$${Number(fomentoDetalle.gasto_adm).toFixed(2)}`],
                        ["Total Pagado", `$${Number(fomentoDetalle.total_pagado ?? 0).toFixed(2)}`],
                        ["Deuda Total", `$${Number(fomentoDetalle.deuda_total ?? 0).toFixed(2)}`],
                        ["Estado", fomentoDetalle.estado_credito],
                      ] as [string, string|number][]).map(([k, v]) => (
                        <div key={k} style={{ background: "#f9fafb", borderRadius: 6, padding: "6px 10px" }}>
                          <div style={{ fontSize: 10, color: "var(--c-muted)", fontWeight: 600 }}>{k}</div>
                          <div style={{ fontSize: 14, fontWeight: 700,
                            color: k === "Estado" ? (v === "HABILITADO" ? "#16a34a" : "#dc2626")
                                 : k === "Deuda Total" ? (Number(v.toString().replace("$","")) > 0 ? "#dc2626" : "#16a34a")
                                 : k === "Total Pagado" ? "#16a34a"
                                 : "inherit" }}>{v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Tabla de entregas */}
                    <h4 style={{ marginBottom: 6 }}>Entregas / Créditos</h4>
                    <div style={{ overflowX: "auto", marginBottom: 12 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "var(--c-brand)", color: "#fff" }}>
                            <th style={{ padding: "4px 8px", textAlign: "left" }}>Fecha</th>
                            <th style={{ padding: "4px 8px", textAlign: "right" }}>Valor</th>
                            <th style={{ padding: "4px 8px", textAlign: "right" }}>Días</th>
                            <th style={{ padding: "4px 8px", textAlign: "right" }}>Interés</th>
                            <th style={{ padding: "4px 8px", textAlign: "right" }}>Total</th>
                            <th style={{ padding: "4px 8px" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {fomentoDetalle.entregas.map((e, i) => {
                            const dias = Math.max(0, Math.floor((Date.now() - new Date(e.fecha).getTime()) / 86400000));
                            return (
                              <tr key={e.id} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                                <td style={{ padding: "4px 8px" }}>{e.fecha?.slice(0,10)}</td>
                                <td style={{ padding: "4px 8px", textAlign: "right" }}>${Number(e.valor).toFixed(2)}</td>
                                <td style={{ padding: "4px 8px", textAlign: "right" }}>{dias}</td>
                                <td style={{ padding: "4px 8px", textAlign: "right", color: "#b45309" }}>${Number(e.interes).toFixed(2)}</td>
                                <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700 }}>${Number(e.suman).toFixed(2)}</td>
                                <td style={{ padding: "4px 8px" }}>
                                  <button type="button" title="Eliminar entrega"
                                    onClick={() => deleteFomentoEntrega(fomentoDetalle.id, e.id).catch(() => undefined)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 14 }}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                          {fomentoDetalle.entregas.length === 0 && (
                            <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--c-muted)", padding: 12 }}>Sin entregas registradas</td></tr>
                          )}
                        </tbody>
                        {fomentoDetalle.entregas.length > 0 && (
                          <tfoot>
                            <tr style={{ fontWeight: 700, borderTop: "2px solid #e5e7eb" }}>
                              <td style={{ padding: "4px 8px" }}>TOTAL</td>
                              <td style={{ padding: "4px 8px", textAlign: "right" }}>${Number(fomentoDetalle.total_pedido).toFixed(2)}</td>
                              <td></td>
                              <td style={{ padding: "4px 8px", textAlign: "right", color: "#b45309" }}>${Number(fomentoDetalle.gasto_adm).toFixed(2)}</td>
                              <td style={{ padding: "4px 8px", textAlign: "right" }}>${(Number(fomentoDetalle.total_pedido)+Number(fomentoDetalle.gasto_adm)).toFixed(2)}</td>
                              <td></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>

                    {/* Formulario nueva entrega */}
                    <details open style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px" }}>
                      <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--c-brand)" }}>+ Registrar Entrega</summary>
                      <form onSubmit={submitFomentoEntrega} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Fecha
                          <input required type="date" value={fomentoEntregaForm.fecha}
                            onChange={e => setFomentoEntregaForm(p => ({...p, fecha: e.target.value}))}
                            style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} />
                        </label>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Valor ($)
                          <input required type="number" step="0.01" min="0.01" value={fomentoEntregaForm.valor}
                            onChange={e => setFomentoEntregaForm(p => ({...p, valor: e.target.value}))}
                            style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} placeholder="0.00" />
                        </label>
                        {fomentoEntregaForm.valor && fomentoEntregaForm.fecha && (
                          <div style={{ fontSize: 12, color: "var(--c-muted)", background: "#fffbeb", borderRadius: 6, padding: "4px 8px" }}>
                            {(() => {
                              const dias = Math.max(0, Math.floor((Date.now() - new Date(fomentoEntregaForm.fecha).getTime()) / 86400000));
                              const renta = Number(fomentoDetalle.renta ?? 0.07);
                              const interes = Number(fomentoEntregaForm.valor) * renta / 30 * dias;
                              return `Días: ${dias} | Tasa: ${(renta*100).toFixed(2)}% | Interés: $${interes.toFixed(2)} | Total: $${(Number(fomentoEntregaForm.valor) + interes).toFixed(2)}`;
                            })()}
                          </div>
                        )}
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Concepto
                          <input value={fomentoEntregaForm.concepto}
                            onChange={e => setFomentoEntregaForm(p => ({...p, concepto: e.target.value}))}
                            style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} placeholder="Opcional" />
                        </label>
                        <button type="submit" style={{ background: "var(--c-brand)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 700 }}>
                          Registrar Entrega
                        </button>
                      </form>
                    </details>

                    {/* Pagos recibidos */}
                    <details style={{ border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", marginTop: 10 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 600, color: "#16a34a" }}>💵 Pagos Recibidos ({fomentoDetalle.pagos?.length ?? 0})</summary>

                      {/* Lista de pagos */}
                      {(fomentoDetalle.pagos?.length ?? 0) > 0 && (
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8, marginBottom: 10 }}>
                          <thead>
                            <tr style={{ background: "#dcfce7" }}>
                              <th style={{ padding: "4px 8px", textAlign: "left" }}>Fecha</th>
                              <th style={{ padding: "4px 8px", textAlign: "right" }}>Valor</th>
                              <th style={{ padding: "4px 8px", textAlign: "left" }}>Concepto</th>
                              <th style={{ padding: "4px 8px" }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {fomentoDetalle.pagos.map((p, i) => (
                              <tr key={p.id} style={{ background: i % 2 === 0 ? "#fff" : "#f0fdf4" }}>
                                <td style={{ padding: "4px 8px" }}>{p.fecha?.slice(0,10)}</td>
                                <td style={{ padding: "4px 8px", textAlign: "right", color: "#16a34a", fontWeight: 700 }}>${Number(p.valor).toFixed(2)}</td>
                                <td style={{ padding: "4px 8px" }}>{p.concepto ?? "—"}</td>
                                <td style={{ padding: "4px 8px" }}>
                                  <button type="button" title="Eliminar"
                                    onClick={() => deleteFomentoPago(fomentoDetalle.id, p.id).catch(() => undefined)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 13 }}>✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ fontWeight: 700, borderTop: "2px solid #bbf7d0" }}>
                              <td style={{ padding: "4px 8px" }}>TOTAL</td>
                              <td style={{ padding: "4px 8px", textAlign: "right", color: "#16a34a" }}>
                                ${fomentoDetalle.pagos.reduce((s, p) => s + Number(p.valor), 0).toFixed(2)}
                              </td>
                              <td colSpan={2}></td>
                            </tr>
                          </tfoot>
                        </table>
                      )}

                      {/* Formulario pago */}
                      <form onSubmit={submitFomentoPago} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Fecha
                          <input required type="date" value={fomentoPagoForm.fecha}
                            onChange={e => setFomentoPagoForm(p => ({...p, fecha: e.target.value}))}
                            style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} />
                        </label>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Monto recibido ($)
                          <input required type="number" step="0.01" min="0.01" value={fomentoPagoForm.valor}
                            onChange={e => setFomentoPagoForm(p => ({...p, valor: e.target.value}))}
                            style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} placeholder="0.00" />
                        </label>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Concepto
                          <input value={fomentoPagoForm.concepto}
                            onChange={e => setFomentoPagoForm(p => ({...p, concepto: e.target.value}))}
                            style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 2 }} placeholder="Abono / pago total" />
                        </label>
                        <button type="submit" style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 700 }}>
                          💵 Registrar Pago
                          {dashboard.current_cash_register && " (entra a caja)"}
                        </button>
                      </form>
                    </details>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, color: "var(--c-muted)", textAlign: "center" }}>
                    <svg width="48" height="48" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, marginBottom: 12 }}>
                      <path d="M8 14V8"/><path d="M5 11l3-3 3 3"/><path d="M2 14h12"/><path d="M4 8C4 5 6 2 8 2s4 3 4 6"/>
                    </svg>
                    <p>Selecciona un fomento de la lista<br/>para ver su detalle y registrar entregas</p>
                  </div>
                )}
              </div>
            </div>

            {fomentoImportModal && fomentoImportModal.open && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
                <div style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 480, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)" }}>
                  <h3 style={{ margin: "0 0 12px", color: fomentoImportModal.isError ? "#dc2626" : "#16a34a" }}>{fomentoImportModal.title}</h3>
                  <div style={{ whiteSpace: "pre-line", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                    {fomentoImportModal.message}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" onClick={() => setFomentoImportModal(null)}
                      style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--c-brand)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                      Cerrar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "Por Cobrar" && (
          <section className="cuentasLayout">
            <div className="cuentasHeader">
              <div>
                <h2 style={{ marginBottom: 2 }}>💵 Cuentas por cobrar</h2>
                <p className="muted" style={{ margin: 0 }}>Clientes que deben dinero por ventas a crédito.</p>
              </div>
              <div className="cuentasTotal cobrar">
                <span>Total por cobrar</span>
                <strong>{money(accountsReceivable.reduce((a, r) => a + Number(r.balance), 0))}</strong>
              </div>
            </div>
            {!dashboard.current_cash_register && (
              <div className="alertBox">Abre una caja para poder registrar cobros.</div>
            )}
            {accountsReceivable.length === 0 ? (
              <div className="emptyState"><div className="emptyIcon">✅</div><p>No hay cuentas por cobrar pendientes</p></div>
            ) : (
              <div className="cuentasGrid">
                {accountsReceivable.map((ar) => (
                  <article key={ar.id} className="cuentaCard cobrar">
                    <div className="cuentaTop">
                      <div>
                        <span className="cuentaLabel">{ar.sale_number ? "Cliente" : "Deudor"}</span>
                        <strong>{ar.customer_name ?? "—"}</strong>
                        {!ar.sale_number && ar.description && (
                          <span className="muted" style={{ display: "block", fontSize: 12 }}>{ar.description}</span>
                        )}
                      </div>
                      <span className="cuentaRef">{ar.sale_number || ""}</span>
                    </div>
                    <div className="cuentaAmounts">
                      <div><span>Monto total</span><b>{money(Number(ar.amount))}</b></div>
                      <div><span>Saldo pendiente</span><b className="pend">{money(Number(ar.balance))}</b></div>
                    </div>
                    <div className="cuentaBar"><div style={{ width: `${((Number(ar.amount) - Number(ar.balance)) / Number(ar.amount)) * 100}%` }} /></div>
                    {/* Abono: puede pagar todo o una parte (deja el saldo). */}
                    <AbonoForm
                      saldo={Number(ar.balance)}
                      disabled={!dashboard.current_cash_register}
                      onAbonar={(monto) => payAccountReceivable(ar.id, monto).catch((e) => addToast(e.message, "error"))}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "Por Pagar" && (
          <section className="cuentasLayout">
            <div className="cuentasHeader">
              <div>
                <h2 style={{ marginBottom: 2 }}>📑 Cuentas por pagar</h2>
                <p className="muted" style={{ margin: 0 }}>Dinero que se debe a agricultores por liquidaciones.</p>
              </div>
              <div className="cuentasTotal pagar">
                <span>Total por pagar</span>
                <strong>{money(cashPayables.reduce((a, p) => a + Number(p.balance), 0))}</strong>
              </div>
            </div>
            {!dashboard.current_cash_register && (
              <div className="alertBox">Abre una caja para poder registrar pagos.</div>
            )}
            {cashPayables.length === 0 ? (
              <div className="emptyState"><div className="emptyIcon">✅</div><p>No hay cuentas por pagar pendientes</p></div>
            ) : (
              <div className="cuentasGrid">
                {groupPayables(cashPayables).map((grupo) => {
                  const total = grupo.items.reduce((a, p) => a + Number(p.amount), 0);
                  const pendiente = grupo.items.reduce((a, p) => a + Number(p.balance), 0);
                  const percentPaid = total > 0 ? ((total - pendiente) / total) * 100 : 0;
                  const varios = grupo.items.length > 1;
                  return (
                    <article key={grupo.key} className="cuentaCard pagar">
                      <div className="cuentaTop">
                        <div>
                          <span className="cuentaLabel">Agricultor</span>
                          <strong>{grupo.items[0].farmer_name}</strong>
                        </div>
                        <span className="cuentaRef">
                          {grupo.items[0].liquidation_number ? `Liq. ${grupo.items[0].liquidation_number}` : ""}
                          {varios ? ` · ${grupo.items.length} ingresos` : ""}
                        </span>
                      </div>
                      <div className="cuentaAmounts">
                        <div><span>Total</span><b>{money(total)}</b></div>
                        <div><span>Pendiente</span><b className="pend">{money(pendiente)}</b></div>
                      </div>
                      <div className="cuentaBar"><div style={{ width: `${percentPaid}%` }} /></div>
                      {/* Un solo pago por el total: el sistema lo reparte entre
                          los ingresos (del más viejo al más nuevo). */}
                      <PayablePayForm
                        key={`${grupo.key}-${pendiente.toFixed(2)}`}
                        payable={{ ...grupo.items[0], amount: total, balance: pendiente }}
                        onPay={(amount) =>
                          pagarGrupoCuentas(grupo.items.map((ap) => ap.id), amount).catch((e) => addToast(e.message, "error"))
                        }
                      />
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "Servicio Pilado" && (() => {
          const clientes = accionistas.filter((a) => a.id !== CEYRO_ID);
          const previewTotal = round2(Number(piladoForm.quintals || 0) * Number(piladoForm.rate_per_qq || 0));
          return (
          <section className="panelGrid">
            <form className="formPanel" onSubmit={(e) => submitPilado(e).catch((err) => addToast(err.message, "error"))}>
              <h2>🌾 Registrar servicio de pilado</h2>
              <p className="muted">CEYRO le presta el servicio de secado + pilado a otro accionista y le cobra por quintal. Genera el ingreso para CEYRO y la cuenta por pagar del accionista.</p>
              <label><span>Fecha</span>
                <input type="date" value={piladoForm.service_date} onChange={(e) => { const v = e.target.value; setPiladoForm({ ...piladoForm, service_date: v }); if (piladoForm.client_kind === "accionista" && piladoForm.client_accionista_id) autofillPiladoRate(piladoForm.client_accionista_id, v); }} />
              </label>
              <label><span>Tipo de cliente</span>
                <select value={piladoForm.client_kind} onChange={(e) => setPiladoForm({ ...piladoForm, client_kind: e.target.value as "accionista" | "externo" })}>
                  <option value="accionista">Accionista</option>
                  <option value="externo">Cliente externo</option>
                </select>
              </label>
              {piladoForm.client_kind === "accionista" ? (
                <label><span>Accionista al que le pilaste</span>
                  <select value={piladoForm.client_accionista_id} onChange={(e) => { const v = e.target.value; setPiladoForm({ ...piladoForm, client_accionista_id: v }); autofillPiladoRate(v, piladoForm.service_date); }}>
                    <option value="">Seleccione</option>
                    {clientes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              ) : (
                <label><span>Nombre del cliente externo</span>
                  <input type="text" value={piladoForm.client_name} onChange={(e) => setPiladoForm({ ...piladoForm, client_name: e.target.value })} placeholder="Ej: Juan Pérez" />
                </label>
              )}
              <label><span>Quintales procesados (QQ)</span>
                <input type="number" step="0.01" min="0" value={piladoForm.quintals} onChange={(e) => setPiladoForm({ ...piladoForm, quintals: e.target.value })} />
              </label>
              <label><span>Tarifa por QQ ($)</span>
                <input type="number" step="0.01" min="0" value={piladoForm.rate_per_qq} onChange={(e) => setPiladoForm({ ...piladoForm, rate_per_qq: e.target.value })} />
              </label>
              {tarifaVigenteHint && <p className="muted" style={{ margin: "-4px 0 8px", fontSize: 12 }}>{tarifaVigenteHint}</p>}
              <div className="totalBox" style={{ marginBottom: 10 }}>
                <span>Total a cobrar</span>
                <strong>{money(previewTotal)}</strong>
                <small>{piladoForm.quintals || 0} QQ × ${piladoForm.rate_per_qq || 0}</small>
              </div>
              <button className="primary">Registrar servicio</button>
              {clientes.length === 0 && <p className="muted">Crea los otros accionistas en Configuración → Accionistas.</p>}
            </form>

            <div className="tablePanel">
              <h2>Saldos que deben a CEYRO</h2>
              {piladoBalances.length === 0 ? (
                <div className="emptyState"><div className="emptyIcon">✅</div><p>Nadie debe servicios de pilado.</p></div>
              ) : (
                <table className="cajaTable" style={{ marginTop: 6 }}>
                  <thead><tr><th>Accionista</th><th>Saldo pendiente</th></tr></thead>
                  <tbody>
                    {piladoBalances.map((b) => (
                      <tr key={b.id}><td>{b.name}</td><td><strong style={{ color: "#dc2626" }}>{money(b.saldo)}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h2 style={{ marginTop: 18 }}>Servicios registrados</h2>
              {piladoServices.length === 0 ? (
                <div className="emptyState"><div className="emptyIcon">🌾</div><p>Sin servicios este mes</p></div>
              ) : (
                <table className="cajaTable" style={{ marginTop: 6 }}>
                  <thead><tr><th>Fecha</th><th>Cliente</th><th>QQ</th><th>Tarifa</th><th>Total</th><th>Saldo</th><th /></tr></thead>
                  <tbody>
                    {piladoServices.map((s) => (
                      <tr key={s.id}>
                        <td>{String(s.service_date).slice(0, 10)}</td>
                        <td>{s.cliente}</td>
                        <td>{Number(s.quintals)}</td>
                        <td>${Number(s.rate_per_qq)}</td>
                        <td><strong>{money(Number(s.total))}</strong></td>
                        <td>{Number(s.saldo) > 0 ? <span style={{ color: "#dc2626" }}>{money(Number(s.saldo))}</span> : <span className="chip ok">Pagado</span>}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button type="button" className="btnGhost" onClick={() => loadPiladoReport(s.id).catch((err) => addToast(err.message, "error"))}>Ver informe</button>
                          {Number(s.saldo) > 0 && <button type="button" className="btnGhost" onClick={() => settlePilado(s.id).catch((err) => addToast(err.message, "error"))} style={{ marginLeft: 6 }}>Marcar pagado</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {piladoReport && (
                <div className="modalOverlay" onClick={() => setPiladoReport(null)}>
                  <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
                    <h3>Informe de servicio de pilado</h3>
                    <p className="muted">{new Date(piladoReport.service_date).toLocaleDateString("es-EC")} · {piladoReport.cliente}</p>
                    <table className="cajaTable" style={{ marginTop: 10 }}>
                      <tbody>
                        <tr><td>Total QQ procesados</td><td className="num">{Number(piladoReport.quintals).toFixed(2)} QQ</td></tr>
                        <tr><td>Tarifa por QQ</td><td className="num">${Number(piladoReport.rate_per_qq).toFixed(2)}</td></tr>
                        <tr><td>Total a cobrar</td><td className="num"><strong>{money(Number(piladoReport.total))}</strong></td></tr>
                        <tr><td>Saldo pendiente</td><td className="num">{Number(piladoReport.saldo) > 0 ? money(Number(piladoReport.saldo)) : "Pagado"}</td></tr>
                      </tbody>
                    </table>

                    {Array.isArray(piladoReport.detalle) && piladoReport.detalle.length > 0 && (
                      <>
                        <h4 style={{ margin: "16px 0 6px" }}>Desglose por presentación</h4>
                        <table className="cajaTable">
                          <thead><tr><th>Presentación</th><th className="num">QQ</th><th className="num">Precio/QQ</th><th className="num">Subtotal</th></tr></thead>
                          <tbody>
                            {piladoReport.detalle.map((d, i) => (
                              <tr key={i}>
                                <td>{d.presentacion}</td>
                                <td className="num">{Number(d.quintales).toFixed(2)}</td>
                                <td className="num">${Number(d.precio_total_qq).toFixed(2)}</td>
                                <td className="num">{money(Number(d.subtotal))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}

                    {Array.isArray(piladoReport.outputs) && piladoReport.outputs.filter((o) => !o.is_byproduct).length > 0 && (
                      <>
                        <h4 style={{ margin: "16px 0 6px" }}>Producto entregado al cliente</h4>
                        <table className="cajaTable">
                          <thead>
                            <tr>
                              <th>Producto</th>
                              <th className="num">Cantidad</th>
                              <th className="num">Unidad</th>
                            </tr>
                          </thead>
                          <tbody>
                            {piladoReport.outputs.filter((o) => !o.is_byproduct).map((o, i) => (
                              <tr key={i}>
                                <td>{o.product_name}{o.presentation ? ` (${o.presentation})` : ""}</td>
                                <td className="num">{Number(o.quantity).toFixed(2)}</td>
                                <td className="num">{o.unit}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                          Arrocillo, polvillo y merma son retención de la piladora; no forman parte de la entrega al cliente.
                        </p>
                      </>
                    )}

                    {piladoReport.yield && (
                      <>
                        <h4 style={{ margin: "16px 0 6px" }}>Resumen técnico del proceso</h4>
                        <table className="cajaTable">
                          <tbody>
                            {/* Solo la entrega al cliente: se quitaron a petición
                                Cascarilla ingresada, Total de salida, Merma,
                                Rendimiento y QQ de tulas. */}
                            <tr><td>Arroz blanco entregado</td><td className="num">{Number(piladoReport.yield.white_rice_qty).toFixed(2)} {piladoReport.yield.white_rice_unit}</td></tr>
                            <tr><td>Arrocillo 3/4</td><td className="num">{Number(piladoReport.yield.broken_rice_qty).toFixed(2)} QQ</td></tr>
                            <tr><td>Arrocillo fino</td><td className="num">{Number(piladoReport.yield.fine_broken_rice_qty).toFixed(2)} QQ</td></tr>
                            <tr><td>Polvillo / afrecho</td><td className="num">{Number(piladoReport.yield.bran_qty).toFixed(2)} QQ</td></tr>
                          </tbody>
                        </table>
                      </>
                    )}

                    {piladoReport.notes && <p className="muted" style={{ marginTop: 12 }}>Notas: {piladoReport.notes}</p>}

                    <div className="buttonRow" style={{ marginTop: 16 }}>
                      <button type="button" className="primary" onClick={() => window.print()}>Imprimir</button>
                      <button type="button" onClick={() => setPiladoReport(null)}>Cerrar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
          );
        })()}

        {activeTab === "Seleccion" && (() => {
          const activeAcc = accionistas.find((a) => a.id === activeAccionistaId);
          const puedeEnvejecer = !!activeAcc?.puede_envejecer;
          const inputStyle = { display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", marginTop: 3, fontSize: 12 } as const;
          // Productos que viven en producto terminado (terminados + subproductos):
          // entran y salen del proceso. Se ordenan por nombre.
          const selectableProducts = products
            .filter((p) => ["FINISHED_GOOD", "BYPRODUCT"].includes(p.product_type) && p.is_active !== false)
            .sort((a, b) => a.name.localeCompare(b.name));
          // Reglas del negocio: sale 0.11, corriente, arrocillo 3/4 y fino; regresa
          // lo mismo (el 0.11 o corriente que se envió, los arrocillos) más el rechazo.
          const INPUT_CODES = ["ARROZ-PILADO-011", "ARROZ-PILADO-CORRIENTE", "ARROCILLO-34", "ARROCILLO-FINO"];
          const OUTPUT_CODES = [...INPUT_CODES, "POLVILLO", "RECHAZO"];
          const inputProducts = selectableProducts.filter((p) => INPUT_CODES.includes(p.code));
          const outputProducts = selectableProducts.filter((p) => OUTPUT_CODES.includes(p.code));
          // Siempre sale de la bodega de producto terminado.
          const sourceWarehouseId = finishedWarehouse?.id ?? "";
          const availableFor = (pid: string, wid: string) =>
            stock.filter((r) => r.product_id === pid && r.warehouse_id === wid).reduce((s, r) => s + Number(r.quantity), 0);
          const defaultRate = selectionForm.service_type === "ENVEJECIMIENTO" ? selectionRates.envejecimiento_rate : selectionRates.seleccion_rate;
          const effectiveRate = selectionForm.rate_per_qq === "" ? defaultRate : Number(selectionForm.rate_per_qq);
          const inputsTotal = selectionForm.inputs.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
          const costoN = round2(inputsTotal * (effectiveRate || 0));

          const setInputLine = (i: number, patch: Partial<LineDraft>) =>
            setSelectionForm((f) => ({ ...f, inputs: f.inputs.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
          const addInputLine = () => setSelectionForm((f) => ({ ...f, inputs: [...f.inputs, { ...emptyLine }] }));
          const removeInputLine = (i: number) => setSelectionForm((f) => ({ ...f, inputs: f.inputs.length > 1 ? f.inputs.filter((_, idx) => idx !== i) : f.inputs }));
          const setOutLine = (i: number, patch: Partial<LineDraft>) =>
            setFinishOutputs((o) => o.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
          const addOutLine = () => setFinishOutputs((o) => [...o, { ...emptyLine }]);
          const removeOutLine = (i: number) => setFinishOutputs((o) => (o.length > 1 ? o.filter((_, idx) => idx !== i) : o));
          const openFinish = (batchId: string) => { setFinishingBatchId(batchId); setFinishOutputs([{ ...emptyLine }]); };

          const inProcess = selectionBatches.filter((b) => b.status === "IN_PROCESS");
          const completed = selectionBatches.filter((b) => b.status === "COMPLETED");

          return (
          <section className="panelGrid">
            <form className="formPanel" onSubmit={(e) => submitStartBatch(e).catch((err) => addToast(err.message, "error"))}>
              <h2>📤 Mandar a selectar</h2>
              <p className="muted">Registra lo que sale de bodega a selectar/envejecer (varios productos). Sale del inventario ahora y genera la cuenta por pagar. Cuando regrese lo procesado, lo cierras en «En proceso».</p>
              <label><span>Fecha de envío</span>
                <input type="date" value={selectionForm.service_date} onChange={(e) => setSelectionForm({ ...selectionForm, service_date: e.target.value })} />
              </label>
              <label><span>Tipo de servicio</span>
                <select value={selectionForm.service_type} onChange={(e) => setSelectionForm({ ...selectionForm, service_type: e.target.value as "SELECCION" | "ENVEJECIMIENTO", rate_per_qq: "" })}>
                  <option value="SELECCION">Selección (limpiar impureza)</option>
                  {puedeEnvejecer && <option value="ENVEJECIMIENTO">Envejecido</option>}
                </select>
              </label>
              {!puedeEnvejecer && <p className="muted" style={{ marginTop: -4 }}>Este accionista no está habilitado para envejecer. Se habilita en Configuración → Accionistas.</p>}
              <label><span>Persona externa (quien lo hace)</span>
                <select value={selectionForm.provider_id} onChange={(e) => setSelectionForm({ ...selectionForm, provider_id: e.target.value })}>
                  <option value="">Seleccione</option>
                  {selectionProviders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label><span>Bodega de donde sale</span>
                <input type="text" readOnly value={finishedWarehouse?.name ?? "Bodega Producto Terminado"} style={{ background: "#f3f4f6", color: "var(--c-muted)" }} />
              </label>

              <div style={{ marginTop: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Productos que salen a selectar</span>
                {selectionForm.inputs.map((line, i) => {
                  const disp = line.product_id && sourceWarehouseId ? availableFor(line.product_id, sourceWarehouseId) : null;
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px auto", gap: 6, alignItems: "center", marginTop: 6 }}>
                      <select value={line.product_id} onChange={(e) => setInputLine(i, { product_id: e.target.value })} style={inputStyle}>
                        <option value="">Producto…</option>
                        {inputProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="number" step="0.01" min="0" placeholder="QQ" value={line.quantity} onChange={(e) => setInputLine(i, { quantity: e.target.value })} style={inputStyle} />
                      <button type="button" onClick={() => removeInputLine(i)} title="Quitar" style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                      {disp !== null && <small style={{ gridColumn: "1 / -1", color: disp + 0.001 < (Number(line.quantity) || 0) ? "#dc2626" : "var(--c-muted)", marginTop: -2 }}>Disponible: {disp.toFixed(2)} QQ</small>}
                    </div>
                  );
                })}
                <button type="button" onClick={addInputLine} style={{ marginTop: 8, background: "transparent", border: "1px dashed #cbd5e1", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Agregar producto</button>
              </div>

              <label style={{ marginTop: 10 }}><span>Tarifa por QQ ($)</span>
                <input type="number" step="0.01" min="0" value={selectionForm.rate_per_qq} placeholder={`Por defecto ${defaultRate}`} onChange={(e) => setSelectionForm({ ...selectionForm, rate_per_qq: e.target.value })} />
              </label>
              <label><span>Notas (opcional)</span>
                <input type="text" value={selectionForm.notes} onChange={(e) => setSelectionForm({ ...selectionForm, notes: e.target.value })} placeholder="Ej: observación" />
              </label>
              <div className="totalBox" style={{ marginBottom: 4 }}>
                <span>Costo a pagar</span>
                <strong>{money(costoN)}</strong>
                <small>{round2(inputsTotal)} QQ × ${effectiveRate || 0}</small>
              </div>
              <button className="primary">Enviar a selectar</button>
              {selectionProviders.length === 0 && <p className="muted">Primero agrega la persona externa en el panel de la derecha.</p>}
            </form>

            <div className="tablePanel">
              <h2>⏳ En proceso (fuera de bodega)</h2>
              {inProcess.length === 0 ? (
                <div className="emptyState"><div className="emptyIcon">📦</div><p>Nada en proceso ahora</p></div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {inProcess.map((b) => (
                    <div key={b.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                        <div>
                          <strong>{b.batch_number}</strong> · {b.service_type === "ENVEJECIMIENTO" ? "Envejecido" : "Selección"} · {b.provider_name}
                          <div className="muted" style={{ fontSize: 12 }}>{String(b.service_date).slice(0, 10)} · {Number(b.input_qq).toFixed(2)} QQ enviados · costo {money(Number(b.total_cost))}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, marginTop: 6 }}>
                        {b.inputs.map((l, idx) => <span key={idx} className="chip" style={{ marginRight: 4 }}>{l.product_name}: {Number(l.quantity).toFixed(2)}</span>)}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        {finishingBatchId === b.id ? (
                          <button type="button" className="btnGhost" onClick={() => setFinishingBatchId(null)}>Cerrar formulario</button>
                        ) : (
                          <button type="button" className="primary" style={{ padding: "6px 12px" }} onClick={() => openFinish(b.id)}>📥 Registrar lo que regresó</button>
                        )}
                        <button type="button" className="btnGhost" style={{ color: "#dc2626" }} onClick={() => cancelBatch(b.id).catch((err) => addToast(err.message, "error"))}>Cancelar</button>
                      </div>

                      {finishingBatchId === b.id && (
                        <div style={{ marginTop: 10, background: "#f9fafb", borderRadius: 8, padding: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>Productos que regresaron</span>
                          {finishOutputs.map((line, i) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px auto auto", gap: 6, alignItems: "center", marginTop: 6 }}>
                              <select value={line.product_id} onChange={(e) => setOutLine(i, { product_id: e.target.value })} style={inputStyle}>
                                <option value="">Producto…</option>
                                {outputProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              <input type="number" step="0.01" min="0" placeholder="QQ" value={line.quantity} onChange={(e) => setOutLine(i, { quantity: e.target.value })} style={inputStyle} />
                              <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3 }} title="Marca si es el rechazo">
                                <input type="checkbox" checked={!!line.is_reject} onChange={(e) => setOutLine(i, { is_reject: e.target.checked })} /> rechazo
                              </label>
                              <button type="button" onClick={() => removeOutLine(i)} title="Quitar" style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                            <button type="button" onClick={addOutLine} style={{ background: "transparent", border: "1px dashed #cbd5e1", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Agregar</button>
                            <small className="muted">Total regresa: {round2(finishOutputs.reduce((s, l) => s + (Number(l.quantity) || 0), 0))} QQ · merma {round2(Number(b.input_qq) - finishOutputs.reduce((s, l) => s + (Number(l.quantity) || 0), 0))} QQ</small>
                          </div>
                          <button type="button" className="primary" style={{ marginTop: 8 }} onClick={() => submitFinishBatch(b.id).catch((err) => addToast(err.message, "error"))}>Guardar e ingresar al inventario</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <h2 style={{ marginTop: 18 }}>👤 Personas externas</h2>
              <form onSubmit={(e) => submitNewProvider(e).catch((err) => addToast(err.message, "error"))} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end", background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Nombre
                  <input value={newProviderForm.name} onChange={(e) => setNewProviderForm({ ...newProviderForm, name: e.target.value })} placeholder="Ej: Juan Pérez" style={inputStyle} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Teléfono
                  <input value={newProviderForm.phone} onChange={(e) => setNewProviderForm({ ...newProviderForm, phone: e.target.value })} placeholder="Opcional" style={inputStyle} />
                </label>
                <button type="submit" style={{ padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 700, background: "var(--c-brand)", color: "#fff", fontSize: 12 }}>+ Agregar</button>
              </form>
              {selectionProviders.length > 0 && (
                <table className="cajaTable" style={{ marginTop: 8 }}>
                  <thead><tr><th>Nombre</th><th>Teléfono</th></tr></thead>
                  <tbody>{selectionProviders.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.phone ?? "—"}</td></tr>)}</tbody>
                </table>
              )}

              <h2 style={{ marginTop: 18 }}>💲 Tarifas por defecto</h2>
              <form onSubmit={(e) => saveSelectionRates(e).catch((err) => addToast(err.message, "error"))} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end", background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Selección ($/QQ)
                  <input type="number" step="0.01" min="0" value={selectionRatesForm.seleccion_rate} onChange={(e) => setSelectionRatesForm({ ...selectionRatesForm, seleccion_rate: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Envejecido ($/QQ)
                  <input type="number" step="0.01" min="0" value={selectionRatesForm.envejecimiento_rate} onChange={(e) => setSelectionRatesForm({ ...selectionRatesForm, envejecimiento_rate: e.target.value })} style={inputStyle} />
                </label>
                <button type="submit" style={{ padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 700, background: "var(--c-brand)", color: "#fff", fontSize: 12 }}>Guardar</button>
              </form>

              <h2 style={{ marginTop: 18 }}>✅ Completados</h2>
              {completed.length === 0 ? (
                <div className="emptyState"><div className="emptyIcon">🧹</div><p>Sin lotes completados aún</p></div>
              ) : (
                <table className="cajaTable" style={{ marginTop: 6 }}>
                  <thead><tr><th>#</th><th>Fecha</th><th>Persona</th><th>Entró</th><th>Regresó</th><th>Merma</th><th>Costo</th><th>Saldo</th></tr></thead>
                  <tbody>
                    {completed.map((b) => (
                      <tr key={b.id}>
                        <td>{b.batch_number}</td>
                        <td>{String(b.service_date).slice(0, 10)}</td>
                        <td>{b.provider_name}</td>
                        <td>{Number(b.input_qq).toFixed(2)}</td>
                        <td>{Number(b.output_qq).toFixed(2)}</td>
                        <td>{Number(b.merma_qq).toFixed(2)}</td>
                        <td><strong>{money(Number(b.total_cost))}</strong></td>
                        <td>{Number(b.saldo) > 0 ? <span style={{ color: "#dc2626" }}>{money(Number(b.saldo))}</span> : <span className="chip ok">Pagado</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ marginTop: 8 }}>El pago a la persona externa se registra en <strong>Por Pagar</strong>.</p>
            </div>
          </section>
          );
        })()}

        {activeTab === "Cuadrilla" && (() => {
          const selAct = cuadActivities.find((a) => a.id === cuadEntryForm.activity_id);
          const previewSubtotal = selAct ? round2(Number(cuadEntryForm.quantity || 0) * Number(selAct.unit_rate)) : 0;
          return (
          <section className="cuentasLayout">
            <nav className="cajaSubNav">
              <button type="button" className={cuadView === "registro" ? "active" : ""} onClick={() => setCuadView("registro")}>📝 Registro</button>
              <button type="button" className={cuadView === "resumen" ? "active" : ""} onClick={() => setCuadView("resumen")}>👥 Resumen y anticipos</button>
              <button type="button" className={cuadView === "actividades" ? "active" : ""} onClick={() => setCuadView("actividades")}>🏷️ Actividades y tarifas</button>
            </nav>

            <div className="cajaSubNav" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12 }}>Desde<input type="date" value={cuadFrom} onChange={(e) => setCuadFrom(e.target.value)} style={{ display: "block", padding: "5px 8px", borderRadius: 6, border: "1px solid #d1d5db" }} /></label>
              <label style={{ fontSize: 12 }}>Hasta<input type="date" value={cuadTo} onChange={(e) => setCuadTo(e.target.value)} style={{ display: "block", padding: "5px 8px", borderRadius: 6, border: "1px solid #d1d5db" }} /></label>
              <button type="button" className="primary" onClick={() => refreshCuadrilla().catch(() => undefined)}>Ver</button>
            </div>

            {cuadView === "registro" && (
              <section className="panelGrid">
                <form className="formPanel" onSubmit={(e) => submitCuadEntry(e).catch((err) => addToast(err.message, "error"))}>
                  <h2>📝 Registrar trabajo</h2>
                  <label><span>Fecha</span>
                    <input type="date" value={cuadEntryForm.work_date} onChange={(e) => setCuadEntryForm({ ...cuadEntryForm, work_date: e.target.value })} />
                  </label>
                  <label><span>Actividad</span>
                    <select value={cuadEntryForm.activity_id} onChange={(e) => setCuadEntryForm({ ...cuadEntryForm, activity_id: e.target.value })}>
                      <option value="">Seleccione</option>
                      {cuadActivities.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} — ${Number(a.unit_rate)}</option>
                      ))}
                    </select>
                  </label>
                  <label><span>Trabajador (nombre o apodo)</span>
                    <input type="text" value={cuadEntryForm.worker_name} onChange={(e) => setCuadEntryForm({ ...cuadEntryForm, worker_name: e.target.value })} placeholder="Ej: paola LIRA" />
                  </label>
                  <label><span>Cantidad (QQ, sacos, etc.)</span>
                    <input type="number" step="0.01" min="0" value={cuadEntryForm.quantity} onChange={(e) => setCuadEntryForm({ ...cuadEntryForm, quantity: e.target.value })} />
                  </label>
                  <div className="totalBox" style={{ marginBottom: 10 }}>
                    <span>Subtotal</span>
                    <strong>{money(previewSubtotal)}</strong>
                    <small>{selAct ? `${cuadEntryForm.quantity || 0} × $${Number(selAct.unit_rate)}` : "elige actividad"}</small>
                  </div>
                  <button className="primary">Agregar</button>
                </form>

                <div className="tablePanel">
                  <h2>Registros del período</h2>
                  <div className="totalBox" style={{ marginBottom: 10 }}>
                    <span>Total del período</span>
                    <strong>{money(cuadEntriesTotal)}</strong>
                    <small>{cuadEntries.length} registro(s)</small>
                  </div>
                  {cuadEntries.length === 0 ? (
                    <div className="emptyState"><div className="emptyIcon">📝</div><p>Sin registros en este período</p></div>
                  ) : (
                    <table className="cajaTable" style={{ marginTop: 6 }}>
                      <thead><tr><th>Fecha</th><th>Actividad</th><th>Trabajador</th><th>Cant.</th><th>Valor</th><th>Subtotal</th><th /></tr></thead>
                      <tbody>
                        {cuadEntries.map((en) => (
                          <tr key={en.id}>
                            <td>{String(en.work_date).slice(0, 10)}</td>
                            <td>{en.activity_name}</td>
                            <td>{en.worker_name || "—"}</td>
                            <td>{Number(en.quantity)}</td>
                            <td>${Number(en.unit_rate)}</td>
                            <td><strong>{money(Number(en.subtotal))}</strong></td>
                            <td style={{ textAlign: "right" }}>
                              <button type="button" className="btnGhost" onClick={() => deleteCuadEntry(en.id).catch((err) => addToast(err.message, "error"))}>Borrar</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            )}

            {cuadView === "resumen" && (
              <section className="panelGrid">
                <div className="tablePanel">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h2 style={{ margin: 0 }}>👥 Resumen por persona</h2>
                    <button type="button" className="btnGhost" onClick={() => printCuadrillaSummary()}>🖨️ Imprimir</button>
                  </div>
                  {!cuadSummary || cuadSummary.rows.length === 0 ? (
                    <div className="emptyState"><div className="emptyIcon">👥</div><p>Sin datos en este período</p></div>
                  ) : (
                    <>
                      <table className="cajaTable" style={{ marginTop: 6 }}>
                        <thead><tr><th>Trabajador</th><th>Trabajos</th><th>Ganado</th><th>Anticipos</th><th>Neto a pagar</th></tr></thead>
                        <tbody>
                          {cuadSummary.rows.map((r) => (
                            <tr key={r.worker_name || "(sin nombre)"}>
                              <td>{r.worker_name || "(sin nombre)"}</td>
                              <td>{r.entradas}</td>
                              <td>{money(r.total)}</td>
                              <td style={{ color: r.anticipos > 0 ? "#dc2626" : undefined }}>{r.anticipos > 0 ? "−" + money(r.anticipos) : "—"}</td>
                              <td><strong>{money(r.neto)}</strong></td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ fontWeight: 700, borderTop: "2px solid #e5e7eb" }}>
                            <td colSpan={2}>TOTALES</td>
                            <td>{money(cuadSummary.total_general)}</td>
                            <td>{cuadSummary.total_anticipos > 0 ? "−" + money(cuadSummary.total_anticipos) : "—"}</td>
                            <td>{money(cuadSummary.total_neto)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </>
                  )}
                </div>

                <div className="formPanel">
                  <h2>💸 Registrar anticipo</h2>
                  <form onSubmit={(e) => submitCuadAdvance(e).catch((err) => addToast(err.message, "error"))}>
                    <label><span>Trabajador</span>
                      <input type="text" value={cuadAdvanceForm.worker_name} onChange={(e) => setCuadAdvanceForm({ ...cuadAdvanceForm, worker_name: e.target.value })} placeholder="Nombre o apodo" />
                    </label>
                    <label><span>Monto</span>
                      <input type="number" step="0.01" min="0" value={cuadAdvanceForm.amount} onChange={(e) => setCuadAdvanceForm({ ...cuadAdvanceForm, amount: e.target.value })} />
                    </label>
                    <label><span>Concepto (opcional)</span>
                      <input type="text" value={cuadAdvanceForm.concept} onChange={(e) => setCuadAdvanceForm({ ...cuadAdvanceForm, concept: e.target.value })} placeholder="Ej: arroz, préstamo" />
                    </label>
                    <button className="primary">Registrar anticipo</button>
                  </form>

                  <h3 style={{ marginTop: 16 }}>Anticipos pendientes</h3>
                  {cuadAdvances.length === 0 ? (
                    <p className="muted">No hay anticipos pendientes.</p>
                  ) : (
                    <table className="cajaTable" style={{ marginTop: 6 }}>
                      <thead><tr><th>Trabajador</th><th>Saldo</th><th>Concepto</th><th /></tr></thead>
                      <tbody>
                        {cuadAdvances.map((a) => (
                          <tr key={a.id}>
                            <td>{a.worker_name}</td>
                            <td><strong>{money(Number(a.balance))}</strong></td>
                            <td className="muted">{a.concept ?? "—"}</td>
                            <td style={{ textAlign: "right" }}>
                              <button type="button" className="btnGhost" onClick={() => settleCuadAdvance(a.id).catch((err) => addToast(err.message, "error"))}>Saldar</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            )}

            {cuadView === "actividades" && (
              <section className="panelGrid">
                <form className="formPanel" onSubmit={(e) => createActivity(e).catch((err) => addToast(err.message, "error"))}>
                  <h2>🏷️ Nueva actividad</h2>
                  <p className="muted">Agrega una actividad con su valor unitario. Si ya existe, actualiza su tarifa.</p>
                  <label><span>Nombre</span>
                    <input type="text" value={newActivityForm.name} onChange={(e) => setNewActivityForm({ ...newActivityForm, name: e.target.value })} placeholder="Ej: ENSACADO" />
                  </label>
                  <label><span>Valor unitario ($)</span>
                    <input type="number" step="0.01" min="0" value={newActivityForm.unit_rate} onChange={(e) => setNewActivityForm({ ...newActivityForm, unit_rate: e.target.value })} />
                  </label>
                  <button className="primary">Guardar actividad</button>
                </form>

                <div className="tablePanel">
                  <h2>Actividades y tarifas ({cuadActivities.length})</h2>
                  <table className="cajaTable" style={{ marginTop: 6 }}>
                    <thead><tr><th>Actividad</th><th>Valor unitario</th></tr></thead>
                    <tbody>
                      {cuadActivities.map((a) => (
                        <tr key={a.id}>
                          <td>{a.name}</td>
                          <td>
                            <input
                              type="number" step="0.01" min="0" defaultValue={Number(a.unit_rate)}
                              style={{ width: 90, padding: "4px 6px", borderRadius: 6, border: "1px solid #d1d5db" }}
                              onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(a.unit_rate)) updateActivityRate(a.id, v).catch((err) => addToast(err.message, "error")); }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted" style={{ marginTop: 10 }}>Cambia una tarifa escribiendo el nuevo valor y saliendo del casillero. Los registros ya hechos conservan la tarifa que tenían.</p>
                </div>
              </section>
            )}
          </section>
          );
        })()}

        {activeTab === "Nomina" && (
          <section className="cuentasLayout">
            <nav className="cajaSubNav">
              <button type="button" className={nominaView === "semana" ? "active" : ""} onClick={() => setNominaView("semana")}>📅 Semana</button>
              <button type="button" className={nominaView === "historial" ? "active" : ""} onClick={() => { setNominaView("historial"); loadNominaHistory().catch(() => undefined); }}>📜 Historial</button>
            </nav>

            {nominaView === "semana" && (<>
            <div className="reportToolbar">
              <div>
                <h2 style={{ marginBottom: 2 }}>👷 Nómina · Pilador y Estibador</h2>
                <p className="muted" style={{ margin: 0 }}>Pagos calculados automáticamente de lo que sale de Producción, según las tarifas.</p>
              </div>
              <div className="reportDates">
                <label><span>Desde</span><input type="date" value={nominaFrom} max={nominaTo} onChange={(e) => setNominaFrom(e.target.value)} /></label>
                <label><span>Hasta</span><input type="date" value={nominaTo} min={nominaFrom} onChange={(e) => setNominaTo(e.target.value)} /></label>
                <button type="button" className="primary" disabled={nominaBusy} onClick={() => refreshNomina().catch(() => undefined)}>{nominaBusy ? "Cargando…" : "Ver"}</button>
              </div>
              {nominaRows.length > 0 && (
                <div className="reportExportBtns">
                  <button type="button" className="btnSecondary" onClick={() => { const e = nominaExportData(); printReport(e.title, e.headers, e.rows, e.totals); }}>🖨 Imprimir</button>
                  <button type="button" className="btnSecondary" onClick={() => { const e = nominaExportData(); exportReportCsv(e.headers, e.rows, `nomina_${nominaFrom}_${nominaTo}.csv`); }}>📥 Excel</button>
                </div>
              )}
            </div>

            {!dashboard.current_cash_register && nominaRows.some((r) => (r.pending_amount ?? 0) > 0) && (
              <div className="alertBox">Abre una caja para poder registrar los pagos.</div>
            )}

            {nominaRows.length === 0 ? (
              <div className="emptyState"><div className="emptyIcon">👷</div><p>No hay pagos de trabajadores en el período. Se generan al cerrar cada pilada en Producción.</p></div>
            ) : (
              <div className="tablePanel">
                <div style={{ overflowX: "auto" }}>
                  <table className="cajaTable">
                    <thead>
                      <tr>
                        <th>Rol</th><th>Trabajador</th>
                        <th className="num">Reg.</th><th className="num">QQ</th><th className="num">Tulas</th><th className="num">Sacas</th>
                        <th className="num">Ganó</th><th className="num">Anticipos</th><th className="num">A pagar</th><th className="num">Pagado</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {nominaRows.map((r, i) => {
                        const pending = r.pending_amount ?? 0;
                        const toPay = r.to_pay ?? pending;
                        return (
                          <tr key={i}>
                            <td><span className={r.worker_role === "PILADOR" ? "chip info" : r.worker_role === "ESTIBADOR" ? "chip ok" : r.worker_role === "POLVILLO" ? "chip warn" : "chip warn"}>{r.worker_role === "PILADOR" ? "Pilador" : r.worker_role === "ESTIBADOR" ? "Estibador" : r.worker_role === "POLVILLO" ? "Polvillo" : "Secador"}</span></td>
                            <td style={{ fontWeight: 600 }}>{r.worker_name}</td>
                            <td className="num">{r.cnt}</td>
                            <td className="num">{Number(r.qq).toFixed(2)}</td>
                            <td className="num">{Number(r.tulas ?? 0).toFixed(0)}</td>
                            <td className="num">{Number(r.sacas).toFixed(0)}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{money(r.base_amount)}</td>
                            <td className="num" style={{ color: (r.advances ?? 0) > 0 ? "var(--c-danger)" : "inherit" }}>{(r.advances ?? 0) > 0 ? `−${money(r.advances)}` : "—"}</td>
                            <td className="num" style={{ fontWeight: 700, color: toPay > 0 ? "var(--c-danger)" : "var(--c-success)" }}>{pending > 0 ? money(toPay) : "—"}</td>
                            <td className="num">{money(r.paid_amount ?? 0)}</td>
                            <td className="num" style={{ whiteSpace: "nowrap" }}>
                              <button type="button" className="btnGhost" title="Ver detalle del cálculo" onClick={() => loadNominaPaymentDetail(r)}>🔍</button>
                              <button type="button" className="btnGhost" title="Imprimir recibo" style={{ marginLeft: 6 }} onClick={() => printWorkerReceipt(r).catch(() => undefined)}>🧾</button>
                              {pending > 0 ? (
                                <>
                                  <button type="button" className="btnGhost" style={{ marginLeft: 6 }} onClick={() => registerAdvance(r)}>Anticipo</button>
                                  <button type="button" className="liqAbonoBtn" style={{ marginLeft: 6 }} onClick={() => payWorkerWeek(r)}>💵 Pagar</button>
                                </>
                              ) : <span className="chip ok" style={{ marginLeft: 6 }}>Pagado</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={6} style={{ fontWeight: 700 }}>TOTALES</td>
                        <td className="num" style={{ fontWeight: 700 }}>{money(nominaRows.reduce((a, r) => a + r.base_amount, 0))}</td>
                        <td className="num" style={{ fontWeight: 700, color: "var(--c-danger)" }}>−{money(nominaRows.reduce((a, r) => a + (r.advances ?? 0), 0))}</td>
                        <td className="num" style={{ fontWeight: 700, color: "var(--c-danger)" }}>{money(nominaRows.reduce((a, r) => a + ((r.pending_amount ?? 0) > 0 ? (r.to_pay ?? 0) : 0), 0))}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{money(nominaRows.reduce((a, r) => a + (r.paid_amount ?? 0), 0))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* ── Secador (conectado a Secadora) ── */}
            <div className="panelGrid">
              <div className="tablePanel">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ marginBottom: 2 }}>🌡️ Secador · desde Secadora</h2>
                    <p className="muted" style={{ margin: 0 }}>Detecta los días de secado (guardianía $ + $ por túnel). Los días de solo guardianía se agregan a mano.</p>
                  </div>
                  <button type="button" className="btnSecondary" onClick={() => loadSecadorSuggestions().catch(() => undefined)}>🔍 Detectar de Secadora</button>
                </div>
                {secadorSugg && secadorSugg.length > 0 && (
                  <>
                    <table className="cajaTable" style={{ marginTop: 8 }}>
                      <thead><tr><th>Fecha</th><th>Secador</th><th className="num">Túneles</th><th className="num">Pago</th><th className="num">Estado</th></tr></thead>
                      <tbody>
                        {secadorSugg.map((s, i) => (
                          <tr key={i}>
                            <td>{new Date(s.work_date).toLocaleDateString("es-EC")}</td>
                            <td>{s.worker_name}</td>
                            <td className="num">{s.tunnels}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{money(s.suggested_amount)}</td>
                            <td className="num">{s.already_generated ? <span className="chip ok">Generado</span> : <span className="chip warn">Nuevo</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button
                      type="button"
                      className="primary"
                      style={{ marginTop: 10 }}
                      onClick={() => generateSecadorDays(secadorSugg.filter((s) => !s.already_generated).map((s) => ({ worker_name: s.worker_name, work_date: s.work_date.slice(0, 10), tunnels: s.tunnels }))).catch((e) => addToast(e.message, "error"))}
                    >
                      Generar pagos de los días nuevos
                    </button>
                  </>
                )}
                {secadorSugg && secadorSugg.length === 0 && (
                  <div className="emptyState" style={{ padding: "22px 20px" }}><p>No hay días de secado en el período. Registra el secado en la pestaña Secadoras (con el nombre del secador).</p></div>
                )}
              </div>

            </div>
            </>)}

            {nominaView === "historial" && (
              <>
                <div className="reportToolbar">
                  <div>
                    <h2 style={{ marginBottom: 2 }}>📜 Historial de pagos</h2>
                    <p className="muted" style={{ margin: 0 }}>Semanas ya pagadas a cada trabajador. Puedes reimprimir el recibo.</p>
                  </div>
                  <div className="reportDates">
                    <label><span>Desde</span><input type="date" value={histFrom} max={histTo} onChange={(e) => setHistFrom(e.target.value)} /></label>
                    <label><span>Hasta</span><input type="date" value={histTo} min={histFrom} onChange={(e) => setHistTo(e.target.value)} /></label>
                    <button type="button" className="primary" onClick={() => loadNominaHistory().catch(() => undefined)}>Ver</button>
                  </div>
                </div>
                {histRows.length === 0 ? (
                  <div className="emptyState"><div className="emptyIcon">📜</div><p>No hay pagos registrados en el período.</p></div>
                ) : (
                  <div className="tablePanel">
                    <div style={{ overflowX: "auto" }}>
                      <table className="cajaTable">
                        <thead>
                          <tr>
                            <th>Semana</th><th>Rol</th><th>Trabajador</th>
                            <th className="num">Reg.</th><th className="num">Ganó</th><th className="num">Anticipos</th><th className="num">Pagado</th><th />
                          </tr>
                        </thead>
                        <tbody>
                          {histRows.map((h, i) => (
                            <tr key={i}>
                              <td>{new Date(h.week_start).toLocaleDateString("es-EC")}</td>
                              <td><span className={h.worker_role === "PILADOR" ? "chip info" : h.worker_role === "ESTIBADOR" ? "chip ok" : h.worker_role === "POLVILLO" ? "chip warn" : "chip warn"}>{h.worker_role === "PILADOR" ? "Pilador" : h.worker_role === "ESTIBADOR" ? "Estibador" : h.worker_role === "POLVILLO" ? "Polvillo" : "Secador"}</span></td>
                              <td style={{ fontWeight: 600 }}>{h.worker_name}</td>
                              <td className="num">{h.cnt}</td>
                              <td className="num">{money(h.earned)}</td>
                              <td className="num" style={{ color: h.advances_applied > 0 ? "var(--c-danger)" : "inherit" }}>{h.advances_applied > 0 ? `−${money(h.advances_applied)}` : "—"}</td>
                              <td className="num" style={{ fontWeight: 700 }}>{money(h.earned - h.advances_applied)}</td>
                              <td className="num"><button type="button" className="btnGhost" title="Reimprimir recibo" onClick={() => printHistoryReceipt(h)}>🧾</button></td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={6} style={{ fontWeight: 700 }}>TOTAL PAGADO</td>
                            <td className="num" style={{ fontWeight: 700 }}>{money(histRows.reduce((a, h) => a + (h.earned - h.advances_applied), 0))}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Modal: detalle del cálculo de nómina por pilada */}
            {nominaPaymentDetail.open && nominaPaymentDetail.row && (
              <div className="modalOverlay" onClick={() => setNominaPaymentDetail({ open: false, row: null, payments: [], loading: false })}>
                <div className="modalCard" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <h3 style={{ margin: 0 }}>
                      Detalle: {nominaPaymentDetail.row.worker_name} · {nominaPaymentDetail.row.worker_role === "PILADOR" ? "Pilador" : nominaPaymentDetail.row.worker_role === "ESTIBADOR" ? "Estibador" : nominaPaymentDetail.row.worker_role === "POLVILLO" ? "Polvillo" : "Secador"}
                    </h3>
                    <button type="button" className="btnGhost" onClick={() => setNominaPaymentDetail({ open: false, row: null, payments: [], loading: false })}>✕</button>
                  </div>
                  {nominaPaymentDetail.loading ? (
                    <p className="muted">Cargando detalle…</p>
                  ) : nominaPaymentDetail.payments.length === 0 ? (
                    <p className="muted">No hay registros individuales en el período.</p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="cajaTable" style={{ fontSize: 13 }}>
                        <thead>
                          <tr><th>Fecha</th><th className="num">QQ</th><th className="num">Tulas</th><th className="num">Sacas</th><th className="num">Arrocillo</th><th className="num">Monto</th><th>Desglose</th></tr>
                        </thead>
                        <tbody>
                          {nominaPaymentDetail.payments.map((p) => {
                            const d = p.detail ?? {};
                            const parts: string[] = [];
                            if (d.qq_amount) parts.push(`${d.qq}x $${d.qq_rate} = $${money(d.qq_amount as number)}`);
                            if (d.tulas_amount) parts.push(`${d.tulas} tulas ÷ 3 × $${d.tulas_rate} = $${money(d.tulas_amount as number)}`);
                            if (d.saca_amount) parts.push(`${d.sacas} sacas × $${d.saca_rate} = $${money(d.saca_amount as number)}`);
                            if (d.arrocillo_amount) parts.push(`${d.arrocillo} arrocillo × $${d.arrocillo_rate} = $${money(d.arrocillo_amount as number)}`);
                            return (
                              <tr key={p.id}>
                                <td>{new Date(p.work_date).toLocaleDateString("es-EC")}</td>
                                <td className="num">{Number(p.qq).toFixed(2)}</td>
                                <td className="num">{Number(p.tulas).toFixed(0)}</td>
                                <td className="num">{Number(p.sacas).toFixed(0)}</td>
                                <td className="num">{Number(p.arrocillo).toFixed(2)}</td>
                                <td className="num" style={{ fontWeight: 700 }}>{money(p.base_amount)}</td>
                                <td style={{ fontSize: 12, maxWidth: 260 }}>{parts.length > 0 ? parts.join(" · ") : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={5} style={{ fontWeight: 700 }}>TOTAL</td>
                            <td className="num" style={{ fontWeight: 700 }}>{money(nominaPaymentDetail.payments.reduce((a, p) => a + p.base_amount, 0))}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "Reportes" && (
          <>
            <div className="reportToolbar">
              <div className="reportKinds">
                {(["resumen", "ventas", "liquidaciones", "gastos", "produccion", "combustible", "porcobrar", "arianos"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={reportKind === k ? "active" : ""}
                    onClick={() => { setReportKind(k); loadReport(k).catch(() => undefined); }}
                  >
                    {k === "resumen" ? "📊 Resumen" : k === "ventas" ? "🛒 Ventas" : k === "liquidaciones" ? "🌾 Liquidaciones" : k === "gastos" ? "🧾 Gastos" : k === "produccion" ? "⚙️ Producción" : k === "combustible" ? "⛽ Combustible" : k === "porcobrar" ? "📈 Por cobrar" : "📦 Lotes guardados"}
                  </button>
                ))}
              </div>
              <div className="reportDates">
                {reportKind === "porcobrar" || reportKind === "arianos" ? (
                  <span className="muted" style={{ alignSelf: "center" }}>{reportKind === "arianos" ? "Estado actual (no depende de fechas)" : "Saldos al día de hoy"}</span>
                ) : (
                  <>
                    <label>
                      <span>Desde</span>
                      <input type="date" value={reportFrom} max={reportTo} onChange={(e) => setReportFrom(e.target.value)} />
                    </label>
                    <label>
                      <span>Hasta</span>
                      <input type="date" value={reportTo} min={reportFrom} onChange={(e) => setReportTo(e.target.value)} />
                    </label>
                  </>
                )}
                <button type="button" className="primary" disabled={reportBusy} onClick={() => loadReport().catch(() => undefined)}>
                  {reportBusy ? "Generando…" : "Generar"}
                </button>
              </div>
              {reportRows && reportKind !== "resumen" && reportKind !== "arianos" && (
                <div className="reportExportBtns">
                  <button type="button" className="btnSecondary" onClick={() => { const e = getReportExport(); if (e) printReport(e.title, e.headers, e.rows, e.totals); }}>🖨 Imprimir</button>
                  <button type="button" className="btnSecondary" onClick={() => { const e = getReportExport(); if (e) exportReportCsv(e.headers, e.rows, `${reportKind}_${reportFrom}_${reportTo}.csv`); }}>📥 Excel</button>
                </div>
              )}
            </div>

            {/* ── Resumen ── */}
            {reportKind === "resumen" && reportSummary && (
              <section className="moduleGrid">
                <Metric title="Ventas del período" value={money(reportSummary.sales.total)} icon="🛒" accent="accGreen" />
                <Metric title="Liquidaciones (neto)" value={money(reportSummary.liquidations.net)} icon="🌾" accent="accBlue" />
                <Metric title="Gastos" value={money(reportSummary.expenses.total)} icon="🧾" accent="accAmber" />
                <Metric title="Caja · neto" value={money(reportSummary.cash.net)} icon="💰" accent={reportSummary.cash.net >= 0 ? "accGreen" : "accRed"} />
                <Metric title="Ventas realizadas" value={reportSummary.sales.cnt} icon="📋" />
                <Metric title="Procesos producción" value={reportSummary.production.cnt} icon="⚙️" accent="accBlue" />
                <Metric title="Por cobrar (saldo)" value={money(reportSummary.receivable_outstanding)} icon="📈" accent="accAmber" />
                <Metric title="Por pagar (saldo)" value={money(reportSummary.payable_outstanding)} icon="📑" accent="accRed" />
              </section>
            )}

            {/* ── Ventas ── */}
            {reportKind === "ventas" && reportRows?.kind === "ventas" && (
              <div className="reportGrid">
                <div className="tablePanel">
                  <h2>Ventas por producto</h2>
                  <ReportTable
                    headers={["Producto", "Cantidad", "Total"]}
                    rows={(reportRows.data.by_product || []).map((r: any) => [r.name, Number(r.qty).toFixed(2), money(r.total)])}
                    empty="Sin ventas en el período"
                  />
                </div>
                <div className="tablePanel">
                  <h2>Ventas por cliente</h2>
                  <ReportTable
                    headers={["Cliente", "N.º", "Total"]}
                    rows={(reportRows.data.by_customer || []).map((r: any) => [r.name, r.cnt, money(r.total)])}
                    empty="Sin ventas en el período"
                  />
                </div>
                <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                  <h2>Ventas por día</h2>
                  <ReportTable
                    headers={["Fecha", "N.º ventas", "Total"]}
                    rows={(reportRows.data.daily || []).map((r: any) => [new Date(r.d).toLocaleDateString("es-EC"), r.cnt, money(r.total)])}
                    empty="Sin ventas en el período"
                  />
                </div>
              </div>
            )}

            {/* ── Liquidaciones ── */}
            {reportKind === "liquidaciones" && reportRows?.kind === "liquidaciones" && (
              <div className="tablePanel">
                <h2>Liquidaciones por agricultor</h2>
                <ReportTable
                  headers={["Agricultor", "N.º", "Quintales", "Bruto", "Descuentos", "Neto"]}
                  rows={(reportRows.data.rows || []).map((r: any) => [r.full_name, r.cnt, Number(r.qq).toFixed(2), money(r.gross), money(r.discounts), money(r.net)])}
                  empty="Sin liquidaciones en el período"
                />
              </div>
            )}

            {/* ── Gastos ── */}
            {reportKind === "gastos" && reportRows?.kind === "gastos" && (
              <div className="tablePanel">
                <h2>Gastos del período</h2>
                {reportRows.data.labor?.total > 0 && (
                  <div className="alertBox" style={{ marginBottom: 10 }}>
                    Pagos de cuadrilla en el período: {money(reportRows.data.labor.total)} ({reportRows.data.labor.cnt})
                  </div>
                )}
                <ReportTable
                  headers={["Fecha", "Descripción", "Pagado a", "Monto"]}
                  rows={(reportRows.data.rows || []).map((r: any) => [new Date(r.created_at).toLocaleDateString("es-EC"), r.description, r.paid_to || "—", money(r.amount)])}
                  empty="Sin gastos en el período"
                />
              </div>
            )}

            {/* ── Cuentas por cobrar con antigüedad ── */}
            {reportKind === "porcobrar" && reportRows?.kind === "porcobrar" && (
              <div className="tablePanel">
                <h2>Cuentas por cobrar por antigüedad</h2>
                <p className="muted" style={{ marginTop: -4, marginBottom: 8 }}>Saldos pendientes al día de hoy. Los tramos indican hace cuánto se generó la deuda.</p>
                {(reportRows.data.rows || []).length === 0 ? (
                  <div className="emptyState" style={{ padding: "26px 20px" }}><p>No hay cuentas por cobrar pendientes 🎉</p></div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="cajaTable" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>Teléfono</th>
                          <th className="num">0-30 días</th>
                          <th className="num">31-60</th>
                          <th className="num">61-90</th>
                          <th className="num">+90 días</th>
                          <th className="num">Total</th>
                          <th className="num">Antigüedad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reportRows.data.rows || []).map((r: any, i: number) => (
                          <tr key={i}>
                            <td>{r.customer_name}</td>
                            <td>{r.phone || "—"}</td>
                            <td className="num">{r.b0 > 0 ? money(r.b0) : "—"}</td>
                            <td className="num">{r.b30 > 0 ? money(r.b30) : "—"}</td>
                            <td className="num">{r.b60 > 0 ? money(r.b60) : "—"}</td>
                            <td className="num" style={r.b90 > 0 ? { color: "var(--c-danger)", fontWeight: 700 } : undefined}>{r.b90 > 0 ? money(r.b90) : "—"}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td>
                            <td className="num">
                              <span className={r.oldest_days > 90 ? "chip bad" : r.oldest_days > 60 ? "chip warn" : "chip ok"}>{r.oldest_days} d</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2} style={{ fontWeight: 700 }}>TOTAL</td>
                          <td className="num" style={{ fontWeight: 700 }}>{money(reportRows.data.totals.b0)}</td>
                          <td className="num" style={{ fontWeight: 700 }}>{money(reportRows.data.totals.b30)}</td>
                          <td className="num" style={{ fontWeight: 700 }}>{money(reportRows.data.totals.b60)}</td>
                          <td className="num" style={{ fontWeight: 700, color: reportRows.data.totals.b90 > 0 ? "var(--c-danger)" : undefined }}>{money(reportRows.data.totals.b90)}</td>
                          <td className="num" style={{ fontWeight: 700 }}>{money(reportRows.data.totals.total)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Lotes guardados: arroz seco sin procesar ── */}
            {reportKind === "arianos" && reportRows?.kind === "arianos" && (() => {
              const pend = reportRows.data.pendientes || [];
              const apart = reportRows.data.apartados || [];
              const totQ = (rows: any[], t: string) => rows.filter((r) => r.rice_type === t).reduce((s: number, r: any) => s + Number(r.quintals ?? 0), 0);
              const fmtF = (d: string | null) => d ? new Date(d).toLocaleDateString("es-EC") : "—";
              const inp = { padding: "4px 6px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, width: "100%" } as const;
              return (
              <div style={{ display: "grid", gap: 16 }}>
                <div className="tablePanel">
                  <h2>Arroz seco sin procesar (pendiente)</h2>
                  <p className="muted" style={{ marginTop: -4, marginBottom: 8 }}>Secados terminados que aún no entran a producción. Escribe dónde lo vas a guardar y dale «Guardar»: deja de contar como pendiente y sale del selector de Producción. Es reversible.</p>
                  {pend.length === 0 ? (
                    <div className="emptyState" style={{ padding: "26px 20px" }}><p>No hay arroz seco pendiente de procesar</p></div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="cajaTable" style={{ marginTop: 8 }}>
                        <thead><tr><th>Fecha secado</th><th>Lote</th><th>Tipo</th><th className="num">QQ</th><th>Ubicación</th><th /></tr></thead>
                        <tbody>
                          {pend.map((r: any) => (
                            <tr key={r.id}>
                              <td>{fmtF(r.dry_end_at)}</td>
                              <td>{r.lot_code ?? "—"}</td>
                              <td>{r.rice_type}</td>
                              <td className="num">{Number(r.quintals).toFixed(2)}</td>
                              <td><input value={arianosUbic[r.id] ?? ""} placeholder="Bodega / sitio" style={inp} onChange={(e) => setArianosUbic((m) => ({ ...m, [r.id]: e.target.value }))} /></td>
                              <td className="num"><button type="button" className="btnSecondary" onClick={() => apartarArianos(r.id, true, arianosUbic[r.id]).catch((e) => addToast(e.message, "error"))}>Guardar</button></td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr><td colSpan={3} style={{ fontWeight: 700 }}>TOTAL 0.11</td><td className="num" style={{ fontWeight: 700 }}>{totQ(pend, "0.11").toFixed(2)}</td><td /><td /></tr>
                          <tr><td colSpan={3} style={{ fontWeight: 700 }}>TOTAL CORRIENTE</td><td className="num" style={{ fontWeight: 700 }}>{totQ(pend, "CORRIENTE").toFixed(2)}</td><td /><td /></tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
                <div className="tablePanel">
                  <h2>Lotes guardados</h2>
                  <p className="muted" style={{ marginTop: -4, marginBottom: 8 }}>Arroz seco apartado, con la fecha en que terminó el secado y dónde está guardado. Puedes devolverlo a proceso cuando quieras.</p>
                  {apart.length === 0 ? (
                    <div className="emptyState" style={{ padding: "26px 20px" }}><p>Nada guardado todavía</p></div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="cajaTable" style={{ marginTop: 8 }}>
                        <thead><tr><th>Fecha secado</th><th>Lote</th><th>Tipo</th><th className="num">QQ</th><th>Ubicación</th><th /></tr></thead>
                        <tbody>
                          {apart.map((r: any) => (
                            <tr key={r.id}>
                              <td>{fmtF(r.dry_end_at)}</td>
                              <td>{r.lot_code ?? "—"}</td>
                              <td>{r.rice_type}</td>
                              <td className="num">{Number(r.quintals).toFixed(2)}</td>
                              <td><input value={arianosUbic[r.id] ?? (r.ubicacion_arianos ?? "")} placeholder="Bodega / sitio" style={inp} onChange={(e) => setArianosUbic((m) => ({ ...m, [r.id]: e.target.value }))} /></td>
                              <td className="num" style={{ whiteSpace: "nowrap" }}>
                                <button type="button" className="btnSecondary" onClick={() => actualizarUbicArianos(r.id, arianosUbic[r.id] ?? r.ubicacion_arianos).catch((e) => addToast(e.message, "error"))}>Actualizar</button>
                                {" "}
                                <button type="button" className="btnSecondary" onClick={() => apartarArianos(r.id, false).catch((e) => addToast(e.message, "error"))}>Devolver a proceso</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr><td colSpan={3} style={{ fontWeight: 700 }}>TOTAL 0.11</td><td className="num" style={{ fontWeight: 700 }}>{totQ(apart, "0.11").toFixed(2)}</td><td /><td /></tr>
                          <tr><td colSpan={3} style={{ fontWeight: 700 }}>TOTAL CORRIENTE</td><td className="num" style={{ fontWeight: 700 }}>{totQ(apart, "CORRIENTE").toFixed(2)}</td><td /><td /></tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
              );
            })()}

            {/* ── Producción ── */}
            {reportKind === "produccion" && reportRows?.kind === "produccion" && (
              <div className="tablePanel">
                <h2>Producción del período</h2>
                <ReportTable
                  headers={["Fecha", "Lote/Proceso", "Lote", "Entrada", "Salida", "Estado"]}
                  rows={(reportRows.data.rows || []).map((r: any) => [new Date(r.created_at).toLocaleDateString("es-EC"), r.batch_number, r.lot_code || "—", Number(r.input_qty).toFixed(2), Number(r.output_qty).toFixed(2), r.status])}
                  empty="Sin producción registrada en el período"
                />
              </div>
            )}

            {/* ── Combustible (gas y diésel por separado) ── */}
            {reportKind === "combustible" && reportRows?.kind === "combustible" && (
              <div className="tablePanel">
                <h2>Combustible por motor · consumo real (consolidado CEYRO)</h2>
                <ReportTable
                  headers={["Fecha", "Motor", "Gas consumo", "Gas $", "Diésel consumo", "Diésel $", "Total $"]}
                  rows={(reportRows.data.motors || []).map((r: any) => [
                    new Date(r.fecha).toLocaleDateString("es-EC"),
                    `Motor ${r.motor}`,
                    `${Number(r.gas_consumo).toFixed(2)} + ${Number(r.gas_cilindros).toFixed(2)} cil.`,
                    money(r.gas_costo),
                    `${Number(r.diesel_consumo).toFixed(2)}`,
                    money(r.diesel_costo),
                    money(r.total)
                  ])}
                  empty="Sin combustible registrado en el período"
                />
                {reportRows.data.totals && (
                  <div className="totalBox" style={{ marginTop: 10 }}>
                    <span>Totales por motor</span>
                    <strong>Gas {money(reportRows.data.totals.gas)} · Diésel {money(reportRows.data.totals.diesel)} · Total {money(reportRows.data.totals.total)}</strong>
                  </div>
                )}

                <h3 style={{ marginTop: 20, fontSize: 14 }}>Reparto por secadora</h3>
                <ReportTable
                  headers={["Fecha", "Hora secado", "Horas", "Secadora", "Motor", "QQ", "Gas $", "Diésel $", "Costo/QQ Gas", "Costo/QQ Diésel", "Total $"]}
                  rows={(reportRows.data.rows || []).map((r: any) => [
                    new Date(r.fecha).toLocaleDateString("es-EC"),
                    `${fmtHoraSecado(r.dry_start_at)} – ${fmtHoraSecado(r.dry_end_at)}`,
                    r.horas_secado != null ? `${Number(r.horas_secado).toFixed(1)} h` : "—",
                    r.dryer_name ?? `Túnel ${r.tunnel_number}`,
                    `Motor ${r.motor_number}`,
                    Number(r.quintals).toFixed(2),
                    money(r.gas_costo),
                    money(r.diesel_costo),
                    money(r.costo_por_qq_gas),
                    money(r.costo_por_qq_diesel),
                    money(r.total)
                  ])}
                  empty="Sin reparto por secadora"
                />
              </div>
            )}
          </>
        )}

        {activeTab === "Configuracion" && (
          <>
            <nav className="cajaSubNav">
              {(["negocio", "usuarios", "accionistas", "tarifas", "actividad", "datos"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={configSubTab === t ? "active" : ""}
                  onClick={() => setConfigSubTab(t)}
                >
                  {t === "negocio" ? "🏢 Negocio" : t === "usuarios" ? "👥 Usuarios" : t === "accionistas" ? "🧑‍🤝‍🧑 Accionistas" : t === "tarifas" ? "💲 Tarifas" : t === "actividad" ? "🕓 Actividad" : "🗄️ Datos"}
                </button>
              ))}
            </nav>

            {/* ── Datos del negocio ── */}
            {configSubTab === "negocio" && (
              <section className="panelGrid">
                <form className="formPanel" onSubmit={(e) => saveSettings(e).catch((err) => addToast(err.message, "error"))}>
                  <h2>🏢 Datos del negocio</h2>
                  <p className="muted">Estos datos aparecen en los comprobantes de liquidación y reportes impresos.</p>
                  <label>
                    <span>Nombre comercial *</span>
                    <input
                      type="text"
                      value={settingsForm.business_name}
                      onChange={(e) => setSettingsForm({ ...settingsForm, business_name: e.target.value })}
                      required
                      minLength={2}
                    />
                  </label>
                  <label>
                    <span>Subtítulo / Actividad</span>
                    <input
                      type="text"
                      placeholder="Ej: Piladora de Arroz"
                      value={settingsForm.business_subtitle}
                      onChange={(e) => setSettingsForm({ ...settingsForm, business_subtitle: e.target.value })}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label>
                      <span>RUC</span>
                      <input
                        type="text"
                        placeholder="0999999999001"
                        value={settingsForm.ruc}
                        onChange={(e) => setSettingsForm({ ...settingsForm, ruc: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>Teléfono</span>
                      <input
                        type="text"
                        placeholder="0987654321"
                        value={settingsForm.phone}
                        onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })}
                      />
                    </label>
                  </div>
                  <label>
                    <span>Dirección</span>
                    <input
                      type="text"
                      placeholder="Km 5 vía a Daule, Guayas"
                      value={settingsForm.address}
                      onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Pie de comprobante (opcional)</span>
                    <input
                      type="text"
                      placeholder="Ej: Gracias por su preferencia"
                      value={settingsForm.receipt_footer}
                      onChange={(e) => setSettingsForm({ ...settingsForm, receipt_footer: e.target.value })}
                    />
                  </label>
                  <button className="primary" disabled={!isAdmin}>Guardar cambios</button>
                  {!isAdmin && <p className="muted">Solo un administrador puede modificar estos datos.</p>}
                </form>

                <div className="formPanel">
                  <h2>Vista previa de encabezado</h2>
                  <p className="muted">Así se verá el encabezado de tus comprobantes:</p>
                  <div className="receiptPreview">
                    <strong>{settingsForm.business_name || "—"}</strong>
                    {settingsForm.business_subtitle && <span>{settingsForm.business_subtitle}</span>}
                    {settingsForm.ruc && <small>RUC: {settingsForm.ruc}</small>}
                    {settingsForm.address && <small>{settingsForm.address}</small>}
                    {settingsForm.phone && <small>Telf: {settingsForm.phone}</small>}
                    <hr />
                    <span className="receiptDoc">COMPROBANTE DE LIQUIDACIÓN</span>
                    {settingsForm.receipt_footer && <em>{settingsForm.receipt_footer}</em>}
                  </div>
                </div>
              </section>
            )}

            {/* ── Usuarios ── */}
            {configSubTab === "usuarios" && (
              <section className="panelGrid">
                <form className="formPanel" onSubmit={(e) => submitConfigUser(e).catch((err) => addToast(err.message, "error"))}>
                  <h2>👤 Crear usuario</h2>
                  <p className="muted">Los operadores pueden usar todo el sistema; solo los administradores acceden a Configuración, crean usuarios y borran datos.</p>
                  <label>
                    <span>Nombre completo *</span>
                    <input
                      type="text"
                      value={newUserForm.name}
                      onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Cedula</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newUserForm.cedula}
                      onChange={(e) => setNewUserForm({ ...newUserForm, cedula: e.target.value })}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label>
                      <span>Usuario *</span>
                      <input
                        type="text"
                        autoComplete="off"
                        value={newUserForm.username}
                        onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>Clave *</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={newUserForm.password}
                        onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                      />
                    </label>
                  </div>
                  <label>
                    <span>Rol</span>
                    <select
                      value={newUserForm.role}
                      onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as "ADMINISTRADOR" | "OPERADOR" })}
                    >
                      <option value="OPERADOR">Operador</option>
                      <option value="ADMINISTRADOR">Administrador</option>
                    </select>
                  </label>
                  {newUserForm.role === "OPERADOR" && (
                    <div>
                      <span className="permLabel">Módulos que puede modificar *</span>
                      <div className="permGrid">
                        {APP_MODULES.map((m) => (
                          <label key={m} className={newUserForm.modules.includes(m) ? "permChip on" : "permChip"}>
                            <input
                              type="checkbox"
                              checked={newUserForm.modules.includes(m)}
                              onChange={() =>
                                setNewUserForm({
                                  ...newUserForm,
                                  modules: newUserForm.modules.includes(m)
                                    ? newUserForm.modules.filter((x) => x !== m)
                                    : [...newUserForm.modules, m]
                                })
                              }
                            />
                            {m}
                          </label>
                        ))}
                      </div>
                      <p className="muted" style={{ marginTop: 6 }}>
                        El operador verá solo estas pestañas (más el Dashboard) y solo podrá registrar cambios en ellas.
                      </p>
                    </div>
                  )}
                  {newUserForm.role === "OPERADOR" && (
                    <div style={{ marginTop: 10 }}>
                      <span className="permLabel">Accionistas que puede manejar *</span>
                      <div className="permGrid">
                        {adminAccionistas.filter((a) => a.is_active).map((a) => (
                          <label key={a.id} className={newUserForm.accionistas.includes(a.id) ? "permChip on" : "permChip"}>
                            <input
                              type="checkbox"
                              checked={newUserForm.accionistas.includes(a.id)}
                              onChange={() =>
                                setNewUserForm({
                                  ...newUserForm,
                                  accionistas: newUserForm.accionistas.includes(a.id)
                                    ? newUserForm.accionistas.filter((x) => x !== a.id)
                                    : [...newUserForm.accionistas, a.id]
                                })
                              }
                            />
                            {a.name}
                          </label>
                        ))}
                      </div>
                      <p className="muted" style={{ marginTop: 6 }}>
                        Solo verá y registrará las operaciones de estos accionistas. Si marcas varios, podrá cambiar entre ellos con el selector.
                      </p>
                    </div>
                  )}
                  {newUserForm.role === "ADMINISTRADOR" && (
                    <p className="muted" style={{ marginTop: 6 }}>Los administradores ven y manejan todos los accionistas.</p>
                  )}
                  <button className="primary" disabled={!isAdmin}>Crear usuario</button>
                </form>

                <div className="tablePanel">
                  <h2>Usuarios registrados</h2>
                  {adminUsers.length === 0 ? (
                    <div className="emptyState">
                      <div className="emptyIcon">👥</div>
                      <p>{isAdmin ? "Cargando usuarios…" : "Solo un administrador puede ver los usuarios"}</p>
                    </div>
                  ) : (
                    <table className="cajaTable" style={{ marginTop: 10 }}>
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Usuario</th>
                          <th>Rol</th>
                          <th>Permisos</th>
                          <th>Estado</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers.map((u) => (
                          <tr key={u.id}>
                            <td>{u.name}</td>
                            <td>{u.username}</td>
                            <td style={{ textTransform: "capitalize" }}>{(u.role_name ?? "—").toLowerCase()}</td>
                            <td>
                              {u.role_name === "ADMINISTRADOR" ? (
                                <span className="chip info">Acceso total</span>
                              ) : (() => {
                                const conMod = (u.accionista_modules ?? []).filter((x) => (x.modules ?? []).length > 0).length;
                                return <span className="muted">{conMod > 0 ? `${conMod} accionista(s) con permisos` : "Sin permisos"}</span>;
                              })()}
                            </td>
                            <td>
                              <span className={u.is_active ? "chip ok" : "chip bad"}>
                                {u.is_active ? "Activo" : "Inactivo"}
                              </span>
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              <button
                                type="button"
                                className="btnGhost"
                                onClick={() => setUserEditor({
                                  user: u,
                                  name: u.name,
                                  username: u.username,
                                  cedula: u.cedula ?? "",
                                  password: "",
                                  role: u.role_name === "ADMINISTRADOR" ? "ADMINISTRADOR" : "OPERADOR"
                                })}
                              >
                                ✎ Editar
                              </button>
                              {u.role_name !== "ADMINISTRADOR" && (
                                <button
                                  type="button"
                                  className="btnGhost"
                                  onClick={() => {
                                    const byAcc = new Map((u.accionista_modules ?? []).map((x) => [x.accionista_id, x.modules ?? []]));
                                    setAccionistaEditor({
                                      user: u,
                                      items: adminAccionistas.map((a) => ({
                                        accionista_id: a.id,
                                        access: byAcc.has(a.id),
                                        modules: byAcc.get(a.id) ?? []
                                      }))
                                    });
                                  }}
                                >
                                  Accionistas y permisos
                                </button>
                              )}
                              {u.id !== authUser.id && (
                                <button
                                  type="button"
                                  className="btnGhost"
                                  style={{ marginLeft: 6 }}
                                  onClick={() => toggleUserActive(u).catch((err) => addToast(err.message, "error"))}
                                >
                                  {u.is_active ? "Desactivar" : "Activar"}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Modal: editar datos de un usuario registrado */}
                {userEditor && (
                  <div className="modalOverlay" onClick={() => setUserEditor(null)}>
                    <div className="modalCard" onClick={(e) => e.stopPropagation()}>
                      <h3>✎ Editar usuario: {userEditor.user.name}</h3>
                      <p className="muted">Corrige los datos si hubo una equivocación. La clave solo se cambia si escribes una nueva (mínimo 8 caracteres); si la dejas en blanco, se conserva la actual.</p>
                      <form
                        onSubmit={(e) => { e.preventDefault(); saveUserEdit().catch((err) => addToast(err.message, "error")); }}
                        style={{ display: "grid", gap: 10, marginTop: 8 }}
                      >
                        <label>
                          <span>Nombre completo</span>
                          <input required minLength={2} value={userEditor.name}
                            onChange={(e) => setUserEditor({ ...userEditor, name: e.target.value })} />
                        </label>
                        <label>
                          <span>Usuario (con lo que inicia sesión)</span>
                          <input required minLength={2} value={userEditor.username}
                            onChange={(e) => setUserEditor({ ...userEditor, username: e.target.value })} />
                        </label>
                        <label>
                          <span>Cedula</span>
                          <input value={userEditor.cedula} inputMode="numeric"
                            onChange={(e) => setUserEditor({ ...userEditor, cedula: e.target.value })} />
                        </label>
                        <label>
                          <span>Clave nueva (opcional)</span>
                          <input type="password" minLength={8} value={userEditor.password} placeholder="Dejar en blanco para conservar"
                            onChange={(e) => setUserEditor({ ...userEditor, password: e.target.value })} />
                        </label>
                        <label>
                          <span>Rol</span>
                          <select value={userEditor.role}
                            disabled={userEditor.user.id === authUser.id}
                            onChange={(e) => setUserEditor({ ...userEditor, role: e.target.value as "ADMINISTRADOR" | "OPERADOR" })}>
                            <option value="OPERADOR">Operador</option>
                            <option value="ADMINISTRADOR">Administrador</option>
                          </select>
                          {userEditor.user.id === authUser.id && (
                            <small className="muted">No puedes cambiar tu propio rol.</small>
                          )}
                        </label>
                        <div className="buttonRow">
                          <button type="submit" className="primary">Guardar cambios</button>
                          <button type="button" onClick={() => setUserEditor(null)}>Cancelar</button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {permsEditor && (
                  <div className="modalOverlay" onClick={() => setPermsEditor(null)}>
                    <div className="modalCard" onClick={(e) => e.stopPropagation()}>
                      <h3>Permisos de {permsEditor.user.name}</h3>
                      <p className="muted">Marca los módulos donde este operador puede registrar y modificar información.</p>
                      <div className="permGrid">
                        {APP_MODULES.map((m) => (
                          <label key={m} className={permsEditor.modules.includes(m) ? "permChip on" : "permChip"}>
                            <input
                              type="checkbox"
                              checked={permsEditor.modules.includes(m)}
                              onChange={() =>
                                setPermsEditor({
                                  ...permsEditor,
                                  modules: permsEditor.modules.includes(m)
                                    ? permsEditor.modules.filter((x) => x !== m)
                                    : [...permsEditor.modules, m]
                                })
                              }
                            />
                            {m}
                          </label>
                        ))}
                      </div>
                      <p className="muted">Nota: si el usuario tiene la sesión abierta, los cambios aplican cuando vuelva a iniciar sesión.</p>
                      <div className="buttonRow">
                        <button type="button" className="primary" onClick={() => savePermissions().catch((err) => addToast(err.message, "error"))}>
                          Guardar permisos
                        </button>
                        <button type="button" onClick={() => setPermsEditor(null)}>Cancelar</button>
                      </div>
                    </div>
                  </div>
                )}

                {accionistaEditor && (
                  <div className="modalOverlay" onClick={() => setAccionistaEditor(null)}>
                    <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
                      <h3>Accionistas y permisos de {accionistaEditor.user.name}</h3>
                      <p className="muted">Por cada accionista, marca el acceso y qué módulos puede usar <strong>ahí</strong>. Los permisos son independientes por accionista.</p>
                      {accionistaEditor.items.length === 0 ? (
                        <p className="muted">Aún no hay accionistas. Créalos en la pestaña «Accionistas».</p>
                      ) : (
                        <div style={{ display: "grid", gap: 10, maxHeight: "55vh", overflowY: "auto" }}>
                          {accionistaEditor.items.map((it, idx) => {
                            const acc = adminAccionistas.find((a) => a.id === it.accionista_id);
                            const setItem = (patch: Partial<{ access: boolean; modules: string[] }>) =>
                              setAccionistaEditor((ed) => ed && ({ ...ed, items: ed.items.map((x, i) => (i === idx ? { ...x, ...patch } : x)) }));
                            return (
                              <div key={it.accionista_id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: "8px 10px", background: it.access ? "#f0fdf4" : undefined }}>
                                <label style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                                  <input type="checkbox" checked={it.access} onChange={(e) => setItem({ access: e.target.checked })} />
                                  {acc?.name ?? it.accionista_id}
                                </label>
                                {it.access && (
                                  <div className="permGrid" style={{ marginTop: 8 }}>
                                    {APP_MODULES.map((m) => (
                                      <label key={m} className={it.modules.includes(m) ? "permChip on" : "permChip"}>
                                        <input
                                          type="checkbox"
                                          checked={it.modules.includes(m)}
                                          onChange={() => setItem({ modules: it.modules.includes(m) ? it.modules.filter((x) => x !== m) : [...it.modules, m] })}
                                        />
                                        {m}
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <p className="muted">Nota: los cambios aplican cuando el usuario vuelva a iniciar sesión.</p>
                      <div className="buttonRow">
                        <button type="button" className="primary" onClick={() => saveUserAccionistas().catch((err) => addToast(err.message, "error"))}>
                          Guardar
                        </button>
                        <button type="button" onClick={() => setAccionistaEditor(null)}>Cancelar</button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Accionistas ── */}
            {configSubTab === "accionistas" && (
              <section className="panelGrid">
                <form className="formPanel" onSubmit={(e) => createAccionista(e).catch((err) => addToast(err.message, "error"))}>
                  <h2>🧑‍🤝‍🧑 Nuevo accionista</h2>
                  <p className="muted">Cada accionista compra y maneja su arroz, inventario, caja y cuentas por separado, usando la misma app.</p>
                  <label>
                    <span>Nombre *</span>
                    <input
                      type="text"
                      placeholder="Ej: Juan Pérez"
                      value={newAccionistaForm.name}
                      onChange={(e) => setNewAccionistaForm({ ...newAccionistaForm, name: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Código *</span>
                    <input
                      type="text"
                      placeholder="Ej: ACC-2"
                      value={newAccionistaForm.code}
                      onChange={(e) => setNewAccionistaForm({ ...newAccionistaForm, code: e.target.value })}
                    />
                  </label>
                  <button className="primary" disabled={!isAdmin}>Crear accionista</button>
                  {!isAdmin && <p className="muted">Solo un administrador puede crear accionistas.</p>}
                </form>

                <div className="tablePanel">
                  <h2>Accionistas registrados</h2>
                  {adminAccionistas.length === 0 ? (
                    <div className="emptyState">
                      <div className="emptyIcon">🧑‍🤝‍🧑</div>
                      <p>{isAdmin ? "Aún no hay accionistas. Crea el primero a la izquierda." : "Solo un administrador puede ver los accionistas"}</p>
                    </div>
                  ) : (
                    <table className="cajaTable" style={{ marginTop: 10 }}>
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Código</th>
                          <th>Usuarios con acceso</th>
                          <th>Estado</th>
                          <th>Envejece</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {adminAccionistas.map((a) => (
                          <tr key={a.id}>
                            <td>{a.name}</td>
                            <td>{a.code}</td>
                            <td className="muted">
                              {adminUsers.filter((u) => u.role_name === "ADMINISTRADOR" || (u.accionista_ids ?? []).includes(a.id)).length}
                            </td>
                            <td>
                              <span className={a.is_active ? "chip ok" : "chip bad"}>
                                {a.is_active ? "Activo" : "Inactivo"}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className={a.puede_envejecer ? "chip ok" : "chip"}
                                style={{ cursor: isAdmin ? "pointer" : "default", border: "none" }}
                                disabled={!isAdmin}
                                title="Solo este accionista puede mandar a envejecer producto"
                                onClick={() => toggleEnvejecer(a).catch((err) => addToast(err.message, "error"))}
                              >
                                {a.puede_envejecer ? "Sí" : "No"}
                              </button>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                type="button"
                                className="btnGhost"
                                onClick={() => setRenameAccionista({ id: a.id, name: a.name, code: a.code })}
                              >
                                Editar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="muted" style={{ marginTop: 10 }}>
                    Para dar acceso a un usuario, ve a la pestaña «Usuarios» y usa el botón «Accionistas» en su fila. Los administradores ven todos los accionistas automáticamente.
                  </p>
                </div>

                {renameAccionista && (
                  <div className="modalOverlay" onClick={() => setRenameAccionista(null)}>
                    <div className="modalCard" onClick={(e) => e.stopPropagation()}>
                      <h3>Editar accionista</h3>
                      <label>
                        <span>Nombre *</span>
                        <input
                          type="text"
                          value={renameAccionista.name}
                          onChange={(e) => setRenameAccionista({ ...renameAccionista, name: e.target.value })}
                        />
                      </label>
                      <label>
                        <span>Código *</span>
                        <input
                          type="text"
                          value={renameAccionista.code}
                          onChange={(e) => setRenameAccionista({ ...renameAccionista, code: e.target.value })}
                        />
                      </label>
                      <div className="buttonRow">
                        <button type="button" className="primary" onClick={() => saveRenameAccionista().catch((err) => addToast(err.message, "error"))}>
                          Guardar
                        </button>
                        <button type="button" onClick={() => setRenameAccionista(null)}>Cancelar</button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Tarifas de pago a trabajadores ── */}
            {configSubTab === "tarifas" && (
              <section className="panelGrid">
                <form className="formPanel" onSubmit={(e) => saveLaborRates(e).catch((err) => addToast(err.message, "error"))}>
                  <h2>💲 Tarifas de pago (Pilador y Estibador)</h2>
                  <p className="muted">Con estas tarifas se calcula automáticamente el pago al cerrar cada pilada en Producción.</p>
                  <h2 style={{ marginTop: 6, marginBottom: 0, fontSize: 13 }}>Pilador</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label><span>$ por QQ de arroz</span><input type="number" step="0.01" min="0" value={laborRatesForm.pilador_per_qq} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, pilador_per_qq: Number(e.target.value) })} /></label>
                    <label><span>$ por saca (@)</span><input type="number" step="0.01" min="0" value={laborRatesForm.pilador_per_saca} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, pilador_per_saca: Number(e.target.value) })} /></label>
                  </div>
                  <h2 style={{ marginTop: 6, marginBottom: 0, fontSize: 13 }}>Estibador</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <label><span>$ por QQ</span><input type="number" step="0.01" min="0" value={laborRatesForm.estibador_per_qq} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, estibador_per_qq: Number(e.target.value) })} /></label>
                    <label><span>$ por saca (@)</span><input type="number" step="0.01" min="0" value={laborRatesForm.estibador_per_saca} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, estibador_per_saca: Number(e.target.value) })} /></label>
                    <label><span>$ por arrocillo</span><input type="number" step="0.01" min="0" value={laborRatesForm.estibador_per_arrocillo} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, estibador_per_arrocillo: Number(e.target.value) })} /></label>
                    <label><span>$ por cada 3 tulas ⭐</span><input type="number" step="0.01" min="0" value={laborRatesForm.estibador_por_3tulas} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, estibador_por_3tulas: Number(e.target.value) })} /></label>
                  </div>
                  <h2 style={{ marginTop: 6, marginBottom: 0, fontSize: 13 }}>Secador <span className="muted" style={{ fontWeight: 400 }}>(próxima fase)</span></h2>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label><span>$ guardianía / día</span><input type="number" step="0.5" min="0" value={laborRatesForm.secador_guardiania} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, secador_guardiania: Number(e.target.value) })} /></label>
                    <label><span>$ por túnel secado</span><input type="number" step="0.5" min="0" value={laborRatesForm.secador_per_tunel} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, secador_per_tunel: Number(e.target.value) })} /></label>
                  </div>
                  <h2 style={{ marginTop: 6, marginBottom: 0, fontSize: 13 }}>⛽ Precio del combustible <span className="muted" style={{ fontWeight: 400 }}>(se usa en Secadoras)</span></h2>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <label><span>$ bombona por cada 1%</span><input type="number" step="0.01" min="0" value={laborRatesForm.precio_gas_bombona} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, precio_gas_bombona: Number(e.target.value) })} /></label>
                    <label><span>$ por cilindro</span><input type="number" step="0.01" min="0" value={laborRatesForm.precio_gas_cilindro} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, precio_gas_cilindro: Number(e.target.value) })} /></label>
                    <label><span>$ diesel por unidad de medidor</span><input type="number" step="0.01" min="0" value={laborRatesForm.precio_diesel} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, precio_diesel: Number(e.target.value) })} /></label>
                  </div>
                  <button className="primary" disabled={!isAdmin}>Guardar tarifas</button>
                  {!isAdmin && <p className="muted">Solo un administrador puede cambiar las tarifas.</p>}
                </form>
                <div className="formPanel">
                  <h2>Ejemplo de cálculo</h2>
                  <p className="muted">Para una pilada de 100 QQ de arroz, 20 sacas, 10 QQ de arrocillo y 6 tulas:</p>
                  <div className="totalBox" style={{ marginBottom: 10 }}>
                    <span>Pilador</span>
                    <strong>{money(100 * laborRatesForm.pilador_per_qq + 20 * laborRatesForm.pilador_per_saca)}</strong>
                    <small>100 × {laborRatesForm.pilador_per_qq} + 20 × {laborRatesForm.pilador_per_saca}</small>
                  </div>
                  <div className="totalBox" style={{ marginBottom: 10 }}>
                    <span>Estibador (con tulas)</span>
                    <strong>{money((6 / 3) * laborRatesForm.estibador_por_3tulas)}</strong>
                    <small>
                      Solo tulas: 6 tulas ÷ 3 × {laborRatesForm.estibador_por_3tulas}
                      {' '}(sin QQ, sacas ni arrocillo cuando hay tulas)
                    </small>
                  </div>
                  <div className="totalBox" style={{ marginBottom: 10 }}>
                    <span>Estibador (sin tulas)</span>
                    <strong>{money(
                      100 * laborRatesForm.estibador_per_qq +
                      20 * laborRatesForm.estibador_per_saca +
                      10 * laborRatesForm.estibador_per_arrocillo
                    )}</strong>
                    <small>
                      100 × {laborRatesForm.estibador_per_qq} +
                      20 × {laborRatesForm.estibador_per_saca} +
                      10 × {laborRatesForm.estibador_per_arrocillo}
                    </small>
                  </div>
                  <div className="totalBox">
                  </div>
                </div>
                <div className="formPanel">
                  <h2>🧾 Tarifario de servicios (socios)</h2>
                  <p className="muted">Precio por QQ por socio y servicio, con fecha de vigencia. Servicio Pilado autocompleta con la tarifa vigente (editable).</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label><span>Socio</span>
                      <select value={tarifaForm.socio_id} onChange={(e) => setTarifaForm({ ...tarifaForm, socio_id: e.target.value })}>
                        <option value="">Seleccione</option>
                        {accionistas.filter((a) => a.tipo !== "MATRIZ").map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
                      </select>
                    </label>
                    <label><span>Servicio</span>
                      <select value={tarifaForm.servicio} onChange={(e) => setTarifaForm({ ...tarifaForm, servicio: e.target.value })}>
                        <option value="PILADO">Pilado</option>
                        <option value="SECADO">Secado</option>
                        <option value="FLETE">Flete</option>
                      </select>
                    </label>
                    <label><span>$ por QQ</span>
                      <input type="number" step="0.01" min="0" value={tarifaForm.precio_por_qq} onChange={(e) => setTarifaForm({ ...tarifaForm, precio_por_qq: e.target.value })} />
                    </label>
                    <label><span>Vigente desde</span>
                      <input type="date" value={tarifaForm.fecha_vigencia} onChange={(e) => setTarifaForm({ ...tarifaForm, fecha_vigencia: e.target.value })} />
                    </label>
                  </div>
                  <button type="button" className="primary" onClick={submitServicioTarifa} disabled={!isAdmin}>Guardar tarifa</button>
                  {!isAdmin && <p className="muted">Solo un administrador puede cambiar tarifas.</p>}
                  <hr className="divider" />
                  <h2 style={{ marginBottom: 0 }}>Tarifas configuradas</h2>
                  {servicioTarifas.length === 0 && <p className="muted">Sin tarifas configuradas.</p>}
                  <div className="equipList">
                    {servicioTarifas.map((t) => (
                      <div key={t.id} className="equipItem" style={{ opacity: t.is_active ? 1 : 0.5 }}>
                        <div>
                          <strong>{t.socio_name} · {t.servicio}</strong>
                          <small>${Number(t.precio_por_qq).toFixed(2)}/QQ · desde {(t.fecha_vigencia || "").slice(0, 10)}{t.is_active ? "" : " · inactiva"}</small>
                        </div>
                        <button type="button" className="equipDelBtn" onClick={() => toggleServicioTarifa(t)}>{t.is_active ? "Desactivar" : "Activar"}</button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ── Actividad / auditoría ── */}
            {configSubTab === "actividad" && (
              <div className="tablePanel">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ marginBottom: 4 }}>🕓 Actividad del sistema</h2>
                    <p className="muted" style={{ margin: 0 }}>Registro de quién creó, modificó o eliminó información. Se guarda automáticamente.</p>
                  </div>
                  <button type="button" className="btnSecondary" onClick={() => refreshConfig().catch((e) => addToast(e.message, "error"))}>
                    ↻ Actualizar
                  </button>
                </div>
                {auditLog.length === 0 ? (
                  <div className="emptyState">
                    <div className="emptyIcon">🕓</div>
                    <p>Aún no hay actividad registrada. Las acciones de los usuarios aparecerán aquí.</p>
                  </div>
                ) : (
                  <table className="cajaTable" style={{ marginTop: 10 }}>
                    <thead>
                      <tr>
                        <th>Fecha y hora</th>
                        <th>Usuario</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLog.map((a) => (
                        <tr key={a.id}>
                          <td style={{ whiteSpace: "nowrap" }}>{new Date(a.created_at).toLocaleString("es-EC")}</td>
                          <td>{a.username ?? "—"}</td>
                          <td>
                            <span className={a.action === "ELIMINAR" ? "chip bad" : a.action === "CREAR" ? "chip ok" : "chip info"}>
                              {a.summary ?? `${a.action} ${a.table_name}`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Puesta en marcha / datos ── */}
            {configSubTab === "datos" && (
              <section className="panelGrid">
                <div className="formPanel">
                  <h2>✅ Puesta en marcha</h2>
                  <p className="muted">
                    Pasos recomendados antes de operar con datos reales:
                  </p>
                  <ol className="setupList">
                    <li>Completa los <strong>datos del negocio</strong> (aparecen en los comprobantes).</li>
                    <li>Crea un usuario para cada persona que use el sistema.</li>
                    <li>Usa <strong>Restaurar de fábrica</strong> en el panel de la derecha para limpiar datos de prueba.</li>
                    <li>Verifica productos, bodegas e insumos en el Dashboard ("Crear datos base" si están vacíos).</li>
                    <li>Abre la caja del día y registra a tus agricultores reales.</li>
                  </ol>
                </div>

                <form className="formPanel dangerZone" onSubmit={(e) => submitResetData(e).catch((err) => addToast(err.message, "error"))}>
                  <h2>🗑️ Restaurar de fábrica</h2>
                  <p className="muted">
                    Limpia <strong>todos los movimientos operativos</strong>: tickets, lotes, traspasos, secado, producción, combustible,
                    pilado, selección, pedidos, ventas, inventario (productos, insumos y sacos a 0), caja, gastos, nómina,
                    anticipos, liquidaciones, fomentos, agricultores, clientes, cuentas por cobrar/pagar, conciliación bancaria,
                    historial de auditoría y sincronización. Se conservan usuarios, accionistas, configuración, tarifas,
                    productos, bodegas, equipos y catálogos de insumos/sacos.
                  </p>
                  <p className="dangerNote">Esta acción no se puede deshacer.</p>
                  <label>
                    <span>Tu clave de administrador</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={resetForm.password}
                      onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    <span>Escribe BORRAR para confirmar</span>
                    <input
                      type="text"
                      placeholder="BORRAR"
                      value={resetForm.confirm}
                      onChange={(e) => setResetForm({ ...resetForm, confirm: e.target.value })}
                      required
                    />
                  </label>
                  <button
                    className="dangerBtn"
                    disabled={!isAdmin || resetForm.confirm.trim().toUpperCase() !== "BORRAR" || resetForm.password.length < 4}
                  >
                    Restaurar de fábrica definitivamente
                  </button>
                </form>

                <div className="formPanel" style={{ gridColumn: "1 / -1" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <h2 style={{ marginBottom: 4 }}>💾 Respaldos de la base de datos</h2>
                      <p className="muted" style={{ margin: 0 }}>
                        Copia de seguridad de toda la información. Se guarda en OneDrive y se sube a la nube automáticamente.
                      </p>
                    </div>
                    <button type="button" className="primary" onClick={runBackupNow} disabled={!isAdmin || backupBusy}>
                      {backupBusy ? "Respaldando…" : "Respaldar ahora"}
                    </button>
                  </div>

                  {backupInfo && (
                    <p className="muted" style={{ marginTop: 4 }}>
                      Carpeta: <code>{backupInfo.directory}</code>
                    </p>
                  )}

                  {backupInfo && backupInfo.backups.length > 0 && (
                    <div className="alertBox" style={{ background: "var(--c-success-bg)", borderColor: "rgba(22,163,74,.3)", color: "var(--c-success-text)" }}>
                      ✓ Último respaldo: {new Date(backupInfo.backups[0].created_at).toLocaleString("es-EC")} ({backupInfo.backups[0].size_kb} KB)
                    </div>
                  )}

                  {backupInfo && backupInfo.backups.length === 0 && (
                    <div className="alertBox">
                      Aún no hay respaldos. Presiona "Respaldar ahora" o instala el respaldo automático con el archivo
                      <strong> INSTALAR-RESPALDO-AUTOMATICO.bat</strong> de la carpeta del sistema.
                    </div>
                  )}

                  {backupInfo && backupInfo.backups.length > 0 && (
                    <table className="cajaTable" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Archivo</th>
                          <th style={{ textAlign: "right" }}>Tamaño</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backupInfo.backups.map((b) => (
                          <tr key={b.name}>
                            <td>{new Date(b.created_at).toLocaleString("es-EC")}</td>
                            <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{b.name}</td>
                            <td className="amountCell">{b.size_kb} KB</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <p className="muted" style={{ marginTop: 8 }}>
                    <strong>Recomendado:</strong> ejecuta una vez <strong>INSTALAR-RESPALDO-AUTOMATICO.bat</strong> para
                    que se respalde solo cada día a las 8:00 PM.
                  </p>
                </div>
              </section>
            )}
          </>
        )}

        </div>{/* .content */}
      </section>
    </main>

    {/* Modal: vincular ticket de báscula a un agricultor */}
    {linkTicket && (
      <div className="modalOverlay" onClick={() => setLinkTicket(null)}>
        <div className="modalCard" onClick={(e) => e.stopPropagation()}>
          <h3>Vincular ticket #{linkTicket.numero} a un agricultor</h3>
          <p className="muted">En la báscula figura como: <strong>{linkTicket.farmer_name || "(sin nombre)"}</strong></p>
          <label>
            <span>Agricultor</span>
            <select value={linkFarmerId} onChange={(e) => setLinkFarmerId(e.target.value)}>
              <option value="">Selecciona…</option>
              {(linkTicket.farmer_name || "").trim().length >= 2 && (
                <option value="__new__">➕ Crear "{linkTicket.farmer_name}"</option>
              )}
              {farmers.map((f) => <option key={f.id} value={f.id}>{f.full_name}</option>)}
            </select>
          </label>
          <div className="buttonRow">
            <button type="button" className="primary" onClick={() => submitLinkFarmer().catch((e) => addToast(e.message, "error"))}>Vincular</button>
            <button type="button" onClick={() => setLinkTicket(null)}>Cancelar</button>
          </div>
        </div>
      </div>
    )}

    {/* Modal: crear lote desde ticket de báscula */}
    {lotTicket && (
      <div className="modalOverlay" onClick={() => setLotTicket(null)}>
        <div className="modalCard" onClick={(e) => e.stopPropagation()}>
          <h3>Ingresar materia prima · ticket #{lotTicket.numero}</h3>
          <p className="muted">{lotTicket.farmer_name} · {Number(lotTicket.quintals).toFixed(2)} QQ. Entra como materia prima. El <strong>lote se formará después en la secadora</strong>, agrupando varios ingresos en un túnel.</p>
          <label>
            <span>Tipo de arroz</span>
            <select value={lotForm.rice_type} onChange={(e) => setLotForm({ ...lotForm, rice_type: e.target.value as "0.11" | "CORRIENTE" })}>
              <option value="0.11">0.11</option>
              <option value="CORRIENTE">Corriente</option>
            </select>
          </label>
          <label>
            <span>¿Qué es este arroz?</span>
            <select value={lotForm.ownership} onChange={(e) => setLotForm({ ...lotForm, ownership: e.target.value as "OWNED" | "MAQUILA" })}>
              <option value="OWNED">Compra propia (entra a mi inventario)</option>
              <option value="MAQUILA">Servicio de pilado (no entra a mi inventario)</option>
            </select>
          </label>
          {lotForm.ownership === "OWNED" ? (
            <>
              {accionistas.length > 0 && (
                <label>
                  <span>¿Qué accionista compra esta materia prima?</span>
                  <select value={lotForm.accionista_id} onChange={(e) => setLotForm({ ...lotForm, accionista_id: e.target.value })}>
                    {accionistas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              )}
              <p className="muted" style={{ marginTop: 4 }}>
                📦 Entra a <strong>Bodega Materia Prima</strong> como <strong>{lotForm.rice_type === "0.11" ? "Cáscara 0.11" : "Cáscara Corriente"}</strong>.
              </p>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 4 }}>
              🌾 El servicio de pilado siempre queda a nombre de <strong>CEYRO</strong> y no entra a inventario (el arroz es del cliente).
            </p>
          )}
          <div className="buttonRow">
            <button type="button" className="primary" onClick={() => submitCreateLot()}>Ingresar materia prima</button>
            <button type="button" onClick={() => setLotTicket(null)}>Cancelar</button>
          </div>
        </div>
      </div>
    )}

    {/* Modal: liquidar ticket de báscula */}
    {liqTicket && (
      <div className="modalOverlay" onClick={() => setLiqTicket(null)}>
        <div className="modalCard" onClick={(e) => e.stopPropagation()}>
          <h3>Liquidar ticket #{liqTicket.numero}</h3>
          <p className="muted">{liqTicket.farmer_name} · {Number(liqTicket.quintals).toFixed(2)} QQ</p>
          {!dashboard.current_cash_register && <div className="alertBox">Abre una caja para que el pago quede registrado.</div>}
          <label>
            <span>Precio por quintal $</span>
            <input type="number" step="0.01" min="0" placeholder="0.00" value={liqPrecio}
              onChange={(e) => { setLiqPrecio(e.target.value); setLiqPreview(null); }} />
          </label>
          {liqPreview ? (
            <div className="liqSummary">
              <div className="liqSummaryRow"><span>Bruto ({Number(liqTicket.quintals).toFixed(2)} QQ × ${Number(liqPrecio).toFixed(2)})</span><span>{money(liqPreview.grossPayable)}</span></div>
              {liqPreview.advancesDiscount > 0 && <div className="liqSummaryRow disc"><span>Descuento anticipos</span><span>−{money(liqPreview.advancesDiscount)}</span></div>}
              <div className="liqSummaryRow total"><span>Neto a pagar</span><span>{money(liqPreview.netPayable)}</span></div>
            </div>
          ) : (
            <button type="button" className="btnSecondary" onClick={() => previewTicketLiquidation().catch((e) => addToast(e.message, "error"))}>Calcular</button>
          )}
          <div className="buttonRow">
            <button type="button" className="primary" disabled={!liqPreview} onClick={() => confirmTicketLiquidation().catch((e) => addToast(e.message, "error"))}>Confirmar liquidación</button>
            <button type="button" onClick={() => setLiqTicket(null)}>Cancelar</button>
          </div>
        </div>
      </div>
    )}

    {toasts.length > 0 && (
      <div className="toastBar">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.type ? ` ${t.type}` : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    )}
    </>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"loading" | "login" | "bootstrap">("loading");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ has_users: boolean }>("/auth/status")
      .then((status) => setMode(status.has_users ? "login" : "bootstrap"))
      .catch(() => setMode("login"));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = mode === "bootstrap"
        ? await apiPost<{ token: string; user: AuthUser; accionistas: Accionista[] }>("/auth/bootstrap", { name: fullName, username, password })
        : await apiPost<{ token: string; user: AuthUser; accionistas: Accionista[] }>("/auth/login", { username, password });
      localStorage.setItem(authStorageKey, JSON.stringify(result));
      ensureActiveAccionista(result.accionistas);
      onLogin(result.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="loginShell">
      <form className="loginCard" onSubmit={submit}>
        <div className="loginBrand">
          <span className="brandMark">B</span>
          <h1>Bascula ERP</h1>
          <p>
            {mode === "bootstrap"
              ? "Bienvenido. Crea el usuario administrador para comenzar."
              : "Piladora de arroz · Inicia sesión para continuar"}
          </p>
        </div>

        {error && <div className="loginError">{error}</div>}

        {mode === "loading" ? (
          <p className="loginHint">Conectando con el servidor…</p>
        ) : (
          <>
            {mode === "bootstrap" && (
              <label>
                <span>Nombre completo</span>
                <input
                  type="text"
                  placeholder="Ej: Stalyn Marín"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  minLength={2}
                  autoFocus
                />
              </label>
            )}
            <label>
              <span>Usuario</span>
              <input
                type="text"
                placeholder="usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                autoComplete="username"
                autoFocus={mode === "login"}
              />
            </label>
            <label>
              <span>Clave</span>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={4}
                autoComplete={mode === "bootstrap" ? "new-password" : "current-password"}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Ingresando…" : mode === "bootstrap" ? "Crear administrador e ingresar" : "Ingresar"}
            </button>
            {mode === "bootstrap" && (
              <p className="loginHint">Este paso solo aparece la primera vez, cuando aún no existen usuarios.</p>
            )}
          </>
        )}
      </form>
    </main>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "statusDot ok" : "statusDot"}>
      <i />
      {label}
    </span>
  );
}

function ControlledNumberInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input min="0" step="0.01" type="number" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ProductionQqFields({
  label,
  value,
  onChange
}: {
  label: string;
  value: ProductionPackageState[ProductionPackageKey];
  onChange: (changes: Partial<ProductionPackageState[ProductionPackageKey]>) => void;
}) {
  return (
    <article className="sackOutputCard">
      <strong>{label}</strong>
      <label>
        <span>QQ</span>
        <input
          min="0"
          step="1"
          type="number"
          value={value.qq}
          onChange={(event) => onChange({ qq: Number(event.target.value || 0) })}
        />
      </label>
      <label>
        <span>Libras sobrantes</span>
        <input
          min="0"
          max="99.99"
          step="0.01"
          type="number"
          value={value.pounds}
          onChange={(event) => onChange({ pounds: Number(event.target.value || 0) })}
        />
      </label>
      <small>{qqAndPoundsToQq(value).toFixed(2)} QQ equivalentes</small>
    </article>
  );
}

// Panel de Control Integral: vista consolidada de los 3 accionistas.
function PanelIntegral({ data, month, onMonth }: { data: PanelData; month: string; onMonth: (m: string) => void }) {
  const k = data.kpis;
  const acc = data.per_accionista;
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const [yy, mm] = month.split("-").map(Number);
  const today = new Date().toLocaleDateString("es-EC");
  const card = (title: string, value: string, sub: string, color: string) => (
    <div style={{ flex: "1 1 180px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px", borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 800, margin: "6px 0 2px" }}>{value}</div>
      <div className="muted" style={{ fontSize: 11 }}>{sub}</div>
    </div>
  );
  const tbl = (title: string, color: string, headers: string[], rows: Array<Array<string | number>>, totals: Array<string | number>) => (
    <div style={{ flex: "1 1 300px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ background: color, color: "#fff", fontWeight: 700, padding: "8px 14px", fontSize: 13 }}>{title}</div>
      <table className="cajaTable" style={{ margin: 0 }}>
        <thead><tr>{headers.map((h, i) => <th key={i} style={{ textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ textAlign: j === 0 ? "left" : "right" }}>{c}</td>)}</tr>)}
          <tr style={{ fontWeight: 700, background: "#f8fafc" }}>{totals.map((c, j) => <td key={j} style={{ textAlign: j === 0 ? "left" : "right" }}>{c}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: "#1e3a8a" }}>Panel de Control Integral</h1>
          <p className="muted" style={{ margin: 0 }}>Consolidado de todos los accionistas</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12 }}>Mes
            <input type="month" value={month} onChange={(e) => onMonth(e.target.value)} style={{ display: "block", padding: "5px 8px", borderRadius: 6, border: "1px solid #d1d5db" }} />
          </label>
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>FECHA ACTUAL</div>
            <div style={{ fontWeight: 800, color: "#dc2626" }}>{today}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {card("TOTAL COMPRAS DEL MES", money(k.compras), `${data.totales.compras_qq.toFixed(2)} quintales`, "#16a34a")}
        {card("TOTAL VENTAS DEL MES", money(k.ventas), `${data.totales.ventas_qq.toFixed(2)} quintales`, "#2563eb")}
        {card("UTILIDAD DEL MES", money(k.utilidad), `${k.margen}% sobre ventas`, "#f59e0b")}
        {card("TOTAL EN BANCOS/CAJA", money(k.bancos), "disponible", "#0d9488")}
        {card("SALDO GENERAL", money(k.saldo_general), "bancos + por cobrar − por pagar", "#7c3aed")}
        {data.servicios_pilado && card("INGRESOS POR SERVICIO (SOCIOS)", money(data.servicios_pilado.facturado), `pendiente ${money(data.servicios_pilado.pendiente)} · ${data.servicios_pilado.cnt} serv.`, "#0891b2")}
        {data.costo_operativo && card("COSTO OPERATIVO (CEYRO)", money(data.costo_operativo.total), data.costo_operativo.qq > 0 ? `$${data.costo_operativo.por_qq.toFixed(2)}/QQ · ${data.costo_operativo.qq.toFixed(0)} QQ` : "sin corridas del mes", "#b91c1c")}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 500px", minWidth: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ background: "#16a34a", color: "#fff", fontWeight: 700, padding: "8px 14px", fontSize: 13 }}>INVENTARIO POR ACCIONISTA</div>
          <div style={{ overflowX: "auto" }}>
            <table className="cajaTable" style={{ margin: 0, fontSize: 11, whiteSpace: "nowrap" }}>
              <thead>
                <tr>
                  {["Accionista", "CASC", "SECO", "CASC", "SECO", "PROD", "PROD", "3/4", "FINO", "POLV"].map((h, i) => (
                    <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 8px 0", borderBottom: "none" }}>{h}</th>
                  ))}
                </tr>
                <tr>
                  {["", "0.11", "0.11", "CORR", "CORR", "0.11", "CORR", "", "", ""].map((h, i) => (
                    <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "0 8px 6px", fontSize: 10, color: "#64748b" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {acc.map((a, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: "left", padding: "6px 8px" }}>{a.name}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.cascara_011.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.seco_011.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.cascara_corriente.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.seco_corriente.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.producto_011.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.producto_corriente.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.arrocillo_34.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.arrocillo_fino.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px" }}>{a.polvillo.toFixed(2)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#f8fafc" }}>
                  <td style={{ textAlign: "left", padding: "6px 8px" }}>TOTAL</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.cascara_011.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.seco_011.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.cascara_corriente.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.seco_corriente.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.producto_011.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.producto_corriente.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.arrocillo_34.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.arrocillo_fino.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px" }}>{data.totales.polvillo.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        {tbl("VENTAS POR ACCIONISTA", "#2563eb", ["Accionista", "Total ventas", "QQ", "Facturas"],
          acc.map((a) => [a.name, money(a.ventas_total), a.ventas_qq.toFixed(2), a.ventas_cnt]),
          ["TOTAL", money(k.ventas), data.totales.ventas_qq.toFixed(2), data.totales.ventas_cnt])}
        {tbl("COMPRAS POR ACCIONISTA", "#0d9488", ["Accionista", "Total compras", "QQ", "Liquid."],
          acc.map((a) => [a.name, money(a.compras_total), a.compras_qq.toFixed(2), a.compras_cnt]),
          ["TOTAL", money(k.compras), data.totales.compras_qq.toFixed(2), data.totales.compras_cnt])}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 380px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
          <h3 style={{ marginTop: 0, textAlign: "center", color: "#1e3a8a" }}>Compras vs Ventas (últimos 6 meses)</h3>
          <div style={{ display: "flex", justifyContent: "center", gap: 20, fontSize: 12, marginBottom: 4 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#16a34a", borderRadius: 2 }} /> Compras</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#2563eb", borderRadius: 2 }} /> Ventas</span>
          </div>
          <ComprasVentasChart serie={data.serie} />
        </div>
        <div style={{ flex: "1 1 220px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
          <h3 style={{ marginTop: 0, textAlign: "center", color: "#0d9488" }}>Bancos / Caja</h3>
          {acc.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", borderBottom: "1px solid #f1f5f9" }}>
              <span>🏦 {a.name}</span><strong>{money(a.banco_balance)}</strong>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 4px", fontWeight: 800, color: "#0d9488" }}>
            <span>TOTAL</span><span>{money(k.bancos)}</span>
          </div>
        </div>
        <div style={{ flex: "1 1 260px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
          <h3 style={{ marginTop: 0, textAlign: "center", color: "#1e3a8a" }}>Distribución de inventario</h3>
          <InventarioDonut data={acc.map((a) => ({ name: a.name, value: a.inventario_qq }))} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {card("CUENTAS POR COBRAR", money(data.por_cobrar.total), `${data.por_cobrar.cnt} cliente(s)`, "#2563eb")}
        {card("CUENTAS POR PAGAR", money(data.por_pagar.total), `${data.por_pagar.cnt} proveedor(es)`, "#dc2626")}
        {card("PRÉSTAMOS A AGRICULTORES", money(data.prestamos.total), `${data.prestamos.cnt} agricultor(es)`, "#16a34a")}
        <div style={{ flex: "1 1 240px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, color: "#dc2626", marginBottom: 6 }}>⚠️ Alertas importantes</div>
          {data.alertas.length === 0 ? <p className="muted" style={{ margin: 0 }}>Sin alertas.</p> : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
              {data.alertas.map((a, i) => <li key={i} style={{ marginBottom: 3 }}>{a}</li>)}
            </ul>
          )}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11, textAlign: "center" }}>Mes: {monthNames[mm - 1]} {yy} · Los valores se actualizan según los registros de cada módulo.</p>
    </section>
  );
}

// Gráfico de barras Compras vs Ventas (SVG puro, sin librerías).
/**
 * Barras horizontales comparativas. Sirve para leer de un vistazo la
 * estructura del balance y del resultado, sin depender de librerías.
 */
function BarrasFinancieras({ datos, formato }: {
  datos: Array<{ etiqueta: string; valor: number; color: string }>;
  formato: (n: number) => string;
}) {
  const max = Math.max(1, ...datos.map((d) => Math.abs(d.valor)));
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
      {datos.map((d) => (
        <div key={d.etiqueta}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
            <span style={{ fontWeight: 600 }}>{d.etiqueta}</span>
            <span style={{ fontWeight: 700, color: d.valor < 0 ? "#b91c1c" : "inherit" }}>{formato(d.valor)}</span>
          </div>
          <div style={{ height: 12, background: "var(--c-surface-3)", borderRadius: 99, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.max(2, (Math.abs(d.valor) / max) * 100)}%`,
                height: "100%",
                background: d.color,
                borderRadius: 99,
                transition: "width .4s cubic-bezier(.2,.6,.3,1)"
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Medidor semicircular para un indicador con su meta. */
function MedidorIndicador({ titulo, valor, meta, ok, sufijo = "" }: {
  titulo: string; valor: number; meta: string; ok: boolean; sufijo?: string;
}) {
  const R = 52, C = 62;
  const pct = Math.max(0, Math.min(1, valor / (valor > 3 ? valor * 1.4 : 3)));
  const angulo = Math.PI * (1 - pct);
  const x = C + R * Math.cos(angulo);
  const y = C - R * Math.sin(angulo) + 6;
  const color = ok ? "#16a34a" : "#f59e0b";
  return (
    <div style={{ textAlign: "center", minWidth: 128 }}>
      <svg viewBox="0 0 124 78" width="124" height="78">
        <path d={`M ${C - R} ${C + 6} A ${R} ${R} 0 0 1 ${C + R} ${C + 6}`} fill="none" stroke="var(--c-surface-3)" strokeWidth="11" strokeLinecap="round" />
        <path d={`M ${C - R} ${C + 6} A ${R} ${R} 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" />
        <text x={C} y={C} textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--c-text)">
          {valor.toFixed(sufijo === "%" ? 1 : 2)}{sufijo}
        </text>
      </svg>
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: -6 }}>{titulo}</div>
      <div className="muted" style={{ fontSize: 11 }}>Meta {meta}</div>
    </div>
  );
}

function ComprasVentasChart({ serie }: { serie: Array<{ month: string; compras: number; ventas: number }> }) {
  const W = 520, H = 240, pad = 34, top = 20;
  const max = Math.max(1, ...serie.flatMap((s) => [s.compras, s.ventas]));
  const groupW = (W - pad * 2) / serie.length;
  const barW = groupW * 0.32;
  const yFor = (v: number) => top + (H - top - pad) * (1 - v / max);
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 560 }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <line key={t} x1={pad} x2={W - pad} y1={yFor(max * t)} y2={yFor(max * t)} stroke="#eef2f7" />
      ))}
      {serie.map((s, i) => {
        const gx = pad + groupW * i + groupW / 2;
        const mLabel = meses[Number(s.month.split("-")[1]) - 1] ?? s.month.slice(5);
        return (
          <g key={s.month}>
            <rect x={gx - barW - 2} y={yFor(s.compras)} width={barW} height={Math.max(0, H - pad - yFor(s.compras))} fill="#16a34a" rx={2} />
            <rect x={gx + 2} y={yFor(s.ventas)} width={barW} height={Math.max(0, H - pad - yFor(s.ventas))} fill="#2563eb" rx={2} />
            <text x={gx} y={H - pad + 14} textAnchor="middle" fontSize="10" fill="#64748b">{mLabel}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Dona de distribución de inventario por accionista.
function InventarioDonut({ data }: { data: Array<{ name: string; value: number }> }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ef4444"];
  const R = 70, r = 42, C = 90;
  let acc = 0;
  const arcs = data.map((d, i) => {
    const frac = total > 0 ? d.value / total : 0;
    const a0 = acc * 2 * Math.PI - Math.PI / 2;
    acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    const xi1 = C + r * Math.cos(a1), yi1 = C + r * Math.sin(a1);
    const xi0 = C + r * Math.cos(a0), yi0 = C + r * Math.sin(a0);
    return { d: `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${xi1} ${yi1} A${r} ${r} 0 ${large} 0 ${xi0} ${yi0} Z`, color: colors[i % colors.length], pct: Math.round(frac * 100) };
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <svg viewBox="0 0 180 180" width="150" height="150">
        {total === 0 ? <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#e5e7eb" strokeWidth={R - r} /> :
          arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} />)}
      </svg>
      <div style={{ display: "grid", gap: 6 }}>
        {data.map((d, i) => (
          <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: colors[i % colors.length], display: "inline-block" }} />
            <span style={{ fontWeight: 600 }}>{d.name}</span>
            <span className="muted">{Number(d.value).toFixed(1)} QQ ({total > 0 ? Math.round((d.value / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DryingLotSelector({
  selectedLots,
  editing,
  onRemove
}: {
  selectedLots: DryingTunnelLot[];
  editing: boolean;
  onRemove: (lotId: string) => void;
}) {
  return (
    <section className="lotSelector">
      <span>Lotes utilizados</span>
      {selectedLots.length === 0 && <p className="muted">Agrega uno o varios lotes desde el selector.</p>}
      {selectedLots.map((lot) => (
        <div className="usedLotRow" key={lot.lot_id}>
          <div>
            <strong>{lot.farmer_name ?? "Sin agricultor"}</strong>
            <small>{lot.lot_code} - {Number(lot.quintals ?? 0).toFixed(2)} QQ</small>
          </div>
          {!editing && (
            <button type="button" onClick={() => onRemove(lot.lot_id)}>
              Quitar
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
function DryingReportsPanel({
  reports,
  onEdit
}: {
  reports: DryingTunnelReport[];
  onEdit: (report: DryingTunnelReport) => void;
}) {
  return (
    <section className="tracePanel dryingReportsPanel">
      <h2>Secados guardados</h2>
      {reports.length === 0 && <p className="muted">Aun no hay informes de secado guardados.</p>}
      {reports.map((report) => (
        <article className="dryingReportCard" key={report.id}>
          <div>
            <strong>Tunel {report.tunnel_number} · {report.status === "COMPLETED" ? "Finalizado" : "En proceso"}</strong>
            <small>
              {Number(report.total_quintals ?? 0).toFixed(2)} QQ · {report.lots.length} lote(s) · {report.dryer_name ?? "Sin secadora"} · Secador: {report.operator_name || "—"}
            </small>
            <small>Tipo: {report.rice_type === "CORRIENTE" ? "Corriente" : "0.11"}</small>
            <small>{report.lots.map((lot) => `${lot.farmer_name ?? "Sin agricultor"} (${Number(lot.quintals ?? 0).toFixed(2)} QQ)`).join(" + ")}</small>
          </div>
          {report.status !== "COMPLETED" && (
            <button type="button" onClick={() => onEdit(report)}>Editar</button>
          )}
        </article>
      ))}
    </section>
  );
}

function TicketPreview() {
  return (
    <div className="ticketPreview">
      <h2>Vista previa de ticket 58 mm</h2>
      <pre>{`  *** BASCULA ERP ***
  Piladora de Arroz
========================
Lote   : LT-2026-0001
Fecha  : 23/06/2026 22:30
Agric. : PEDRO RAMIREZ
Tipo   : 0.11
------------------------
Bruto  :  12,000 kg
Tara   :   4,000 kg
NETO   :   8,000 kg
QQ     :     113.55
Clasif.:       80%
========================
Firma: ______________`}</pre>
    </div>
  );
}

function ProductionSummary({ result }: { result: ProductionResult | null }) {
  if (!result) {
    return (
      <section className="tablePanel">
        <h2>Resultado del proceso</h2>
        <p className="muted">Cierra un pilado para ver merma, rendimiento, producto principal, subproductos y estado de maquila.</p>
      </section>
    );
  }

  return (
    <section className="tablePanel">
      <h2>Resultado del proceso</h2>
      {result.packagingAlert?.isCritical && (
        <div className="alertBox">
          Stock critico: {result.packagingAlert.nombre} quedo en {result.packagingAlert.stockActual.toFixed(0)} unidades.
        </div>
      )}
      <div className="summaryGrid">
        <Metric title="Entrada cascara" value={`${Number(result.yield.input_paddy_kg).toFixed(2)} kg`} />
        <Metric title="Arroz blanco" value={`${Number(result.yield.white_rice_qty).toFixed(2)} ${result.yield.white_rice_unit}`} />
        <Metric title="Arrocillo fino" value={`${Number(result.yield.fine_broken_rice_qty ?? 0).toFixed(2)} ${result.yield.fine_broken_rice_unit ?? "QQ"}`} />
        <Metric title="Merma" value={`${Number(result.yield.process_loss_kg).toFixed(2)} kg`} />
        <Metric title="Rendimiento" value={`${Number(result.yield.yield_percent).toFixed(2)}%`} />
        <Metric title="Modo" value={result.custodyMode ? "Maquila" : "Propio"} />
      </div>
      {result.maquila && (
        <div className="maquilaBox">
          <strong>Cuenta por cobrar de maquila</strong>
          <span>{Number(result.maquila.serviceQuantityQq).toFixed(2)} QQ x {money(result.maquila.serviceRatePerQq)} = {money(result.maquila.serviceAmount)}</span>
          <small>Los productos quedaron en custodia de terceros, no en inventario propio.</small>
        </div>
      )}
    </section>
  );
}

function ProcessFlowPanel({ flow }: { flow: ProcessFlow | null }) {
  if (!flow) {
    return (
      <section className="tracePanel">
        <h2>Flujo enlazado del lote</h2>
        <p className="muted">Selecciona un lote para ver sus informes: Bascula, Secado, Tuneles, Pilado, Rendimiento y Ventas.</p>
      </section>
    );
  }

  const reportsByStage = new Map(flow.reports.map((report) => [report.stage, report]));
  const tunnelReports = [1, 2, 3].map((tunnel) => flow.reports.find((report) => report.stage === `TUNEL_${tunnel}`));

  return (
    <section className="tracePanel">
      <div className="traceHeader">
        <div>
          <h2>{flow.lot.lot_code}</h2>
          <p className="muted">
            {flow.lot.farmer_name ?? "Sin agricultor"} · {flow.lot.status} · {flow.lot.is_maquila ? "Maquila" : "Propio"}
          </p>
        </div>
        <span className="pill online">{flow.reports.length} informes</span>
      </div>

      <div className="flowLine">
        <StageCard title="Bascula" report={reportsByStage.get("BASCULA")} />
        <span className="flowArrow">→</span>
        <div className="dryingBranch">
          <StageCard title="Secado" report={reportsByStage.get("SECADO")} />
          <div className="tunnelGrid">
            {tunnelReports.map((report, index) => (
              <StageCard key={index} title={`Tunel ${index + 1}`} report={report} />
            ))}
          </div>
        </div>
        <span className="flowArrow">→</span>
        <StageCard title="Pilado" report={reportsByStage.get("PILADO")} />
        <span className="flowArrow">→</span>
        <StageCard title="Rendimiento" report={reportsByStage.get("RENDIMIENTO")} />
        <span className="flowArrow">→</span>
        <StageCard title="Ventas" report={reportsByStage.get("VENTA")} />
      </div>

      <div className="traceTables">
        <DataList
          title="Informes del lote"
          headers={["#", "Etapa", "Informe", "Fecha"]}
          rows={flow.reports.map((report) => [
            report.sequence,
            stageLabel(report.stage),
            report.report_title,
            new Date(report.created_at).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" })
          ])}
        />
        <DataList
          title="Túneles registrados"
          headers={["Túnel", "QQ", "Estado", "Consumo"]}
          rows={flow.tunnels.map((tunnel) => [
            `Túnel ${tunnel.tunnel_number}`,
            `${Number(tunnel.total_quintals ?? 0).toFixed(2)} QQ`,
            tunnel.status === "COMPLETED" ? "✓ Finalizado" : "En proceso",
            `Gas ${Number(tunnel.gas_used ?? 0).toFixed(1)} / Diesel ${Number(tunnel.diesel_used ?? 0).toFixed(1)}`
          ])}
        />
      </div>
    </section>
  );
}

function StageCard({ title, report }: { title: string; report?: ProcessReport }) {
  return (
    <article className={report ? "stageCard done" : "stageCard"}>
      <span>{title}</span>
      <strong>{report ? "Con informe" : "Pendiente"}</strong>
      {report && <small>#{report.sequence} {report.report_title}</small>}
    </article>
  );
}

function PayablePayForm({ payable, onPay }: { payable: AccountPayable; onPay: (amount: number) => void }) {
  const [amount, setAmount] = React.useState(String(Number(payable.balance).toFixed(2)));
  return (
    <div className="payablePayRow">
      <input
        type="number"
        min="0.01"
        step="0.01"
        max={Number(payable.balance)}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="payableInput"
      />
      <button
        type="button"
        className="primary"
        onClick={() => { onPay(Number(amount)); }}
      >
        Pagar
      </button>
    </div>
  );
}

/**
 * Cobro con abono parcial: el campo viene con el saldo completo, pero el
 * cobrador puede escribir menos si el cliente abona solo una parte hoy. El
 * saldo restante queda pendiente para el próximo abono.
 */
function AbonoForm({ saldo, disabled, onAbonar }: { saldo: number; disabled?: boolean; onAbonar: (monto: number) => void }) {
  const [monto, setMonto] = React.useState(String(saldo.toFixed(2)));
  const valor = Number(monto);
  const parcial = valor > 0 && valor < saldo - 0.001;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
      <input
        type="number" min="0.01" step="0.01" max={saldo}
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        disabled={disabled}
        className="payableInput"
        style={{ maxWidth: 130 }}
        aria-label="Monto del abono"
      />
      <button
        type="button"
        className="primary"
        disabled={disabled || !(valor > 0) || valor > saldo + 0.001}
        onClick={() => onAbonar(valor)}
        title={disabled ? "Abre una caja para registrar el cobro" : ""}
      >
        {valor >= saldo - 0.001 ? "💵 Cobrar todo" : "💵 Registrar abono"}
      </button>
      {parcial && <small className="muted">Queda {money(round2(saldo - valor))} pendiente</small>}
    </div>
  );
}

function riceTypeLabel(value: string | null | undefined) {
  return value === "CORRIENTE" ? "Corriente" : "0.11";
}

function isCurrentStockProduct(product: Product) {
  return [
    "CASCARA-011",
    "CASCARA-CORRIENTE",
    "ARROZ-PILADO-011",
    "ARROZ-PILADO-CORRIENTE",
    "ARROCILLO-34",
    "ARROCILLO-FINO",
    "POLVILLO"
  ].includes(product.code);
}

function buildDisplayStockRows(products: Product[], stock: StockRow[], fallbackWarehouse: string) {
  return products.map((product) => {
    const row = stock.find((item) => item.code === product.code);
    return {
      product_name: product.name,
      warehouse_name: row?.warehouse_name ?? fallbackWarehouse,
      quantity: row?.quantity ?? 0,
      unit: row?.unit ?? product.unit
    };
  });
}

function numberOrUndefined(value: FormDataEntryValue | null) {
  if (value === null || value === "") return undefined;
  return Number(value);
}

function stringOrUndefined(value: FormDataEntryValue | null) {
  if (value === null || value === "") return undefined;
  return String(value);
}

function safeResetForm(form?: HTMLFormElement | null) {
  if (form) form.reset();
}

function dateTimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

/** Hora corta HH:MM para reportes (ej. hora de secado). "—" si no hay dato. */
function fmtHoraSecado(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
}

function qqAndPoundsToQq(item: { qq: number; pounds: number }) {
  return Number(item.qq || 0) + Number(item.pounds || 0) / QQ_TO_LB;
}

function qqAndPoundsToKg(item: { qq: number; pounds: number }) {
  return qqAndPoundsToQq(item) * QQ_TO_LB * LB_TO_KG;
}

function sacksNeededForOrder(item: OrderPackageState) {
  const totalPounds = qqAndPoundsToQq(item) * QQ_TO_LB;
  const sackWeight = Number(item.sackWeightLb || 0);
  if (totalPounds <= 0 || sackWeight <= 0) return 0;
  return Math.ceil(totalPounds / sackWeight);
}

function calculateMillingYields(report: MillingReportState, pilado: number, totalCascara: number): MillingYieldResult | null {
  const broken34 = Number(report.broken34 || 0);
  const fineBroken = Number(report.fineBroken || 0);
  const polvillo = Number(report.polvillo || 0);

  if (!Number.isFinite(totalCascara) || totalCascara <= 0) return null;

  return {
    pilado: (pilado - totalCascara) / totalCascara,
    arrocillo: (broken34 + fineBroken) / totalCascara,
    polvillo: polvillo / totalCascara
  };
}

function formatYield(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function packagePayload(productId: string, warehouseId: string, item: ProductionPackageState[ProductionPackageKey]) {
  return {
    product_id: productId,
    warehouse_id: warehouseId,
    quantity: qqAndPoundsToQq(item),
    unit: "QQ"
  };
}

function stageLabel(stage: string) {
  return stage
    .replace("BASCULA", "Bascula")
    .replace("SECADO", "Secado")
    .replace("TUNEL_", "Tunel ")
    .replace("PILADO", "Pilado")
    .replace("RENDIMIENTO", "Rendimiento")
    .replace("VENTA", "Venta");
}
