import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiGet, apiPost, apiPut, checkHealth, getActiveAccionistaId, setActiveAccionistaId } from "./api";

type Farmer = {
  id: string;
  identification: string | null;
  full_name: string;
  phone: string | null;
  accionista_id: string | null;
  pending_advance_balance: number;
};

type Product = {
  id: string;
  code: string;
  name: string;
  product_type: string;
  unit: string;
};

type Warehouse = {
  id: string;
  name: string;
  type: string;
};

type Lot = {
  id: string;
  farmer_id: string;
  lot_code: string;
  farmer_name: string | null;
  rice_type?: string | null;
  status: string;
  accionista_id?: string | null;
  quintals: string | number | null;
  net_weight?: string | number | null;
  qualification: string | number | null;
};

// Ingreso de materia prima: un pesaje de báscula que todavía no pertenece a un
// lote. El lote se forma agrupando varios de estos en un túnel de secado.
type MateriaPrimaEntry = {
  id: string;
  ticket_number: string;
  farmer_name: string | null;
  rice_type: string | null;
  is_maquila: boolean;
  quintals: string | number | null;
  net_weight: string | number | null;
  qualification: string | number | null;
};

type Dashboard = {
  active_farmers: number;
  tickets_today: number;
  owned_stock: number;
  pending_advances: number;
  pending_payables: number;
  sales_today: number;
  current_cash_register: { id: string; name: string; opening_balance: string } | null;
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

type Accionista = { id: string; name: string; code: string };

// Módulos asignables a un operador (deben coincidir con el backend).
const APP_MODULES = [
  "Bascula",
  "Secadoras",
  "Produccion",
  "Inventario",
  "Ventas",
  "Caja",
  "Liquidaciones",
  "Fomentos",
  "Agricultores"
] as const;

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
  is_active: boolean;
  created_at: string;
  role_name: string | null;
  allowed_modules: string[] | null;
  accionista_ids?: string[] | null;
};

type AdminAccionista = { id: string; name: string; code: string; is_active: boolean };

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
  secador_guardiania: number;
  secador_per_tunel: number;
};

const defaultLaborRates: LaborRates = {
  pilador_per_qq: 0.15,
  pilador_per_saca: 0.15,
  estibador_per_qq: 0.1,
  estibador_per_saca: 0.25,
  estibador_per_arrocillo: 0.1,
  secador_guardiania: 10,
  secador_per_tunel: 5
};

type WorkerSummary = {
  worker_role: string;
  worker_name: string;
  cnt: number;
  qq: number;
  sacas: number;
  arrocillo: number;
  base_amount: number;
  net_amount: number;
  pending_amount: number | null;
  paid_amount: number | null;
  advances: number;
  to_pay: number;
};

type CuadrillaActivity = { id: string; name: string; unit_rate: number; is_active: boolean };
type CuadrillaEntry = { id: string; work_date: string; activity_name: string; worker_name: string; quantity: number; unit_rate: number; subtotal: number };
type CuadrillaSummaryRow = { worker_name: string; entradas: number; total: number; anticipos: number; neto: number };
type CuadrillaAdvance = { id: string; worker_name: string; amount: number; balance: number; concept: string | null; status: string; issued_at: string };

type PiladoService = { id: string; service_date: string; cliente: string; quintals: number; rate_per_qq: number; total: number; saldo: number; estado: string; notes: string | null };
type PiladoBalance = { id: string; name: string; saldo: number };

type PanelAccionista = {
  id: string; name: string;
  compras_total: number; compras_qq: number; compras_cnt: number;
  ventas_total: number; ventas_qq: number; ventas_cnt: number;
  inventario_qq: number; inventario_valor: number; banco_balance: number;
};
type PanelData = {
  month: string;
  kpis: { compras: number; ventas: number; utilidad: number; margen: number; bancos: number; saldo_general: number };
  per_accionista: PanelAccionista[];
  totales: { compras_qq: number; ventas_qq: number; inventario_qq: number; inventario_valor: number; compras_cnt: number; ventas_cnt: number };
  serie: Array<{ month: string; compras: number; ventas: number }>;
  por_cobrar: { total: number; cnt: number };
  por_pagar: { total: number; cnt: number };
  prestamos: { total: number; cnt: number };
  alertas: string[];
};

type ReportKind = "resumen" | "ventas" | "liquidaciones" | "gastos" | "produccion" | "porcobrar";

const reportEndpoint: Record<Exclude<ReportKind, "resumen">, string> = {
  ventas: "sales",
  liquidaciones: "liquidations",
  gastos: "expenses",
  produccion: "production",
  porcobrar: "receivable-aging"
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
  code?: string;
  product_name: string;
  product_type?: string;
  warehouse_name: string;
  ownership: string;
  quantity: string | number;
  unit: string;
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
  dry_start_at: string | null;
  dry_end_at: string | null;
  gas_used: string | number;
  diesel_used: string | number;
  dryer_name: string | null;
  status: string;
  operator_name: string | null;
  notes: string | null;
  is_processed?: boolean;
  lots: DryingTunnelLot[];
};

