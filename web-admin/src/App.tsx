import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, checkHealth } from "./api";

type Farmer = {
  id: string;
  identification: string | null;
  full_name: string;
  phone: string | null;
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

const tabs = ["Dashboard", "Bascula", "Secadoras", "Agricultores", "Inventario", "Produccion", "Pedidos", "Caja", "Liquidaciones"];
const LB_TO_KG = 0.45359237;
const QQ_TO_LB = 100;
const millingDraftStorageKey = "bascula-erp:milling-report-draft";
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
        dryingReportRows
      ] = await Promise.all([
        apiGet<Dashboard>("/dashboard"),
        apiGet<Farmer[]>("/farmers"),
        apiGet<Product[]>("/inventory/products"),
        apiGet<Warehouse[]>("/inventory/warehouses"),
        apiGet<Lot[]>("/lots"),
        apiGet<StockRow[]>("/inventory/stock"),
        apiGet<Insumo[]>("/inventory/insumos"),
        apiGet<Lot[]>("/process-flow/drying/available-lots"),
        apiGet<DryingTunnelReport[]>("/process-flow/drying/reports")
      ]);

      setDashboard(dash);
      setFarmers(farmerRows);
      setProducts(productRows);
      setWarehouses(warehouseRows);
      setLots(lotRows);
      setAvailableDryingLots(dryingLotRows);
      setDryingReports(dryingReportRows);
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
    setMessage("Caja abierta");
    await refresh();
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
    const warehouseId = String(form.get("warehouse_id"));
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
      sacks_used: 0
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
    const quantity = orderQuantityQq;

    if (quantity <= 0) {
      setMessage("Ingrese la cantidad del pedido en QQ y libras");
      return;
    }

    const sale = await apiPost<{
      sale_number: string;
      total_amount: string | number;
      sacks_used?: number;
      packaging_alert?: { nombre: string; stockActual: number; isCritical: boolean } | null;
    }>("/sales", {
      cash_register_id: form.get("cash_register_id") || undefined,
      payment_method: form.get("payment_method") || "CASH",
      packaging_supply_id: form.get("packaging_supply_id") || undefined,
      presentation: form.get("presentation") || undefined,
      sack_weight_lb: orderPackage.sackWeightLb,
      items: [
        {
          product_id: form.get("product_id"),
          warehouse_id: form.get("warehouse_id"),
          quantity,
          unit_price: Number(form.get("unit_price") || 0)
        }
      ]
    });

    safeResetForm(formElement);
    setOrderPackage(defaultOrderPackage);
    setMessage(
      `Pedido ${sale.sale_number} guardado: ${money(sale.total_amount)} y ${Number(sale.sacks_used ?? 0).toFixed(0)} sacos descontados`
    );
    await refresh();
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

  async function submitLiquidation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const lotId = String(form.get("lot_id"));
    const lot = lots.find((item) => item.id === lotId);
    if (!lot) return;

    await apiPost("/liquidations", {
      farmer_id: form.get("farmer_id"),
      lot_id: lotId,
      quintals: Number(form.get("quintals")),
      price_per_quintal: Number(form.get("price_per_quintal")),
      other_discounts: Number(form.get("other_discounts") || 0)
    });

    safeResetForm(formElement);
    setMessage("Liquidacion creada con descuento automatico de anticipos");
    await refresh();
  }

  return (
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
              {tab}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{activeTab}</h1>
            <p>{loading ? "Cargando datos..." : message}</p>
          </div>
          <span className={apiOnline ? "pill online" : "pill offline"}>
            API {apiOnline ? "conectada" : "sin conexion"}
          </span>
        </header>

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
                <h2>Preparacion operativa</h2>
                <p className="muted">
                  Productos, bodegas, sacos vacios, agricultores y caja son la base para operar sin pantallas vacias.
                </p>
              </div>
              <div className="setupChecks">
                <StatusDot ok={products.length >= 7} label="Productos base" />
                <StatusDot ok={warehouses.length >= 2} label="Bodegas" />
                <StatusDot ok={insumos.length > 0} label="Sacos vacios" />
                <StatusDot ok={farmers.length > 0} label="Agricultores" />
                <StatusDot ok={dashboard.current_cash_register !== null} label="Caja abierta" />
              </div>
              <button className="primary" onClick={() => setupMasterData().catch((error) => setMessage(error.message))} disabled={busy}>
                {busy ? "Preparando..." : "Crear datos base"}
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
              <Select name="warehouse_id" label="Bodega" rows={warehouses.map((w) => [w.id, w.name])} defaultValue={rawWarehouse?.id} />
              <Input name="gross_weight" label="Peso bruto kg" type="number" />
              <Input name="tare_weight" label="Tara kg" type="number" />
              <Input name="qualification" label="Calificacion" type="number" />
              <button className="primary">Cerrar ticket</button>
            </form>
            <DataList title="Ultimos lotes" rows={lots.slice(0, 8).map((lot) => [lot.lot_code, lot.farmer_name ?? "", riceTypeLabel(lot.rice_type), `${lot.quintals ?? 0} QQ`])} />
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
              {editingDryingReport && <span className="pill online">Editando secado guardado</span>}
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

            <ProcessFlowPanel flow={processFlow} />
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
            <form className="formPanel" onSubmit={(event) => submitAdvance(event).catch((error) => setMessage(error.message))}>
              <h2>Registrar anticipo</h2>
              <Select name="farmer_id" label="Agricultor" rows={farmers.map((f) => [f.id, f.full_name])} />
              <Input name="amount" label="Monto" type="number" />
              <Input name="concept" label="Concepto" />
              <button className="primary">Registrar</button>
            </form>
            <DataList title="Agricultores" rows={farmers.map((f) => [f.full_name, f.identification ?? "", f.phone ?? ""])} />
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
            <DataList title="Productos" rows={visibleInventoryProducts.map((p) => [p.code, p.name, p.product_type, p.unit])} />
            <DataList title="Stock cascara" rows={rawStockRows.map((row) => [row.product_name, row.warehouse_name, `${Number(row.quantity).toFixed(2)} ${row.unit}`])} />
            <DataList title="Stock producto" rows={finishedStockRows.map((row) => [row.product_name, row.warehouse_name, `${Number(row.quantity).toFixed(2)} ${row.unit}`])} />
            <DataList title="Stock subproductos" rows={byproductStockRows.map((row) => [row.product_name, row.warehouse_name, `${Number(row.quantity).toFixed(2)} ${row.unit}`])} />
            {otherStockRows.length > 0 && (
              <DataList title="Otros stocks" rows={otherStockRows.map((row) => [row.product_name, row.warehouse_name, `${Number(row.quantity).toFixed(2)} ${row.unit}`])} />
            )}
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
              <h2>Reporte de pilado (Estibador)</h2>
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

        {activeTab === "Pedidos" && (
          <section className="panelGrid">
            <form className="formPanel" onSubmit={(event) => submitOrderSale(event).catch((error) => setMessage(error.message))}>
              <h2>Nuevo pedido de producto</h2>
              <Select
                name="product_id"
                label="Producto"
                rows={(saleProducts.length ? saleProducts : products).map((product) => [product.id, `${product.name} (${product.unit})`])}
                defaultValue={whiteRiceProduct?.id}
              />
              <Select name="warehouse_id" label="Bodega de producto" rows={warehouses.map((warehouse) => [warehouse.id, warehouse.name])} defaultValue={finishedWarehouse?.id} />
              <div className="productionSackGrid">
                <label>
                  <span>QQ pedidos</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={orderPackage.qq}
                    onChange={(event) => setOrderPackage((current) => ({ ...current, qq: Number(event.target.value || 0) }))}
                  />
                </label>
                <label>
                  <span>Libras sobrantes</span>
                  <input
                    min="0"
                    max="99.99"
                    step="0.01"
                    type="number"
                    value={orderPackage.pounds}
                    onChange={(event) => setOrderPackage((current) => ({ ...current, pounds: Number(event.target.value || 0) }))}
                  />
                </label>
              </div>
              <Input name="unit_price" label="Precio por QQ" type="number" defaultValue="0" />
              <label>
                <span>Presentacion</span>
                <select name="presentation" defaultValue="Flor">
                  <option value="Flor">Flor</option>
                  <option value="Lira">Lira</option>
                  <option value="Oso">Oso</option>
                  <option value="Generico">Generico</option>
                </select>
              </label>
              <label>
                <span>Libras por saco</span>
                <input
                  min="1"
                  step="1"
                  type="number"
                  value={orderPackage.sackWeightLb}
                  onChange={(event) => setOrderPackage((current) => ({ ...current, sackWeightLb: Number(event.target.value || 100) }))}
                />
              </label>
              <Select name="packaging_supply_id" label="Bodega de sacos" rows={insumos.map((item) => [item.id, `${item.nombre} (${item.stock_actual})`])} defaultValue={sacksSupply?.id} required={false} />
              <Select
                name="cash_register_id"
                label="Caja"
                rows={dashboard.current_cash_register ? [[dashboard.current_cash_register.id, dashboard.current_cash_register.name]] : []}
                defaultValue={dashboard.current_cash_register?.id}
                required={false}
              />
              <Select
                name="payment_method"
                label="Forma de pago"
                rows={[["CASH", "Efectivo"], ["TRANSFER", "Transferencia"], ["CARD", "Tarjeta"], ["CHECK", "Cheque"], ["CREDIT", "Credito"]]}
                defaultValue="CASH"
              />
              <div className="totalBox">
                <span>Empaque a descontar</span>
                <strong>{orderSacksUsed.toFixed(0)} sacos</strong>
                <small>{orderQuantityQq.toFixed(2)} QQ pedidos con sacos de {orderPackage.sackWeightLb || 0} lb</small>
              </div>
              <button className="primary">Guardar pedido y bajar sacos</button>
            </form>
            <DataList
              title="Stock para pedidos"
              rows={stock
                .filter((row) => row.ownership === "OWNED")
                .map((row) => [row.product_name, row.warehouse_name, row.ownership, `${Number(row.quantity).toFixed(2)} ${row.unit}`])}
            />
          </section>
        )}

        {activeTab === "Caja" && (
          <section className="panelGrid">
            <form className="formPanel" onSubmit={(event) => submitCash(event).catch((error) => setMessage(error.message))}>
              <h2>Abrir caja</h2>
              <Input name="name" label="Nombre" defaultValue="Caja Principal" />
              <Input name="opening_balance" label="Saldo inicial" type="number" defaultValue="0" />
              <button className="primary">Abrir caja</button>
            </form>
            <div className="formPanel">
              <h2>Estado</h2>
              <p className="muted">
                {dashboard.current_cash_register
                  ? `Caja abierta: ${dashboard.current_cash_register.name}`
                  : "Aun no hay caja abierta"}
              </p>
            </div>
          </section>
        )}

        {activeTab === "Liquidaciones" && (
          <section className="panelGrid">
            <form className="formPanel" onSubmit={(event) => submitLiquidation(event).catch((error) => setMessage(error.message))}>
              <h2>Nueva liquidacion</h2>
              <Select name="farmer_id" label="Agricultor" rows={farmers.map((f) => [f.id, f.full_name])} />
              <Select name="lot_id" label="Lote" rows={lots.map((lot) => [lot.id, `${lot.lot_code} - ${lot.farmer_name ?? ""}`])} />
              <Input name="quintals" label="Quintales liquidados" type="number" />
              <Input name="price_per_quintal" label="Precio por QQ" type="number" />
              <Input name="other_discounts" label="Otros descuentos" type="number" defaultValue="0" />
              <button className="primary">Liquidar</button>
            </form>
            <DataList title="Lotes disponibles" rows={lots.map((lot) => [lot.lot_code, lot.farmer_name ?? "", lot.status, `${lot.quintals ?? 0} QQ`])} />
          </section>
        )}
      </section>
    </main>
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
  required = true
}: {
  name: string;
  label: string;
  rows: Array<[string, string]>;
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label>
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue} disabled={disabled} required={required}>
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
          <button type="button" onClick={() => onEdit(report)}>Editar</button>
        </article>
      ))}
    </section>
  );
}

