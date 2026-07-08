import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, checkHealth } from "./api";

type Farmer = {
  id: string;
  identification: string | null;
  full_name: string;
  phone: string | null;
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
  quintals: string | number | null;
  net_weight?: string | number | null;
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

const tabs = ["Dashboard", "Bascula", "Secadoras", "Produccion", "Agricultores", "Inventario", "Ventas", "Caja", "Liquidaciones", "Fomentos"];

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
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Listo");
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [availableDryingLots, setAvailableDryingLots] = useState<Lot[]>([]);
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
  const [cajaSubTab, setCajaSubTab] = useState<"resumen" | "anticipo" | "movimiento" | "sacos" | "mantenimiento" | "venta_detalle" | "cuentas" | "fomentos">("resumen");
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [cashSummary, setCashSummary] = useState<CashSummary | null>(null);
  const [cashPayables, setCashPayables] = useState<AccountPayable[]>([]);
  const [anticipoFarmerId, setAnticipoFarmerId] = useState("");

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
        : availableDryingLots.filter((lot) => selectedDryingLotIds.includes(lot.id)).map((lot) => ({
            lot_id: lot.id,
            lot_code: lot.lot_code,
            farmer_name: lot.farmer_name,
            net_weight_kg: lot.net_weight ?? 0,
            quintals: lot.quintals ?? 0
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
      full_name: `${v.name} — debe $${v.pending.toFixed(2)}`
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
        apiGet<Lot[]>("/process-flow/drying/available-lots"),
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
    refresh().catch((error) => {
      setMessage(error.message);
      setLoading(false);
    });
  }, []);

  async function refreshCaja(registerId?: string) {
    const id = registerId ?? dashboard.current_cash_register?.id;
    if (!id) return;
    const [summary, movements, payables] = await Promise.all([
      apiGet<CashSummary>(`/cash/registers/${id}/summary`),
      apiGet<CashMovement[]>(`/cash/registers/${id}/movements`),
      apiGet<AccountPayable[]>("/cash/payables")
    ]);
    setCashSummary(summary);
    setCashMovements(movements);
    setCashPayables(payables);
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
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

      // Crear movimiento de inventario
      await fetch(`${API}/api/v1/inventory/adjustments`, {
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
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${API}/api/v1/customers/search?q=${encodeURIComponent(q)}`);
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
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${API}/api/v1/customers/quick`, {
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
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${API}/api/v1/products/${productId}/presentations`);
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
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${API}/api/v1/products/${productId}/presentations`);
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
    const apiBase = (import.meta.env.VITE_API_URL ?? "http://localhost:4000");
    await fetch(`${apiBase}/api/v1/fomentos/${fomentoId}/entregas/${entregaId}`, { method: "DELETE" });
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
    const apiBase = (import.meta.env.VITE_API_URL ?? "http://localhost:4000");
    await fetch(`${apiBase}/api/v1/fomentos/${fomentoId}/pagos/${pagoId}`, { method: "DELETE" });
    await loadFomentoDetalle(fomentoId);
    await refreshFomentos();
  }

  async function saveRenta(fomentoId: string) {
    const renta = Number(fomentoRentaInput) / 100;
    if (!renta || renta <= 0 || renta > 1) { addToast("Porcentaje inválido", "error"); return; }
    const apiBase = (import.meta.env.VITE_API_URL ?? "http://localhost:4000");
    await fetch(`${apiBase}/api/v1/fomentos/${fomentoId}`, {
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
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
      const gastoRes = await fetch(`${API}/api/v1/cash/${registerId}/movements`, {
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
      const movRes = await fetch(`${API}/api/v1/sacks/movements`, {
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
    const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
    const res = await fetch(`${API}/api/v1/equipment`);
    if (res.ok) setEquipment(await res.json());
  };

  const submitNewEquipment = async () => {
    if (!newEquipmentForm.name || !newEquipmentForm.type) {
      addToast("Completa nombre y tipo", "error");
      return;
    }

    try {
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${API}/api/v1/equipment`, {
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
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
      const res = await fetch(`${API}/api/v1/equipment/${equipmentId}`, {
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
      const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

      // Convertir foto a base64 si existe
      let photoBase64: string | undefined;
      if (photoFile) {
        const reader = new FileReader();
        photoBase64 = await new Promise((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(photoFile);
        });
      }

      const res = await fetch(`${API}/api/v1/equipment/${maintenanceForm.equipment_id}/maintenance`, {
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

  function downloadCajaExcel() {
    if (!cashSummary) return;
    const apiBase = (import.meta.env.VITE_API_URL ?? "http://localhost:4000");
    const url = `${apiBase}/api/v1/cash/registers/${cashSummary.id}/export-excel`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "cierre-caja.xlsx";
    a.click();
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
    <h2 style="text-align:center">${cashSummary.name} — Cierre de Caja</h2>
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
      phone: form.get("phone") || undefined
    });
    safeResetForm(formElement);
    setMessage("Agricultor guardado");
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
      setMessage("Seleccione uno o varios lotes para completar el tunel");
      return;
    }

    const created = await apiPost<DryingTunnelReport>("/process-flow/drying", {
      lot_ids: selectedDryingLotIds,
      tunnel_number: Number(form.get("tunnel_number")),
      ...payload
    });
    safeResetForm(formElement);
    setSelectedDryingLotIds([]);
    await refresh();
    if (created.lots[0]?.lot_id) await loadProcessFlow(created.lots[0].lot_id);
    setMessage("Informe de secado guardado; los lotes usados ya no aparecen disponibles");
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
        <h1>BASCULA ERP</h1>
        <h2>Piladora de Arroz</h2>
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
    </body></html>`;
    const win = window.open("", "_blank", "width=760,height=620");
    if (win) { win.document.write(html); win.document.close(); win.print(); }
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
        <nav>
          {tabs.map((tab) => (
            <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => setActiveTab(tab)}>
              <NavIcon tab={tab} />
              {tab}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbarLeft">
            <h1>{activeTab}</h1>
            <p>{loading ? "Actualizando datos…" : message}</p>
          </div>
          <div className="topbarRight">
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
            <section className="moduleGrid">
              <Metric title="Agricultores" value={dashboard.active_farmers} />
              <Metric title="Tickets hoy" value={dashboard.tickets_today} />
              <Metric title="Stock propio" value={`${dashboard.owned_stock.toFixed(2)} QQ`} />
              <Metric title="Anticipos" value={money(dashboard.pending_advances)} />
              <Metric title="Por pagar" value={money(dashboard.pending_payables)} />
              <Metric title="Ventas hoy" value={money(dashboard.sales_today)} />
              <Metric title="Insumos criticos" value={criticalSupplies.length} />
              <Metric title="Preparacion" value={`${setupScore}/5`} />
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

        {activeTab === "Bascula" && (
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
          </section>
        )}

        {activeTab === "Secadoras" && (
          <section className="traceLayout">
            <section className="formPanel">
              <h2>Seleccionar lote</h2>
              <label>
                <span>Lote para secado</span>
                <select value={traceLotId} onChange={(event) => setTraceLotId(event.target.value)}>
                  <option value="">Seleccione</option>
                  {selectableDryingLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.farmer_name ?? "Sin agricultor"} - {Number(lot.quintals ?? 0).toFixed(2)} QQ - {lot.lot_code}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" type="button" onClick={addSelectedDryingLot} disabled={Boolean(editingDryingReport)}>
                Agregar a lotes utilizados
              </button>
              <p className="muted">Al agregarlo desaparece de este selector para evitar repetir el mismo lote.</p>
            </section>

            <form
              className="formPanel dryingForm"
              key={editingDryingReport?.id ?? "new-drying"}
              onSubmit={(event) => submitDryingReport(event).catch((error) => setMessage(error.message))}
            >
              <h2>Informe de secado por tunel</h2>
              {editingDryingReport && <span className="editBadge">✎ Editando secado guardado</span>}
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
              <button className="primary">Guardar</button>
            </form>
            <DataList
              title="Agricultores registrados"
              headers={["Nombre", "Cédula / RUC", "Teléfono"]}
              rows={farmers.map((f) => [f.full_name, f.identification ?? "—", f.phone ?? "—"])}
            />
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
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
                <div style={{ background: "white", borderRadius: 10, padding: 20, maxWidth: 400, width: "90%" }}>
                  <h3>Nuevo cliente rápido</h3>
                  <label style={{ display: "block", marginBottom: 12 }}>
                    <span style={{ display: "block", marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Nombre *</span>
                    <input
                      type="text"
                      placeholder="Ej: Juan García"
                      value={quickNewCustomerForm.full_name}
                      onChange={(e) => setQuickNewCustomerForm({ ...quickNewCustomerForm, full_name: e.target.value })}
                      style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: 16 }}>
                    <span style={{ display: "block", marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Teléfono</span>
                    <input
                      type="text"
                      placeholder="0987654321"
                      value={quickNewCustomerForm.phone}
                      onChange={(e) => setQuickNewCustomerForm({ ...quickNewCustomerForm, phone: e.target.value })}
                      style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4 }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={submitQuickNewCustomer} style={{ flex: 1, padding: "8px 12px", background: "#10b981", color: "white", border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer" }}>
                      Crear
                    </button>
                    <button type="button" onClick={() => { setShowQuickNewCustomer(false); setQuickNewCustomerForm({ full_name: "", phone: "" }); }} style={{ flex: 1, padding: "8px 12px", background: "#e5e7eb", color: "#333", border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer" }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SECCIÓN 1: Cliente */}
            <div className="formPanel" style={{ gridColumn: "1 / -1", background: "#f0f9ff", borderLeft: "4px solid #0ea5e9" }}>
              <h2 style={{ marginTop: 0 }}>1️⃣ Cliente</h2>
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
            <div className="formPanel" style={{ gridColumn: "1 / -1", background: "#fef3c7", borderLeft: "4px solid #f59e0b" }}>
              <h2 style={{ marginTop: 0 }}>2️⃣ Agregar productos al pedido</h2>

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
              <div className="formPanel" style={{ gridColumn: "1 / -1", background: "#f3f4f6", borderLeft: "4px solid #6b7280" }}>
                <h2 style={{ marginTop: 0 }}>3️⃣ Líneas del pedido ({saleLineItems.length})</h2>
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
                              const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
                              const res = await fetch(`${API}/api/v1/products/${item.product_id}/presentations`);
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
            <form className="formPanel" onSubmit={(event) => submitOrderSale(event).catch((error) => setMessage(error.message))} style={{ gridColumn: "1 / -1", background: "#f0fdf4", borderLeft: "4px solid #10b981" }}>
              <h2 style={{ marginTop: 0 }}>4️⃣ Resumen y forma de pago</h2>

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

            {/* Cuentas por cobrar pendientes */}
            {accountsReceivable.length > 0 && (
              <div style={{ gridColumn: "1 / -1", border: "1px solid #fee2e2", borderRadius: 10, padding: 16, background: "#fef2f2" }}>
                <h3 style={{ marginTop: 0, marginBottom: 12, color: "#dc2626" }}>💰 Cuentas por Cobrar Pendientes</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                  {accountsReceivable.map(ar => (
                    <div key={ar.id} style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 12, background: "#fff" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "var(--c-muted)", fontWeight: 600 }}>Cliente</div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{ar.customer_name}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, color: "var(--c-muted)", fontWeight: 600 }}>Venta</div>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{ar.sale_number}</div>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10, fontSize: 11, textAlign: "center" }}>
                        <div>
                          <div style={{ color: "var(--c-muted)" }}>Monto total</div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>${Number(ar.amount).toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ color: "var(--c-muted)" }}>Saldo pendiente</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#dc2626" }}>${Number(ar.balance).toFixed(2)}</div>
                        </div>
                      </div>
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        const amt = prompt(`Cobrar hasta $${Number(ar.balance).toFixed(2)}:`, Number(ar.balance).toFixed(2));
                        if (amt) await payAccountReceivable(ar.id, Number(amt)).catch(e => setMessage(e.message));
                      }} style={{ display: "flex", gap: 6 }}>
                        <input type="hidden" />
                        <button type="submit" style={{
                          flex: 1, padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                          background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 12
                        }}>
                          💵 Cobrar
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "Caja" && (
          <section className="cajaLayout">
            {/* ── Sin caja abierta ── */}
            {!dashboard.current_cash_register && (
              <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20, maxWidth: 600, margin: "40px auto" }}>
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>💼</div>
                  <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700 }}>No hay caja abierta</h2>
                  <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>Abre una caja para comenzar a registrar movimientos de dinero</p>
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
                <nav style={{ display: "flex", gap: 4, borderBottom: "2px solid #e5e7eb", marginBottom: 24, flexWrap: "wrap", overflowX: "auto" }}>
                  {(["resumen", "venta_detalle", "anticipo", "movimiento", "sacos", "mantenimiento", "cuentas", "fomentos"] as const).map((t) => {
                    const icons = {
                      resumen: "📋",
                      anticipo: "💸",
                      movimiento: "💳",
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
                        onClick={() => {
                          setCajaSubTab(t);
                          if (t === "mantenimiento" && equipment.length === 0) refreshEquipment();
                        }}
                        style={{
                          padding: "10px 14px",
                          background: cajaSubTab === t ? "var(--c-brand)" : "transparent",
                          color: cajaSubTab === t ? "#fff" : "#6b7280",
                          border: cajaSubTab === t ? "none" : "1px solid transparent",
                          borderBottom: cajaSubTab === t ? "none" : "2px solid transparent",
                          borderRadius: "6px 6px 0 0",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: cajaSubTab === t ? 700 : 600,
                          whiteSpace: "nowrap",
                          transition: "all 0.2s"
                        }}
                      >
                        <span style={{ marginRight: 4 }}>{icons[t]}</span>{labels[t]}
                      </button>
                    );
                  })}
                </nav>

                {/* ── Movimientos ── */}
                {cajaSubTab === "resumen" && (
                  <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
                    {cashMovements.length === 0 ? (
                      <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af" }}>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                        <p style={{ margin: 0 }}>Sin movimientos registrados aún</p>
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
                            </tr>
                          </thead>
                          <tbody>
                            {cashMovements.map((m, idx) => (
                              <tr key={m.id} style={{ borderBottom: "1px solid #e5e7eb", background: idx % 2 === 0 ? "white" : "#fafafa", transition: "background 0.2s" }}>
                                <td style={{ padding: "12px 16px", color: "#6b7280" }}>
                                  {new Date(m.created_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}
                                </td>
                                <td style={{ padding: "12px 16px" }}>
                                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: "4px", background: m.movement === "INCOME" ? "#dcfce7" : "#fee2e2", color: m.movement === "INCOME" ? "#16a34a" : "#dc2626", fontWeight: 600, fontSize: 11 }}>
                                    {m.movement === "INCOME" ? "⬆ Ingreso" : "⬇ Egreso"}
                                  </span>
                                </td>
                                <td style={{ padding: "12px 16px", color: "#6b7280" }}>{categoryLabel(m.category)}</td>
                                <td style={{ padding: "12px 16px", color: "#6b7280" }}>{m.description ?? "—"}</td>
                                <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, color: m.movement === "EXPENSE" ? "#dc2626" : "#16a34a" }}>
                                  {m.movement === "EXPENSE" ? "-" : "+"}{money(Number(m.amount))}
                                </td>
                              </tr>
                            ))}
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
                  <div style={{ display: "flex", gap: 20 }}>
                    {/* Formulario Crear Máquina */}
                    <div style={{ flex: "0 0 350px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
                      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>+ Agregar Máquina</h3>
                      <label style={{ display: "block", marginBottom: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Nombre</span>
                        <input
                          type="text"
                          value={newEquipmentForm.name}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, name: e.target.value })}
                          placeholder="Ej: Piladora 1, Motor Túnel 1"
                          style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #d1d5db", fontSize: 13 }}
                        />
                      </label>
                      <label style={{ display: "block", marginBottom: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Tipo</span>
                        <select
                          value={newEquipmentForm.type}
                          onChange={(e: any) => setNewEquipmentForm({ ...newEquipmentForm, type: e.target.value })}
                          style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid #d1d5db", fontSize: 13 }}
                        >
                          <option value="PILADORA">Piladora</option>
                          <option value="SECADORA">Secadora</option>
                          <option value="MOTOR">Motor</option>
                          <option value="OTRO">Otro</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={submitNewEquipment}
                        style={{ width: "100%", padding: "8px 0", background: "#10b981", color: "white", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                      >
                        Agregar
                      </button>
                      <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #d1d5db" }} />
                      <h4 style={{ fontSize: 12, fontWeight: 600, margin: "12px 0 8px", color: "#6b7280" }}>Equipos</h4>
                      {equipment.length === 0 && <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Sin equipos aún</p>}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {equipment.filter((e) => e.status !== "FUERA_SERVICIO").map((eq) => (
                          <div key={eq.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, background: "#f3f4f6", borderRadius: 4, fontSize: 13 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600 }}>{eq.name}</div>
                              <div style={{ fontSize: 11, color: "#6b7280" }}>{eq.type}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => deleteEquipment(eq.id)}
                              style={{ padding: "4px 8px", background: "#ef4444", color: "white", border: "none", borderRadius: 3, fontSize: 11, cursor: "pointer" }}
                            >
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
                    }} style={{ flex: 1 }}>
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
                        style={{ width: "100%", minHeight: 60, padding: 8, fontFamily: "inherit" }}
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
                        style={{ width: "100%", padding: 8 }}
                      />
                    </label>
                    <label>
                      <span>Número de factura</span>
                      <input
                        type="text"
                        value={maintenanceForm.invoice_number}
                        onChange={(event: any) => setMaintenanceForm({ ...maintenanceForm, invoice_number: event.target.value })}
                        style={{ width: "100%", padding: 8 }}
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
                        style={{ width: "100%", padding: 8 }}
                      />
                    </label>
                    <label>
                      <span>📸 Foto del comprobante (JPG, PNG, máx 5MB)</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/jpg"
                        style={{ width: "100%", padding: 8 }}
                      />
                    </label>
                    <button className="primary">Registrar mantenimiento</button>
                    </form>
                    </div>
                )}

                {/* ── Venta Detalle (por libra) ── */}
                {cajaSubTab === "venta_detalle" && (
                  <form onSubmit={(e) => { e.preventDefault(); submitVentaDetalle(); }} style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "24px", maxWidth: 600 }}>
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

                {/* ── Cuentas por pagar ── */}
                {cajaSubTab === "cuentas" && (
                  <div>
                    {cashPayables.length === 0 ? (
                      <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "40px 20px", textAlign: "center", color: "#9ca3af" }}>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                        <p style={{ margin: 0, fontSize: 14 }}>No hay cuentas por pagar pendientes</p>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: 16 }}>
                        {cashPayables.map((ap) => {
                          const percentPaid = ((Number(ap.amount) - Number(ap.balance)) / Number(ap.amount)) * 100;
                          return (
                            <article key={ap.id} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
                                <div>
                                  <strong style={{ fontSize: 14, display: "block", marginBottom: 2 }}>{ap.farmer_name}</strong>
                                  <small style={{ color: "#6b7280", fontSize: 11 }}>{ap.liquidation_number ? `Liq. ${ap.liquidation_number}` : "Sin liquidación asociada"}</small>
                                </div>
                                <span style={{ background: "#dbeafe", color: "#1e40af", padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                                  {percentPaid.toFixed(0)}%
                                </span>
                              </div>

                              <div style={{ background: "#f9fafb", padding: "12px", borderRadius: 6, marginBottom: 12 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                                  <div>
                                    <div style={{ color: "#6b7280", fontSize: 10, marginBottom: 2 }}>Total</div>
                                    <div style={{ fontWeight: 700, color: "#374151" }}>{money(Number(ap.amount))}</div>
                                  </div>
                                  <div>
                                    <div style={{ color: "#6b7280", fontSize: 10, marginBottom: 2 }}>Pendiente</div>
                                    <div style={{ fontWeight: 700, color: "#dc2626" }}>{money(Number(ap.balance))}</div>
                                  </div>
                                </div>
                                <div style={{ background: "#e5e7eb", height: 4, borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                                  <div style={{ background: "#10b981", height: "100%", width: `${percentPaid}%`, transition: "width 0.3s" }} />
                                </div>
                              </div>

                              <PayablePayForm payable={ap}
                                onPay={(amount) => pagarCuenta(ap.id, amount).catch((e) => addToast(e.message, "error"))} />
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

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

        </div>{/* .content */}
      </section>
    </main>

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

function Metric({ title, value }: { title: string; value: string | number }) {
  return (
    <article className="moduleCard">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
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
  required = true
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label>
      <span>{label}</span>
      <input name={name} type={type} step={type === "number" ? "0.01" : undefined} defaultValue={defaultValue} required={required} />
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