type DryingTunnelLot = {
  lot_id: string;
  lot_code: string;
  farmer_name: string | null;
  net_weight_kg: string | number;
  quintals: string | number;
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

const navGroups: Array<{ label: string; tabs: string[] }> = [
  { label: "Principal", tabs: ["Dashboard"] },
  { label: "Operación", tabs: ["Bascula", "Secadoras", "Produccion", "Inventario"] },
  { label: "Comercial", tabs: ["Ventas", "Caja"] },
  { label: "Cuentas", tabs: ["Por Cobrar", "Por Pagar"] },
  { label: "Finanzas", tabs: ["Liquidaciones", "Fomentos", "Agricultores", "Nomina", "Cuadrilla", "Servicio Pilado"] },
  { label: "Sistema", tabs: ["Reportes", "Configuracion"] }
];
const tabs = navGroups.flatMap((group) => group.tabs);

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
    case "Reportes":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="5" y1="11" x2="5" y2="8"/><line x1="8" y1="11" x2="8" y2="5"/><line x1="11" y1="11" x2="11" y2="7"/></svg>;
    case "Configuracion":
      return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="4" x2="14" y2="4"/><circle cx="6" cy="4" r="1.7" fill="currentColor" stroke="none"/><line x1="2" y1="8" x2="14" y2="8"/><circle cx="10.5" cy="8" r="1.7" fill="currentColor" stroke="none"/><line x1="2" y1="12" x2="14" y2="12"/><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg>;
    default:
      return null;
  }
}
const LB_TO_KG = 0.45359237;
const QQ_TO_LB = 100;
const millingDraftStorageKey = "bascula-erp:milling-report-draft";
const round2 = (n: number) => Math.round(n * 100) / 100;
const dryerOptions = ["Secadora 1", "Secadora 2", "Secadora 3"];
const piladoPresentations = ["10 LB", "25 LB", "50 LB", "98 LB", "100 LB"];

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
  polvillo: ""
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
  const [selectedDryingLotIds, setSelectedDryingLotIds] = useState<string[]>([]);
  const [editingDryingReport, setEditingDryingReport] = useState<DryingTunnelReport | null>(null);
  const [productionDryingId, setProductionDryingId] = useState(() => loadMillingDraft().productionDryingId);
  const [productionPackages, setProductionPackages] = useState<ProductionPackageState>(defaultProductionPackages);
  const [orderPackage, setOrderPackage] = useState<OrderPackageState>(defaultOrderPackage);
  const [weighingRiceType, setWeighingRiceType] = useState<"0.11" | "CORRIENTE">("0.11");

  // ── Tickets sincronizados de la app de báscula ──────────────────────────────
  const [basculaTickets, setBasculaTickets] = useState<BasculaTicket[]>([]);
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
  const [millingReport, setMillingReport] = useState<MillingReportState>(() => loadMillingDraft().report);
  const [millingPiladoEntries, setMillingPiladoEntries] = useState<MillingPiladoEntry[]>(() => loadMillingDraft().piladoEntries);
  const [millingPiladoPresentation, setMillingPiladoPresentation] = useState(piladoPresentations[4]);
  const [millingPiladoQq, setMillingPiladoQq] = useState("");
  const [millingDraftSavedAt, setMillingDraftSavedAt] = useState<string | null>(() => loadMillingDraft().savedAt);
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
  const [discountsOpen, setDiscountsOpen] = useState(false);
  const [liqDiscounts, setLiqDiscounts] = useState({ fomento: "", bascula: "", flete: "", cosechadora: "" });
  const [liqResult, setLiqResult] = useState<LiqResultItem[] | null>(null);

  // ── Caja ──────────────────────────────────────────────────────────────────
  const [cajaSubTab, setCajaSubTab] = useState<"resumen" | "anticipo" | "movimiento" | "gastos" | "sacos" | "mantenimiento" | "venta_detalle" | "cuentas" | "fomentos">("resumen");
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [cashSummary, setCashSummary] = useState<CashSummary | null>(null);
  const [cashPayables, setCashPayables] = useState<AccountPayable[]>([]);
  const [anticipoFarmerId, setAnticipoFarmerId] = useState("");

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
  const [secadorSugg, setSecadorSugg] = useState<Array<{ worker_name: string; work_date: string; tunnels: number; suggested_amount: number; already_generated: boolean }> | null>(null);
  const [secadorForm, setSecadorForm] = useState({ worker_name: "", work_date: nominaToday, tunnels: "0" });
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

  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [settingsForm, setSettingsForm] = useState<AppSettings>(defaultAppSettings);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [newUserForm, setNewUserForm] = useState({ name: "", username: "", password: "", role: "OPERADOR" as "ADMINISTRADOR" | "OPERADOR", modules: [] as string[] });
  const [permsEditor, setPermsEditor] = useState<{ user: AdminUser; modules: string[] } | null>(null);
  const [adminAccionistas, setAdminAccionistas] = useState<AdminAccionista[]>([]);
  const [newAccionistaForm, setNewAccionistaForm] = useState({ name: "", code: "" });
  const [accionistaEditor, setAccionistaEditor] = useState<{ user: AdminUser; ids: string[] } | null>(null);
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
  // ── Pilador / Estibador en Producción ────────────────────────────────────
  const [piladorName, setPiladorName] = useState("");
  const [estibadorName, setEstibadorName] = useState("");

  // ── Inventario de Sacos ───────────────────────────────────────────────────
  const [sackInventory, setSackInventory] = useState<SackInventory[]>([]);
  const [sackMovements, setSackMovements] = useState<SackMovement[]>([]);
  const [sackMovForm, setSackMovForm] = useState({ sack_id: "", movement: "ENTRADA" as "ENTRADA"|"SALIDA", cantidad: "", concepto: "" });

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
    quantity: number;
    unit_price: number;
  };
  const [saleLineItems, setSaleLineItems] = useState<SaleLineItem[]>([]);
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
    equipment_id: "",
    maintenance_type: "CORRECTIVO" as "REPUESTO" | "MANO_OBRA" | "PREVENTIVO" | "CORRECTIVO",
    description: "",
    provider: "",
    invoice_number: "",
    receipt_photo_url: "",
    amount: ""
  });
  const [newEquipmentForm, setNewEquipmentForm] = useState({
    name: "",
    type: "PILADORA" as "PILADORA" | "SECADORA" | "MOTOR" | "OTRO",
    status: "ACTIVA" as "ACTIVA" | "MANTENIMIENTO" | "FUERA_SERVICIO"
  });

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
  const selectedDryingLots = useMemo(
    () =>
      editingDryingReport
        ? editingDryingReport.lots
        : availableDryingLots.filter((entry) => selectedDryingLotIds.includes(entry.id)).map((entry) => ({
            lot_id: entry.id,
            lot_code: entry.ticket_number,
            farmer_name: entry.farmer_name,
            net_weight_kg: entry.net_weight ?? 0,
            quintals: entry.quintals ?? 0
          })),
    [availableDryingLots, editingDryingReport, selectedDryingLotIds]
  );
  const selectedDryingTotalQq = useMemo(
    () => (Array.isArray(selectedDryingLots) ? selectedDryingLots : []).reduce((sum, lot) => sum + Number(lot.quintals ?? 0), 0),
    [selectedDryingLots]
  );
  const selectedDryingTotalKg = useMemo(
    () => (Array.isArray(selectedDryingLots) ? selectedDryingLots : []).reduce((sum, lot) => sum + Number(lot.net_weight_kg ?? 0), 0),
    [selectedDryingLots]
  );
  const selectableDryingLots = useMemo(
    () => availableDryingLots.filter((lot) => !selectedDryingLotIds.includes(lot.id)),
    [availableDryingLots, selectedDryingLotIds]
  );
  const productionDryingReports = useMemo(
    () => dryingReports.filter((report) => report.status === "COMPLETED" && !report.is_processed),
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
  const availableLots = useMemo(
    () => lots.filter((l) => l.status !== "LIQUIDATED"),
    [lots]
  );

  const farmerLots = useMemo(
    () => liqFarmerId ? availableLots.filter((l) => l.farmer_id === liqFarmerId) : [],
    [availableLots, liqFarmerId]
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
    () => farmers.filter((f) => availableLots.some((l) => l.farmer_id === f.id)),
    [farmers, availableLots]
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
        pendingQq: availableLots
          .filter((l) => l.farmer_id === f.id)
          .reduce((s, l) => s + Number(l.quintals ?? 0), 0),
      }))
      .filter((f) => f.pendingQq > 0),
    [farmers, availableLots]
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
      });
    }

    return batches;
  }, [liquidacionesList]);

  const liqDiscountsTotal = useMemo(() =>
    Object.values(liqDiscounts).reduce((sum, v) => sum + Number(v || 0), 0),
    [liqDiscounts]
  );

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
        liqRows
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
        apiGet<LiqRecord[]>("/liquidations")
      ]);

      setDashboard(dash);
      setFarmers(farmerRows);
      setProducts(productRows);
      setWarehouses(warehouseRows);
      setLots(lotRows);
      setAvailableDryingLots(dryingLotRows);
      setDryingReports(dryingReportRows);
      setLiquidacionesList(liqRows);
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
  }, [authUser]);

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

  // Pestañas visibles según los módulos asignados al usuario.
  const visibleTabs = useMemo(() => {
    if (!authUser) return [] as string[];
    if (isAdmin) return tabs;
    const allowed = new Set(authUser.allowed_modules ?? []);
    return tabs.filter((tab) => {
      if (tab === "Dashboard") return true;
      if (tab === "Configuracion" || tab === "Reportes") return false;
      if (tab === "Por Cobrar" || tab === "Por Pagar") return allowed.has("Caja") || allowed.has("Ventas");
      if (tab === "Nomina") return allowed.has("Caja") || allowed.has("Produccion");
      if (tab === "Cuadrilla") return allowed.has("Caja") || allowed.has("Produccion");
      if (tab === "Servicio Pilado") return allowed.has("Caja") || allowed.has("Produccion");
      return allowed.has(tab);
    });
  }, [authUser, isAdmin]);

  useEffect(() => {
    if (authUser && !visibleTabs.includes(activeTab)) {
      setActiveTab("Dashboard");
    }
  }, [authUser, visibleTabs, activeTab]);

  async function refreshConfig() {
    const settings = await apiGet<AppSettings>("/settings");
    setAppSettings(settings);
    setSettingsForm(settings);
    const rates = await apiGet<LaborRates>("/labor/rates").catch(() => null);
    if (rates) setLaborRatesForm(rates);
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
    await apiPut(`/auth/users/${accionistaEditor.user.id}/accionistas`, { accionista_ids: accionistaEditor.ids });
    addToast(`Accionistas de ${accionistaEditor.user.username} actualizados`, "success");
    setAccionistaEditor(null);
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

  async function addSecadorDayManual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (secadorForm.worker_name.trim().length < 2) { addToast("Ingresa el nombre del secador", "error"); return; }
    await generateSecadorDays([{ worker_name: secadorForm.worker_name.trim(), work_date: secadorForm.work_date, tunnels: Number(secadorForm.tunnels) || 0 }]);
    setSecadorForm({ ...secadorForm, tunnels: "0" });
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

  async function settlePilado(id: string) {
    await apiPost(`/pilado/services/${id}/settle`, {});
    addToast("Servicio saldado", "success");
    await refreshPilado();
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

  function printHistoryReceipt(h: { worker_role: string; worker_name: string; week_start: string; cnt: number; qq: number; sacas: number; arrocillo: number; earned: number; advances_applied: number }) {
    // Reconstruye una fila de resumen para reutilizar el recibo.
    const cashPaid = round2(h.earned - h.advances_applied);
    const row: WorkerSummary = {
      worker_role: h.worker_role, worker_name: h.worker_name, cnt: h.cnt,
      qq: h.qq, sacas: h.sacas, arrocillo: h.arrocillo,
      base_amount: h.earned,
      net_amount: cashPaid, pending_amount: 0, paid_amount: cashPaid,
      advances: h.advances_applied, to_pay: 0
    };
    const weekEnd = new Date(h.week_start); weekEnd.setDate(weekEnd.getDate() + 6);
    printWorkerReceipt(row, h.week_start, weekEnd.toISOString().slice(0, 10));
  }

  function nominaExportData(): { title: string; headers: string[]; rows: (string | number)[][]; totals: (string | number)[] } {
    const m2 = (n: number) => Number(n || 0).toFixed(2);
    const roleLabel = (r: string) => (r === "PILADOR" ? "Pilador" : r === "ESTIBADOR" ? "Estibador" : "Secador");
    const rows = nominaRows.map((r) => [
      roleLabel(r.worker_role), r.worker_name, r.cnt,
      Number(r.qq).toFixed(2), Number(r.sacas).toFixed(0),
      m2(r.base_amount), m2(r.advances ?? 0), m2((r.pending_amount ?? 0) > 0 ? (r.to_pay ?? 0) : 0), m2(r.paid_amount ?? 0)
    ]);
    const t = nominaRows.reduce((a, r) => ({
      base: a.base + r.base_amount, adv: a.adv + (r.advances ?? 0),
      pay: a.pay + ((r.pending_amount ?? 0) > 0 ? (r.to_pay ?? 0) : 0), paid: a.paid + (r.paid_amount ?? 0)
    }), { base: 0, adv: 0, pay: 0, paid: 0 });
    return {
      title: "Nómina de trabajadores",
      headers: ["Rol", "Trabajador", "Reg.", "QQ", "Sacas", "Ganó", "Anticipos", "A pagar", "Pagado"],
      rows,
      totals: ["TOTALES", "", "", "", "", m2(t.base), m2(t.adv), m2(t.pay), m2(t.paid)]
    };
  }

  function printWorkerReceipt(row: WorkerSummary, periodFrom?: string, periodTo?: string) {
    const from = periodFrom ?? nominaFrom;
    const to = periodTo ?? nominaTo;
    const earned = row.base_amount;
    const adv = row.advances ?? 0;
    const net = row.pending_amount != null && row.pending_amount > 0 ? (row.to_pay ?? 0) : (row.paid_amount ?? 0);
    const roleLabel = row.worker_role === "PILADOR" ? "Pilador" : row.worker_role === "ESTIBADOR" ? "Estibador" : "Secador";
    const detailRows = row.worker_role === "SECADOR"
      ? `<tr><td>Días trabajados</td><td class="r">${row.cnt}</td></tr>`
      : `<tr><td>Piladas</td><td class="r">${row.cnt}</td></tr>
         <tr><td>Quintales de arroz</td><td class="r">${Number(row.qq).toFixed(2)} QQ</td></tr>
         <tr><td>Sacas (@)</td><td class="r">${Number(row.sacas).toFixed(0)}</td></tr>
         ${Number(row.arrocillo) > 0 ? `<tr><td>Arrocillo</td><td class="r">${Number(row.arrocillo).toFixed(2)} QQ</td></tr>` : ""}`;
    const html = `<html><head><meta charset="utf-8"><title>Recibo ${row.worker_name}</title><style>
      body{font-family:Arial,sans-serif;font-size:13px;margin:16mm;max-width:520px}
      h1{font-size:18px;margin:0 0 2px;text-align:center}
      h2{font-size:12px;font-weight:normal;margin:0;text-align:center;color:#555}
      h3{font-size:15px;margin:16px 0 4px;text-align:center;text-transform:uppercase;letter-spacing:1px}
      .meta{display:flex;justify-content:space-between;margin:10px 0;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      td{padding:5px 8px;border-bottom:1px solid #eee}
      td.r{text-align:right;font-variant-numeric:tabular-nums}
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
      <table>
        ${detailRows}
        <tr><td>Total ganado</td><td class="r">$${earned.toFixed(2)}</td></tr>
        ${adv > 0 ? `<tr class="disc"><td>Anticipos recibidos</td><td class="r">-$${adv.toFixed(2)}</td></tr>` : ""}
        <tr class="tot"><td>NETO A PAGAR</td><td class="r">$${net.toFixed(2)}</td></tr>
      </table>
      <div class="sig"><hr/><span>Firma del trabajador</span></div>
    </body></html>`;
    const w = window.open("", "_blank", "width=520,height=600");
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
    await apiPost("/auth/users", {
      name: newUserForm.name.trim(),
      username: newUserForm.username.trim().toLowerCase(),
      password: newUserForm.password,
      role: newUserForm.role,
      allowed_modules: newUserForm.role === "OPERADOR" ? newUserForm.modules : []
    });
    setNewUserForm({ name: "", username: "", password: "", role: "OPERADOR", modules: [] });
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

  async function refreshSacks() {
    const [inv, movs] = await Promise.all([
      apiGet<SackInventory[]>("/sacks"),
      apiGet<SackMovement[]>("/sacks/movements/recent")
    ]);
    setSackInventory(inv);
    setSackMovements(movs);
  }

  async function refreshCustomersAndSales() {
    const [custs, sls, ar] = await Promise.all([
      apiGet<Customer[]>("/customers"),
      apiGet<Sale[]>("/sales"),
      apiGet<AccountsReceivable[]>("/receivable")
    ]);
    setCustomers(custs);
    setSales(sls);
    setAccountsReceivable(ar.filter(a => a.status !== "PAID"));
  }

  async function refreshBasculaTickets() {
    const qs = ticketFilter === "all" ? "" : `?status=${ticketFilter}`;
    const data = await apiGet<BasculaTicket[]>(`/tickets${qs}`);
    setBasculaTickets(data);
  }

  const [basculaImporting, setBasculaImporting] = useState(false);
  async function runFirebaseImport() {
    setBasculaImporting(true);
    try {
      const res = await apiPost<{ ok: boolean; count: number }>("/tickets/refresh-firebase", {});
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
    await apiPost(`/receivable/${id}/pay`, { amount, cash_register_id: registerId });
    addToast("Pago registrado en caja", "success");
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
    if (activeTab === "Produccion") refreshSacks().catch(() => undefined);
    if (activeTab === "Inventario") refreshSacks().catch(() => undefined);
    if (activeTab === "Ventas") refreshCustomersAndSales().catch(() => undefined);
    if (activeTab === "Por Cobrar") refreshReceivables().catch(() => undefined);
    if (activeTab === "Por Pagar") refreshPayables().catch(() => undefined);
    if (activeTab === "Nomina") refreshNomina().catch(() => undefined);
    if (activeTab === "Cuadrilla") refreshCuadrilla().catch(() => undefined);
    if (activeTab === "Servicio Pilado") refreshPilado().catch(() => undefined);
    if (activeTab === "Dashboard" && isAdmin) refreshPanel().catch(() => undefined);
    if (activeTab === "Configuracion") refreshConfig().catch(() => undefined);
  }, [activeTab]);

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
    const monto = round2(cantidad * precio);
    const registerId = dashboard.current_cash_register.id;

    try {
      // Registrar gasto en caja
      const gastoRes = await apiFetch(`/cash/${registerId}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movement: "EXPENSE",
          category: "GASTO",
          amount: monto,
          description: `Compra de sacos: ${sackBuyForm.sack_id} (x${cantidad} @ $${precio})`,
          reference_type: "sack_purchase",
          reference_id: sackBuyForm.sack_id
        })
      });
      if (!gastoRes.ok) throw new Error(await gastoRes.text());

      // Actualizar inventario de sacos
      const movRes = await apiFetch(`/sacks/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sack_id: sackBuyForm.sack_id,
          movement: "ENTRADA",
          cantidad,
          concepto: `Compra a $${precio}/unidad`
        })
      });
      if (!movRes.ok) throw new Error(await movRes.text());

      setSackBuyForm({ sack_id: "", cantidad: "", precio: "" });
      await refreshSacks();
      await refreshCaja(registerId);
      addToast("Compra de sacos registrada ✓", "success");
    } catch (e) {
      addToast(`Error: ${e instanceof Error ? e.message : "Error desconocido"}`, "error");
    }
  };

  const refreshEquipment = async () => {
    const res = await apiFetch(`/equipment`);
    if (res.ok) setEquipment(await res.json());
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
          status: newEquipmentForm.status
        })
      });
      if (!res.ok) throw new Error(await res.text());

      setNewEquipmentForm({ name: "", type: "PILADORA", status: "ACTIVA" });
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
    const selectedEquip = equipment.find(e => e.id === maintenanceForm.equipment_id);
    if (selectedEquip?.name === "Piladora 1") {
      return "Ej: cambio de faja - pulidora 2, rodamiento - elevador 3, malla - zaranda, ajuste - plan sister";
    }
    return "Descripción del trabajo realizado";
  };

  const submitEquipmentMaintenance = async (photoFile?: File) => {
    if (!dashboard.current_cash_register?.id || !maintenanceForm.equipment_id || !maintenanceForm.description || !maintenanceForm.amount) {
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

      const res = await apiFetch(`/equipment/${maintenanceForm.equipment_id}/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        equipment_id: "",
        maintenance_type: "CORRECTIVO",
        description: "",
        provider: "",
        invoice_number: "",
        receipt_photo_url: "",
        amount: ""
      });
      await refreshCaja(registerId);
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
    const html = `<html><head><title>Cierre de Caja</title>
    <style>body{font-family:Arial;font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:4px 8px}th{background:#16a34a;color:#fff}.tot{font-weight:bold}</style>
    </head><body>
    <h2 style="text-align:center;margin-bottom:2px">${appSettings.business_name}</h2>
    <p style="text-align:center;margin:0 0 12px;color:#555">${[appSettings.business_subtitle, appSettings.ruc && `RUC: ${appSettings.ruc}`].filter(Boolean).join(" · ")}</p>
    <h3 style="text-align:center">${cashSummary.name} — Cierre de Caja</h3>
    <p>Fecha apertura: ${new Date(cashSummary.opened_at).toLocaleString("es-EC")} | Saldo inicial: $${opening.toFixed(2)}</p>
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
    await apiPut(`/lots/${lotId}/accionista`, { accionista_id: accionistaId });
    addToast("Lote cambiado de accionista (se movió también su inventario)", "success");
    await refresh();
  }

  async function assignFarmerAccionista(farmerId: string, accionistaId: string) {
    await apiPut(`/farmers/${farmerId}`, { accionista_id: accionistaId || null });
    addToast("Accionista del agricultor actualizado", "success");
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
    const form = new FormData(event.currentTarget);
    await apiPost("/cash/registers/open", {
      name: form.get("name"),
      opening_balance: Number(form.get("opening_balance"))
    });
    addToast("Caja abierta", "success");
    await refresh();
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

  async function submitDryingReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDryingForm(event.currentTarget);
  }

  function addSelectedDryingLot() {
    if (!traceLotId) {
      setMessage("Seleccione un lote para agregarlo al secado");
      return;
    }
    const lot = selectableDryingLots.find((item) => item.id === traceLotId);
    if (!lot) {
      setMessage("Ese lote ya fue agregado o ya esta usado en otro secado");
      setTraceLotId("");
      return;
    }
    setSelectedDryingLotIds((current) => [...current, lot.id]);
    setTraceLotId("");
    setMessage(`${lot.farmer_name ?? "Lote"} agregado a lotes utilizados`);
  }

  function removeSelectedDryingLot(lotId: string) {
    if (editingDryingReport) return;
    setSelectedDryingLotIds((current) => current.filter((id) => id !== lotId));
  }

  function editDryingReport(report: DryingTunnelReport) {
    setEditingDryingReport(report);
    setSelectedDryingLotIds(report.lots.map((lot) => lot.lot_id));
    setMessage(`Editando secado del Tunel ${report.tunnel_number}`);
  }

  function clearDryingForm(form?: HTMLFormElement | null) {
    setEditingDryingReport(null);
    setSelectedDryingLotIds([]);
    safeResetForm(form);
    setMessage("Formulario listo para nuevo secado");
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

  function saveMillingProcess() {
    if (!selectedProductionDrying) {
      setMessage("Seleccione la secadora antes de guardar el proceso");
      return;
    }

    saveMillingDraft({
      report: millingReport,
      piladoEntries: safeMillingPiladoEntries,
      productionDryingId
    });
    const savedAt = new Date().toISOString();
    setMillingDraftSavedAt(savedAt);
    setMessage("Proceso guardado temporalmente en este equipo");
  }

  async function finalizeMillingLot() {
    const drying = selectedProductionDrying;
    if (!drying) {
      setMessage("Seleccione la secadora que se esta produciendo");
      return;
    }

    if (millingPiladoTotalQq <= 0) {
      setMessage("Agregue al menos una cantidad de pilado");
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

    const production = await apiPost<ProductionResult>(`/processing-batches/${batch.id}/finish-production`, {
      lot_id: drying.lot_id,
      drying_report_id: drying.id,
      is_maquila: false,
      input_paddy_kg: Number(drying.input_weight_kg),
      white_rice: {
        product_id: outputProduct.id,
        warehouse_id: finishedWarehouse.id,
        quantity: millingPiladoTotalQq,
        unit: "QQ"
      },
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
      estibador_name: estibadorName || undefined
    });

    setMillingYields(result);
    setProductionResult(production);
    setMillingPiladoEntries([]);
    setMillingReport(defaultMillingReport);
    setProductionDryingId("");
    clearMillingDraft();
    setMillingDraftSavedAt(null);
    setMessage("Lote finalizado: produccion agregada al stock");
    await refresh();
  }

  async function finalizeDryingReport(formElement: HTMLFormElement | null) {
    if (!editingDryingReport || !formElement) return;
    const endInput = formElement.elements.namedItem("dry_end_at") as HTMLInputElement | null;
    if (endInput && !endInput.value) {
      endInput.value = dateTimeLocalValue(new Date().toISOString());
    }
    await submitDryingForm(formElement);
  }

  async function submitDryingForm(formElement: HTMLFormElement) {
    const form = new FormData(formElement);
    const payload = {
      rice_type: form.get("rice_type") || "0.11",
      moisture_before: numberOrUndefined(form.get("moisture_before")),
      dry_start_at: stringOrUndefined(form.get("dry_start_at")),
      dry_end_at: stringOrUndefined(form.get("dry_end_at")),
      gas_used: Number(form.get("gas_used") || 0),
      diesel_used: Number(form.get("diesel_used") || 0),
      dryer_name: form.get("dryer_name") || undefined,
      operator_name: form.get("operator_name") || undefined,
      notes: form.get("notes") || undefined
    };

    if (editingDryingReport) {
      const updated = await apiPut<DryingTunnelReport>(`/process-flow/drying/${editingDryingReport.id}`, payload);
      setMessage(updated.status === "COMPLETED" ? `Secado del Tunel ${updated.tunnel_number} finalizado` : `Secado del Tunel ${updated.tunnel_number} actualizado`);
      setEditingDryingReport(null);
      setSelectedDryingLotIds([]);
      safeResetForm(formElement);
      await refresh();
      if (updated.lots[0]?.lot_id) await loadProcessFlow(updated.lots[0].lot_id);
      return;
    }

    if (selectedDryingLotIds.length === 0) {
      setMessage("Selecciona uno o varios ingresos de materia prima para formar el lote");
      return;
    }

    // Aquí nace el lote: el grupo de ingresos que entra al túnel.
    const created = await apiPost<DryingTunnelReport>("/process-flow/drying", {
      entry_ids: selectedDryingLotIds,
      lot_code: String(form.get("lot_code") ?? "").trim() || undefined,
      tunnel_number: Number(form.get("tunnel_number")),
      ...payload
    });
    safeResetForm(formElement);
    setSelectedDryingLotIds([]);
    await refresh();
    if (created.lots[0]?.lot_id) await loadProcessFlow(created.lots[0].lot_id);
    setMessage(`Lote formado en el túnel; los ingresos usados ya no aparecen disponibles`);
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

    // Obtener warehouse_id del formulario o usar el por defecto
    const warehouse_id = form.get("warehouse_id") as string || finishedWarehouse?.id;
    if (!warehouse_id) {
      setMessage("Falta seleccionar bodega");
      return;
    }

    // Convertir líneas del carrito al formato esperado por API
    // Mapear marcas a productos de inventario correctos
    const items = saleLineItems.map(line => {
      const brandProduct = products.find(p => p.id === line.product_id);
      const inventoryProductId = getInventoryProductForBrand(brandProduct?.name || "");

      return {
        product_id: inventoryProductId || line.product_id, // Usar producto de inventario o fallback
        warehouse_id: warehouse_id,
        presentation_id: line.presentation_id,
        quantity: line.quantity,
        unit_price: line.unit_price
      };
    });

    const cashRegisterId = form.get("cash_register_id") as string;
    const paymentMethod = (form.get("payment_method") || "CASH") as string;

    // Validar que haya caja abierta si no es crédito
    if (paymentMethod !== "CREDIT" && !cashRegisterId) {
      setMessage("Abre una caja para guardar la venta");
      return;
    }

    const sale = await apiPost<{
      sale_number: string;
      total_amount: string | number;
    }>("/sales", {
      customer_id: selectedCustomerId,
      cash_register_id: cashRegisterId || undefined, // Agregar automáticamente a caja
      payment_method: paymentMethod,
      items: items
    });

    safeResetForm(formElement);
    setSaleLineItems([]);
    setSaleLineForm({ product_id: "", presentation_id: "", quantity: "", unit_price: "" });
    setSelectedCustomerId("");
    setCustomerSearch("");
    setFilteredCustomers([]);
    setSelectedPresentationId("");
    setSaleProductPresentations([]);
    const totalText = paymentMethod === "CREDIT" ? "a crédito" : "en efectivo";
    setMessage(
      `✓ Pedido ${sale.sale_number} guardado ${totalText}: ${money(sale.total_amount)}`
    );
    await refresh();
    if (cashRegisterId) await refreshCaja(cashRegisterId);
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
    const batchId = crypto.randomUUID();
    const resultItems: Array<{
      lot_code: string; rice_type: string | null;
      quintals: number; price_per_quintal: number;
      gross_amount: number; advances_discount: number; other_discounts: number; net_amount: number;
    }> = [];
    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i];
      const lot = lots.find((l) => l.id === line.lot_id);
      if (!lot) continue;
      const qq = Number(line.quintals) || Number(lot.quintals ?? 0);
      const result = await apiPost<LiqApiResult>("/liquidations", {
        farmer_id: liqFarmerId,
        lot_id: line.lot_id,
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
        lot_code: lot.lot_code,
        rice_type: lot.rice_type ?? null,
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
        <tr class="total-row"><td class="lbl">NETO A PAGAR:</td><td class="val">$${b.net_total.toFixed(2)}</td></tr>
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
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        )}
        <nav>
          {navGroups
            .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => visibleTabs.includes(tab)) }))
            .filter((group) => group.tabs.length > 0)
            .map((group) => {
              const collapsed = collapsedGroups.has(group.label);
              const hasActive = group.tabs.includes(activeTab);
              return (
                <div className={collapsed ? "navSection collapsed" : "navSection"} key={group.label}>
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
            {isAdmin && (
              <nav className="cajaSubNav">
                <button type="button" className={dashView === "panel" ? "active" : ""} onClick={() => { setDashView("panel"); if (!panelData) refreshPanel().catch(() => undefined); }}>📊 Panel integral</button>
                <button type="button" className={dashView === "resumen" ? "active" : ""} onClick={() => setDashView("resumen")}>⚡ Resumen rápido</button>
              </nav>
            )}
            {isAdmin && dashView === "panel" ? (
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
                    ? `${dashboard.current_cash_register.name} abierta con ${money(dashboard.current_cash_register.opening_balance)}`
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
            {accionistas.length > 1 && lots.length > 0 && (
              <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
                <h2>Cambiar accionista de un lote</h2>
                <p className="muted">Por si un lote se creó con el accionista equivocado. Al cambiarlo se mueve también su inventario. No se puede si el lote ya se liquidó o vendió.</p>
                <table className="cajaTable" style={{ marginTop: 8 }}>
                  <thead><tr><th>Lote</th><th>Agricultor</th><th>QQ</th><th>Estado</th><th>Accionista</th></tr></thead>
                  <tbody>
                    {lots.slice(0, 10).map((lot) => (
                      <tr key={lot.id}>
                        <td style={{ fontWeight: 600 }}>{lot.lot_code}</td>
                        <td>{lot.farmer_name ?? "—"}</td>
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
          <section className="traceLayout">
            <section className="formPanel">
              <h2>Armar el lote</h2>
              <p className="muted">El lote se forma aquí: agrega los ingresos de materia prima (pesajes de báscula) que entran juntos al túnel.</p>
              <label>
                <span>Ingreso de materia prima</span>
                <select value={traceLotId} onChange={(event) => setTraceLotId(event.target.value)}>
                  <option value="">Seleccione</option>
                  {selectableDryingLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.farmer_name ?? "Sin agricultor"} - {Number(lot.quintals ?? 0).toFixed(2)} QQ - {lot.ticket_number}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" type="button" onClick={addSelectedDryingLot} disabled={Boolean(editingDryingReport)}>
                Agregar al lote
              </button>
              <p className="muted">Al agregarlo desaparece de este selector para no repetirlo. Todos deben ser del mismo accionista y del mismo tipo (compra o servicio).</p>
            </section>

            <form
              className="formPanel dryingForm"
              key={editingDryingReport?.id ?? "new-drying"}
              onSubmit={(event) => submitDryingReport(event).catch((error) => setMessage(error.message))}
            >
              <h2>Informe de secado por tunel</h2>
              {editingDryingReport && <span className="editBadge">✎ Editando secado guardado</span>}
              {!editingDryingReport && (
                <label>
                  <span>Número de lote <span className="muted">(se genera solo; puedes escribir otro)</span></span>
                  <input name="lot_code" type="text" placeholder="Automático (LT-…)" />
                </label>
              )}
              <Select
                name="rice_type"
                label="Tipo de arroz"
                rows={[["0.11", "0.11"], ["CORRIENTE", "Corriente"]]}
                defaultValue={editingDryingReport?.rice_type ?? "0.11"}
              />
              <DryingLotSelector
                selectedLots={selectedDryingLots}
                editing={Boolean(editingDryingReport)}
                onRemove={removeSelectedDryingLot}
              />
              <div className="totalBox">
                <span>Peso total</span>
                <strong>{selectedDryingTotalQq.toFixed(2)} QQ</strong>
                <small>{selectedDryingTotalKg.toFixed(2)} kg netos sumados automaticamente</small>
              </div>
              <Select
                name="tunnel_number"
                label="Tunel"
                rows={[["1", "Tunel 1"], ["2", "Tunel 2"], ["3", "Tunel 3"]]}
                defaultValue={editingDryingReport ? String(editingDryingReport.tunnel_number) : undefined}
                disabled={Boolean(editingDryingReport)}
              />
              <Input name="moisture_before" label="Humedad inicial %" type="number" defaultValue={String(editingDryingReport?.moisture_before ?? 0)} />
              <Input name="dry_start_at" label="Hora secado inicio" type="datetime-local" defaultValue={dateTimeLocalValue(editingDryingReport?.dry_start_at)} required={false} />
              <Input name="dry_end_at" label="Hora secado final" type="datetime-local" defaultValue={dateTimeLocalValue(editingDryingReport?.dry_end_at)} required={false} />
              <Input name="gas_used" label="Gas utilizado" type="number" defaultValue={String(editingDryingReport?.gas_used ?? 0)} />
              <Input name="diesel_used" label="Diesel utilizado" type="number" defaultValue={String(editingDryingReport?.diesel_used ?? 0)} />
              <Input name="dryer_name" label="Secador" defaultValue={editingDryingReport?.dryer_name ?? "Secador 1"} />
              <Input name="operator_name" label="Operador" defaultValue={editingDryingReport?.operator_name ?? "Planta"} />
              <Input name="notes" label="Observacion" defaultValue={editingDryingReport?.notes ?? "Secado registrado"} required={false} />
              <div className="buttonRow">
                <button className="primary">{editingDryingReport ? "Guardar cambios" : "Guardar informe"}</button>
                {editingDryingReport && (
                  <>
                    {editingDryingReport.status !== "COMPLETED" && (
                      <button type="button" onClick={(event) => finalizeDryingReport(event.currentTarget.form).catch((error) => setMessage(error.message))}>
                        Finalizar secado
                      </button>
                    )}
                    <button type="button" onClick={(event) => clearDryingForm(event.currentTarget.form)}>
                      Nuevo informe
                    </button>
                  </>
                )}
              </div>
            </form>

            <DryingReportsPanel reports={dryingReports} onEdit={editDryingReport} />
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
                      <th>Accionista</th>
                    </tr>
                  </thead>
                  <tbody>
                    {farmers.map((f) => (
                      <tr key={f.id}>
                        <td>{f.full_name}</td>
                        <td>{f.identification ?? "—"}</td>
                        <td>{f.phone ?? "—"}</td>
                        <td>
                          {accionistas.length > 0 ? (
                            <select
                              value={f.accionista_id ?? ""}
                              onChange={(e) => assignFarmerAccionista(f.id, e.target.value).catch((err) => addToast(err.message, "error"))}
                              style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}
                            >
                              <option value="">Sin asignar</option>
                              {accionistas.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="muted">{f.accionista_id ? "Asignado" : "Sin asignar"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ marginTop: 10 }}>
                El accionista del agricultor define a quién se atribuye cada ticket de báscula al vincularlo. Si queda «Sin asignar», el ticket usa el accionista activo de quien lo vincula.
              </p>
            </div>
          </section>
        )}

        {activeTab === "Inventario" && (
          <section className="panelGrid">
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
                <p className="muted">Finaliza una secadora en la pestana Secadoras para poder producirla aqui.</p>
              )}
            </section>

            <section className="formPanel productionQuickCard">
              <h2>Reporte de pilado</h2>

              {/* Pilador y Estibador */}
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
              <div className="totalBox">
                <span>TOTAL QQ</span>
                <strong>{millingPiladoTotalQq.toFixed(2)} QQ</strong>
                <small>Suma de las cantidades agregadas por presentacion</small>
              </div>

              <div className="productionSackGrid">
                <ControlledNumberInput label="Arrocillo 3/4" value={millingReport.broken34} onChange={(value) => updateMillingField("broken34", value)} />
                <ControlledNumberInput label="Arrocillo Fino" value={millingReport.fineBroken} onChange={(value) => updateMillingField("fineBroken", value)} />
                <ControlledNumberInput label="Polvillo" value={millingReport.polvillo} onChange={(value) => updateMillingField("polvillo", value)} />
              </div>

              <div className="buttonRow">
                <button type="button" onClick={saveMillingProcess} disabled={!selectedProductionDrying}>
                  Guardar Proceso
                </button>
                <button className="primary" type="button" onClick={() => finalizeMillingLot().catch((error) => setMessage(error.message))} disabled={!selectedProductionDrying}>
                  Finalizar Lote
                </button>
              </div>
              <p className="muted">
                Guardar Proceso conserva un borrador temporal en este equipo. Finalizar Lote agrega la produccion al stock.
              </p>
              {millingDraftSavedAt && <p className="muted">Guardado temporal: {new Date(millingDraftSavedAt).toLocaleString()}</p>}

              {millingYields && (
                <section className="yieldResults">
                  <Metric title="Rend. Pilado" value={formatYield(millingYields.pilado)} />
                  <Metric title="Rend. Arrocillo" value={formatYield(millingYields.arrocillo)} />
                  <Metric title="Rend. Polvillo" value={formatYield(millingYields.polvillo)} />
                </section>
              )}
            </section>

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
                  </select>
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
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Cantidad</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Precio $</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Subtotal $</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleLineItems.map((item, i) => {
                        const product = products.find(p => p.id === item.product_id);
                        const allPresentations = saleProductPresentations.length > 0 ? saleProductPresentations : [];
                        const presentation = allPresentations.find(p => p.id === item.presentation_id) ||
                          (async () => {
                            try {
                              const res = await apiFetch(`/products/${item.product_id}/presentations`);
                              if (res.ok) {
                                const preses = await res.json();
                                return preses.find((p: any) => p.id === item.presentation_id);
                              }
                            } catch (e) { console.error(e); }
                            return null;
                          })();

                        // Buscar presentación de forma síncrona desde lista guardada en item (mejor enfoque)
                        // Para evitar async en render, guardamos la presentación en el item
                        const subtotal = item.quantity * item.unit_price;
                        return (
                          <tr key={item.id} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                            <td style={{ padding: "8px 10px" }}><strong>{product?.name}</strong></td>
                            <td style={{ padding: "8px 10px" }}>{item.presentation_name || "—"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{item.quantity}</td>
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
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SECCIÓN 4: Resumen y pago */}
            <form className="formPanel stepPanel stepSuccess" onSubmit={(event) => submitOrderSale(event).catch((error) => setMessage(error.message))} style={{ gridColumn: "1 / -1" }}>
              <h2 style={{ marginTop: 0 }}><span className="stepBadge">4</span>Resumen y forma de pago</h2>

              <div className="totalBox" style={{ background: "#dcfce7", padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14 }}>TOTAL A COBRAR</span>
                <strong style={{ fontSize: 28, color: "#16a34a" }}>${calculateSaleTotal().toFixed(2)}</strong>
                <small style={{ color: "#6b7280" }}>Suma de todos los subtotales</small>
              </div>

              <Select
                name="payment_method"
                label="Forma de pago"
                rows={[["CASH", "💵 Efectivo"], ["TRANSFER", "📱 Transferencia"], ["CARD", "💳 Tarjeta"], ["CHECK", "✓ Cheque"], ["CREDIT", "📋 Crédito"]]}
                defaultValue="CASH"
              />

              <Select
                name="cash_register_id"
                label="Caja"
                rows={dashboard.current_cash_register ? [[dashboard.current_cash_register.id, dashboard.current_cash_register.name]] : []}
                defaultValue={dashboard.current_cash_register?.id}
                required={false}
              />

              <Select name="warehouse_id" label="Bodega de salida" rows={warehouses.map((warehouse) => [warehouse.id, warehouse.name])} defaultValue={finishedWarehouse?.id} />

              <button className="primary" style={{ width: "100%", padding: 12, fontSize: 16 }}>
                💾 GUARDAR PEDIDO
              </button>
            </form>

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
                  <Input name="name" label="Nombre de la caja" defaultValue="Caja Principal" />
                  <Input name="opening_balance" label="Saldo inicial $" type="number" defaultValue="0" />
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
                      <div style={{ color: "#3b82f6", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>SALDO INICIAL</div>
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
                  </div>
                </div>

                {/* Sub-tabs profesional */}
                <nav className="cajaSubNav">
                  {(["resumen", "venta_detalle", "anticipo", "movimiento", "gastos", "sacos", "mantenimiento", "fomentos"] as const).map((t) => {
                    const icons = {
                      resumen: "📋",
                      anticipo: "💸",
                      movimiento: "💳",
                      gastos: "🧾",
                      sacos: "📦",
                      mantenimiento: "🔧",
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
                          if (t === "mantenimiento" && equipment.length === 0) refreshEquipment();
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
                      <select name="category" required style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
                        <option value="">Seleccione una categoría</option>
                        <optgroup label="Egresos">
                          <option value="GASTO_OPERATIVO">Gasto operativo</option>
                          <option value="GASTO_OFICINA">Gasto de oficina</option>
                          <option value="SERVICIOS_BASICOS">Servicios básicos</option>
                          <option value="PAGO_MANO_OBRA">Pago mano de obra</option>
                          <option value="ANTICIPO_AGRICULTOR">Anticipo agricultor</option>
                        </optgroup>
                        <optgroup label="Ingresos">
                          <option value="VENTA_CONTADO">Venta contado</option>
                          <option value="COBRO_MAQUILA">Cobro maquila</option>
                          <option value="OTRO_INGRESO">Otro ingreso</option>
                        </optgroup>
                      </select>
                    </label>

                    <Input name="amount" label="Monto $" type="number" />
                    <Input name="description" label="Descripción (opcional)" required={false} />
                    <button className="primary" style={{ width: "100%", padding: "10px 0", marginTop: 8 }}>💾 Registrar movimiento</button>
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
                {cajaSubTab === "mantenimiento" && (
                  <div className="maintLayout">
                    {/* Formulario Crear Máquina */}
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

                    {/* Formulario Registrar Mantenimiento */}
                    <form className="formPanel cajaForm" onSubmit={(event: any) => {
                      event.preventDefault();
                      const fileInput = event.currentTarget.querySelector('input[type="file"]');
                      const file = fileInput?.files?.[0];
                      submitEquipmentMaintenance(file);
                    }}>
                      <h2>Registrar Mantenimiento</h2>
                    <label>
                      <span>Máquina</span>
                      <select
                        value={maintenanceForm.equipment_id}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, equipment_id: event.target.value })}
                        required
                      >
                        <option value="">Seleccione</option>
                        {equipment.filter((eq) => eq.status !== "FUERA_SERVICIO").map((eq) => (
                          <option key={eq.id} value={eq.id}>{eq.name} ({eq.type})</option>
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
                      onChange={(e) => { setLiqFarmerId(e.target.value); setLiqLines([{ lot_id: "", quintals: "", price: "" }]); }}
                      required>
                      <option value="">Seleccione</option>
                      {farmersWithLots.map((f) => <option key={f.id} value={f.id}>{f.full_name}</option>)}
                    </select>
                  </label>

                  <div className="liqLinesHeader">
                    <span>Lote</span><span>QQ</span><span>Precio / QQ</span>
                  </div>

                  {liqLines.map((line, i) => {
                    const lot = lots.find((l) => l.id === line.lot_id);
                    const takenIds = new Set(liqLines.filter((_, j) => j !== i).map((l) => l.lot_id).filter(Boolean));
                    return (
                      <div key={i} className="liqLine">
                        <select value={line.lot_id} onChange={(e) => {
                          const sel = lots.find((l) => l.id === e.target.value);
                          const updated = [...liqLines];
                          updated[i] = { ...updated[i], lot_id: e.target.value, quintals: sel ? String(Number(sel.quintals ?? 0).toFixed(2)) : "" };
                          setLiqLines(updated);
                        }} required>
                          <option value="">— seleccionar lote —</option>
                          {farmerLots.filter((l) => !takenIds.has(l.id)).map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.lot_code} · {l.rice_type ?? "—"} · {Number(l.quintals ?? 0).toFixed(2)} QQ
                            </option>
                          ))}
                        </select>
                        <input type="number" step="0.01" min="0"
                          placeholder={lot ? String(Number(lot.quintals ?? 0).toFixed(2)) : "QQ"}
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
                        { key: "fomento",     label: "Fomento" },
                        { key: "bascula",     label: "Báscula" },
                        { key: "flete",       label: "Flete" },
                        { key: "cosechadora", label: "Cosechadora" },
                      ] as const).map(({ key, label }) => (
                        <label key={key} className="liqDiscRow">
                          <span>{label}</span>
                          <input type="number" step="0.01" min="0" placeholder="0.00"
                            value={liqDiscounts[key]}
                            onChange={(e) => setLiqDiscounts((p) => ({ ...p, [key]: e.target.value }))} />
                        </label>
                      ))}
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
              title="Lotes disponibles"
              headers={["Lote", "Tipo cáscara", "Agricultor", "Estado", "QQ"]}
              rows={availableLots.map((lot) => [
                lot.lot_code,
                lot.rice_type ?? "—",
                lot.farmer_name ?? "—",
                lot.status,
                `${Number(lot.quintals ?? 0).toFixed(2)} QQ`
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
        {activeTab === "Fomentos" && (
          <section className="tabSection">
            <h2>Fomentos de Insumos</h2>

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
                        <span className="cuentaLabel">Cliente</span>
                        <strong>{ar.customer_name}</strong>
                      </div>
                      <span className="cuentaRef">{ar.sale_number || ""}</span>
                    </div>
                    <div className="cuentaAmounts">
                      <div><span>Monto total</span><b>{money(Number(ar.amount))}</b></div>
                      <div><span>Saldo pendiente</span><b className="pend">{money(Number(ar.balance))}</b></div>
                    </div>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        const amt = prompt(`Cobrar hasta ${money(Number(ar.balance))}:`, Number(ar.balance).toFixed(2));
                        if (amt) payAccountReceivable(ar.id, Number(amt)).catch((e) => addToast(e.message, "error"));
                      }}
                    >
                      💵 Registrar cobro
                    </button>
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
                {cashPayables.map((ap) => {
                  const percentPaid = ((Number(ap.amount) - Number(ap.balance)) / Number(ap.amount)) * 100;
                  return (
                    <article key={ap.id} className="cuentaCard pagar">
                      <div className="cuentaTop">
                        <div>
                          <span className="cuentaLabel">Agricultor</span>
                          <strong>{ap.farmer_name}</strong>
                        </div>
                        <span className="cuentaRef">{ap.liquidation_number ? `Liq. ${ap.liquidation_number}` : ""}</span>
                      </div>
                      <div className="cuentaAmounts">
                        <div><span>Total</span><b>{money(Number(ap.amount))}</b></div>
                        <div><span>Pendiente</span><b className="pend">{money(Number(ap.balance))}</b></div>
                      </div>
                      <div className="cuentaBar"><div style={{ width: `${percentPaid}%` }} /></div>
                      <PayablePayForm payable={ap} onPay={(amount) => pagarCuenta(ap.id, amount).catch((e) => addToast(e.message, "error"))} />
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "Servicio Pilado" && (() => {
          const clientes = accionistas.filter((a) => a.id !== "00000000-0000-0000-0000-000000000001");
          const previewTotal = round2(Number(piladoForm.quintals || 0) * Number(piladoForm.rate_per_qq || 0));
          return (
          <section className="panelGrid">
            <form className="formPanel" onSubmit={(e) => submitPilado(e).catch((err) => addToast(err.message, "error"))}>
              <h2>🌾 Registrar servicio de pilado</h2>
              <p className="muted">CEYRO le presta el servicio de secado + pilado a otro accionista y le cobra por quintal. Genera el ingreso para CEYRO y la cuenta por pagar del accionista.</p>
              <label><span>Fecha</span>
                <input type="date" value={piladoForm.service_date} onChange={(e) => setPiladoForm({ ...piladoForm, service_date: e.target.value })} />
              </label>
              <label><span>Tipo de cliente</span>
                <select value={piladoForm.client_kind} onChange={(e) => setPiladoForm({ ...piladoForm, client_kind: e.target.value as "accionista" | "externo" })}>
                  <option value="accionista">Accionista</option>
                  <option value="externo">Cliente externo</option>
                </select>
              </label>
              {piladoForm.client_kind === "accionista" ? (
                <label><span>Accionista al que le pilaste</span>
                  <select value={piladoForm.client_accionista_id} onChange={(e) => setPiladoForm({ ...piladoForm, client_accionista_id: e.target.value })}>
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
                        <td style={{ textAlign: "right" }}>
                          {Number(s.saldo) > 0 && <button type="button" className="btnGhost" onClick={() => settlePilado(s.id).catch((err) => addToast(err.message, "error"))}>Marcar pagado</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
                        <th className="num">Reg.</th><th className="num">QQ</th><th className="num">Sacas</th>
                        <th className="num">Ganó</th><th className="num">Anticipos</th><th className="num">A pagar</th><th className="num">Pagado</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {nominaRows.map((r, i) => {
                        const pending = r.pending_amount ?? 0;
                        const toPay = r.to_pay ?? pending;
                        return (
                          <tr key={i}>
                            <td><span className={r.worker_role === "PILADOR" ? "chip info" : r.worker_role === "ESTIBADOR" ? "chip ok" : "chip warn"}>{r.worker_role === "PILADOR" ? "Pilador" : r.worker_role === "ESTIBADOR" ? "Estibador" : "Secador"}</span></td>
                            <td style={{ fontWeight: 600 }}>{r.worker_name}</td>
                            <td className="num">{r.cnt}</td>
                            <td className="num">{Number(r.qq).toFixed(2)}</td>
                            <td className="num">{Number(r.sacas).toFixed(0)}</td>
                            <td className="num" style={{ fontWeight: 700 }}>{money(r.base_amount)}</td>
                            <td className="num" style={{ color: (r.advances ?? 0) > 0 ? "var(--c-danger)" : "inherit" }}>{(r.advances ?? 0) > 0 ? `−${money(r.advances)}` : "—"}</td>
                            <td className="num" style={{ fontWeight: 700, color: toPay > 0 ? "var(--c-danger)" : "var(--c-success)" }}>{pending > 0 ? money(toPay) : "—"}</td>
                            <td className="num">{money(r.paid_amount ?? 0)}</td>
                            <td className="num" style={{ whiteSpace: "nowrap" }}>
                              <button type="button" className="btnGhost" title="Imprimir recibo" onClick={() => printWorkerReceipt(r)}>🧾</button>
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
                        <td colSpan={5} style={{ fontWeight: 700 }}>TOTALES</td>
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

              <form className="formPanel" onSubmit={(e) => addSecadorDayManual(e).catch((err) => addToast(err.message, "error"))}>
                <h2>➕ Agregar día de secador</h2>
                <p className="muted">Para días de solo guardianía o ajustes manuales.</p>
                <label><span>Secador</span><input type="text" placeholder="Ej: MARGARO" value={secadorForm.worker_name} onChange={(e) => setSecadorForm({ ...secadorForm, worker_name: e.target.value })} /></label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label><span>Fecha</span><input type="date" value={secadorForm.work_date} onChange={(e) => setSecadorForm({ ...secadorForm, work_date: e.target.value })} /></label>
                  <label><span>Túneles secados</span><input type="number" min="0" max="10" step="1" value={secadorForm.tunnels} onChange={(e) => setSecadorForm({ ...secadorForm, tunnels: e.target.value })} /></label>
                </div>
                <div className="totalBox">
                  <span>Pago de este día</span>
                  <strong>{money(laborRatesForm.secador_guardiania + laborRatesForm.secador_per_tunel * (Number(secadorForm.tunnels) || 0))}</strong>
                  <small>Guardianía {money(laborRatesForm.secador_guardiania)} + {Number(secadorForm.tunnels) || 0} × {money(laborRatesForm.secador_per_tunel)}</small>
                </div>
                <button className="primary">Agregar día</button>
              </form>
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
                              <td><span className={h.worker_role === "PILADOR" ? "chip info" : h.worker_role === "ESTIBADOR" ? "chip ok" : "chip warn"}>{h.worker_role === "PILADOR" ? "Pilador" : h.worker_role === "ESTIBADOR" ? "Estibador" : "Secador"}</span></td>
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
          </section>
        )}

        {activeTab === "Reportes" && (
          <>
            <div className="reportToolbar">
              <div className="reportKinds">
                {(["resumen", "ventas", "liquidaciones", "gastos", "produccion", "porcobrar"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={reportKind === k ? "active" : ""}
                    onClick={() => { setReportKind(k); loadReport(k).catch(() => undefined); }}
                  >
                    {k === "resumen" ? "📊 Resumen" : k === "ventas" ? "🛒 Ventas" : k === "liquidaciones" ? "🌾 Liquidaciones" : k === "gastos" ? "🧾 Gastos" : k === "produccion" ? "⚙️ Producción" : "📈 Por cobrar"}
                  </button>
                ))}
              </div>
              <div className="reportDates">
                {reportKind === "porcobrar" ? (
                  <span className="muted" style={{ alignSelf: "center" }}>Saldos al día de hoy</span>
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
              {reportRows && reportKind !== "resumen" && (
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
                              ) : (
                                <span className="muted">
                                  {(u.allowed_modules ?? []).length > 0 ? (u.allowed_modules ?? []).join(", ") : "Sin módulos"}
                                </span>
                              )}
                            </td>
                            <td>
                              <span className={u.is_active ? "chip ok" : "chip bad"}>
                                {u.is_active ? "Activo" : "Inactivo"}
                              </span>
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              {u.role_name !== "ADMINISTRADOR" && (
                                <button
                                  type="button"
                                  className="btnGhost"
                                  onClick={() => setPermsEditor({ user: u, modules: [...(u.allowed_modules ?? [])] })}
                                >
                                  Permisos
                                </button>
                              )}
                              {u.role_name !== "ADMINISTRADOR" && (
                                <button
                                  type="button"
                                  className="btnGhost"
                                  style={{ marginLeft: 6 }}
                                  onClick={() => setAccionistaEditor({ user: u, ids: [...(u.accionista_ids ?? [])] })}
                                >
                                  Accionistas
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
                    <div className="modalCard" onClick={(e) => e.stopPropagation()}>
                      <h3>Accionistas de {accionistaEditor.user.name}</h3>
                      <p className="muted">Marca a qué accionistas puede acceder este usuario. Si marcas más de uno, verá un selector para cambiar entre ellos.</p>
                      {adminAccionistas.length === 0 ? (
                        <p className="muted">Aún no hay accionistas. Créalos en la pestaña «Accionistas».</p>
                      ) : (
                        <div className="permGrid">
                          {adminAccionistas.map((a) => (
                            <label key={a.id} className={accionistaEditor.ids.includes(a.id) ? "permChip on" : "permChip"}>
                              <input
                                type="checkbox"
                                checked={accionistaEditor.ids.includes(a.id)}
                                onChange={() =>
                                  setAccionistaEditor({
                                    ...accionistaEditor,
                                    ids: accionistaEditor.ids.includes(a.id)
                                      ? accionistaEditor.ids.filter((x) => x !== a.id)
                                      : [...accionistaEditor.ids, a.id]
                                  })
                                }
                              />
                              {a.name}
                            </label>
                          ))}
                        </div>
                      )}
                      <p className="muted">Nota: si el usuario tiene la sesión abierta, los cambios aplican cuando vuelva a iniciar sesión.</p>
                      <div className="buttonRow">
                        <button type="button" className="primary" onClick={() => saveUserAccionistas().catch((err) => addToast(err.message, "error"))}>
                          Guardar accionistas
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
                  </div>
                  <h2 style={{ marginTop: 6, marginBottom: 0, fontSize: 13 }}>Secador <span className="muted" style={{ fontWeight: 400 }}>(próxima fase)</span></h2>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label><span>$ guardianía / día</span><input type="number" step="0.5" min="0" value={laborRatesForm.secador_guardiania} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, secador_guardiania: Number(e.target.value) })} /></label>
                    <label><span>$ por túnel secado</span><input type="number" step="0.5" min="0" value={laborRatesForm.secador_per_tunel} onChange={(e) => setLaborRatesForm({ ...laborRatesForm, secador_per_tunel: Number(e.target.value) })} /></label>
                  </div>
                  <button className="primary" disabled={!isAdmin}>Guardar tarifas</button>
                  {!isAdmin && <p className="muted">Solo un administrador puede cambiar las tarifas.</p>}
                </form>
                <div className="formPanel">
                  <h2>Ejemplo de cálculo</h2>
                  <p className="muted">Para una pilada de 100 QQ de arroz, 20 sacas y 10 QQ de arrocillo:</p>
                  <div className="totalBox" style={{ marginBottom: 10 }}>
                    <span>Pilador</span>
                    <strong>{money(100 * laborRatesForm.pilador_per_qq + 20 * laborRatesForm.pilador_per_saca)}</strong>
                    <small>100 × {laborRatesForm.pilador_per_qq} + 20 × {laborRatesForm.pilador_per_saca}</small>
                  </div>
                  <div className="totalBox">
                    <span>Estibador</span>
                    <strong>{money(100 * laborRatesForm.estibador_per_qq + 20 * laborRatesForm.estibador_per_saca + 10 * laborRatesForm.estibador_per_arrocillo)}</strong>
                    <small>100 × {laborRatesForm.estibador_per_qq} + 20 × {laborRatesForm.estibador_per_saca} + 10 × {laborRatesForm.estibador_per_arrocillo}</small>
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
                    <li>Borra los datos de prueba con el panel de la derecha.</li>
                    <li>Verifica productos, bodegas e insumos en el Dashboard ("Crear datos base" si están vacíos).</li>
                    <li>Abre la caja del día y registra a tus agricultores reales.</li>
                  </ol>
                </div>

                <form className="formPanel dangerZone" onSubmit={(e) => submitResetData(e).catch((err) => addToast(err.message, "error"))}>
                  <h2>🗑️ Borrar datos de prueba</h2>
                  <p className="muted">
                    Elimina <strong>todos los movimientos</strong>: tickets, lotes, secado, producción, ventas, caja, gastos,
                    anticipos, liquidaciones, fomentos, agricultores y clientes. Se conservan usuarios, configuración,
                    productos, bodegas, equipos y los catálogos de insumos y sacos (con stock en 0).
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
                    Borrar datos de prueba definitivamente
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

function Metric({
  title,
  value,
  icon,
  accent
}: {
  title: string;
  value: string | number;
  icon?: string;
  accent?: "accBlue" | "accAmber" | "accRed" | "accGreen";
}) {
  return (
    <article className={accent ? `moduleCard ${accent}` : "moduleCard"}>
      <div className="mIcon">{icon ?? "📊"}</div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function ReportTable({ headers, rows, empty }: { headers: string[]; rows: (string | number)[][]; empty: string }) {
  if (!rows || rows.length === 0) {
    return <div className="emptyState" style={{ padding: "26px 20px" }}><p>{empty}</p></div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="cajaTable" style={{ marginTop: 8 }}>
        <thead>
          <tr>{headers.map((h, i) => <th key={i} className={i === 0 ? "" : "num"}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} className={ci === 0 ? "" : "num"}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
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

function Input({
  name,
  label,
  type = "text",
  defaultValue,
  required = true,
  ...rest
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "type" | "defaultValue" | "required">) {
  return (
    <label>
      <span>{label}</span>
      <input name={name} type={type} step={type === "number" ? "0.01" : undefined} defaultValue={defaultValue} required={required} {...rest} />
    </label>
  );
}

function Select({
  name,
  label,
  rows,
  defaultValue,
  disabled = false,
  required = true,
  onChange
}: {
  name: string;
  label: string;
  rows: Array<[string, string]>;
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
  onChange?: (e: any) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue} disabled={disabled} required={required} onChange={onChange}>
        <option value="">Seleccione</option>
        {rows.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
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
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {tbl("INVENTARIO POR ACCIONISTA", "#16a34a", ["Accionista", "Quintales", "Valor"],
          acc.map((a) => [a.name, a.inventario_qq.toFixed(2), money(a.inventario_valor)]),
          ["TOTAL", data.totales.inventario_qq.toFixed(2), money(data.totales.inventario_valor)])}
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
              {Number(report.total_quintals ?? 0).toFixed(2)} QQ · {report.lots.length} lote(s) · {report.dryer_name ?? "Sin secador"}
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

function DataList({
  title,
  rows,
  headers
}: {
  title: string;
  rows: Array<Array<string | number>>;
  headers?: string[];
}) {
  const colCount = headers?.length ?? rows[0]?.length ?? 4;
  const gridCols: React.CSSProperties = { gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` };

  return (
    <section className="tablePanel">
      <h2>{title}</h2>
      {headers && (
        <div className="tableHead" style={gridCols}>
          {headers.map((h, i) => <span key={i}>{h}</span>)}
        </div>
      )}
      <div className="table">
        {rows.length === 0 && <p className="tableEmpty">Sin datos registrados</p>}
        {rows.map((row, index) => (
          <div className="tableRow" key={`${title}-${index}`} style={gridCols}>
            {row.map((cell, ci) => (
              <span key={ci}>{cell}</span>
            ))}
          </div>
        ))}
      </div>
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

function money(value: string | number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    ANTICIPO_AGRICULTOR: "Anticipo",
    GASTO_OPERATIVO: "Gasto operativo",
    GASTO_OFICINA: "Gasto de oficina",
    SERVICIOS_BASICOS: "Servicios básicos",
    PAGO_MANO_OBRA: "Mano de obra",
    PAGO_AGRICULTOR: "Pago agricultor",
    VENTA_CONTADO: "Venta contado",
    COBRO_MAQUILA: "Cobro maquila",
    OTRO_INGRESO: "Otro ingreso",
    COMPRA_SACOS: "Compra de sacos",
    MANTENIMIENTO_EQUIPO: "Mantenimiento de equipo",
    CUENTAS_PAGAR: "Cuentas por pagar",
    FOMENTOS: "Fomentos"
  };
  return map[cat] ?? cat;
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

function riceTypeLabel(value: string | null | undefined) {
  return value === "CORRIENTE" ? "Corriente" : "0.11";
}

function stockGroupLabel(row: { code?: string; product_type?: string }) {
  const code = row.code ?? "";
  if (code.startsWith("CASCARA")) return "Cascara";
  if (code.startsWith("ARROZ-PILADO")) return "Producto";
  if (code.startsWith("ARROCILLO") || code.startsWith("POLVILLO")) return "Subproducto";
  if (row.product_type === "RAW_MATERIAL") return "Cascara";
  if (row.product_type === "FINISHED_GOOD") return "Producto";
  if (row.product_type === "BYPRODUCT") return "Subproducto";
  return row.product_type ?? "Stock";
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

function loadMillingDraft(): {
  report: MillingReportState;
  piladoEntries: MillingPiladoEntry[];
  productionDryingId: string;
  savedAt: string | null;
} {
  if (typeof window === "undefined") {
    return { report: defaultMillingReport, piladoEntries: [], productionDryingId: "", savedAt: null };
  }

  try {
    const stored = window.localStorage.getItem(millingDraftStorageKey);
    if (!stored) return { report: defaultMillingReport, piladoEntries: [], productionDryingId: "", savedAt: null };
    const parsed = JSON.parse(stored) as {
      report?: Partial<MillingReportState>;
      piladoEntries?: MillingPiladoEntry[];
      productionDryingId?: string;
      savedAt?: string;
    };
    return {
      report: {
        ...defaultMillingReport,
        ...parsed.report
      },
      piladoEntries: Array.isArray(parsed.piladoEntries) ? parsed.piladoEntries : [],
      productionDryingId: parsed.productionDryingId ?? "",
      savedAt: parsed.savedAt ?? null
    };
  } catch {
    return { report: defaultMillingReport, piladoEntries: [], productionDryingId: "", savedAt: null };
  }
}

function saveMillingDraft(payload: {
  report: MillingReportState;
  piladoEntries: MillingPiladoEntry[];
  productionDryingId: string;
}) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    millingDraftStorageKey,
    JSON.stringify({
      ...payload,
      savedAt: new Date().toISOString()
    })
  );
}

function clearMillingDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(millingDraftStorageKey);
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