function DataList({ title, rows }: { title: string; rows: Array<Array<string | number>> }) {
  return (
    <section className="tablePanel">
      <h2>{title}</h2>
      <div className="table">
        {rows.length === 0 && <p className="muted">Sin datos</p>}
        {rows.map((row, index) => (
          <div className="tableRow" key={`${title}-${index}`}>
            {row.map((cell, cellIndex) => (
              <span key={cellIndex}>{cell}</span>
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
      <h2>Impresion 58mm</h2>
      <pre>{`RECIBO DE BASCULA
------------------------
Lote: LT-2026-0001
Bruto: 12000 kg
Tara: 4000 kg
Neto: 8000 kg
QQ: 113.55
------------------------
Firma: ________________`}</pre>
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
          rows={flow.reports.map((report) => [
            report.sequence,
            stageLabel(report.stage),
            report.report_title,
            new Date(report.created_at).toLocaleString()
          ])}
        />
        <DataList
          title="Tuneles registrados"
          rows={flow.tunnels.map((tunnel) => [
            `Tunel ${tunnel.tunnel_number}`,
            `${Number(tunnel.total_quintals ?? 0).toFixed(2)} QQ`,
            tunnel.status === "COMPLETED" ? "Finalizado" : "En proceso",
            `${Number(tunnel.gas_used ?? 0).toFixed(2)} gas / ${Number(tunnel.diesel_used ?? 0).toFixed(2)} diesel`
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
