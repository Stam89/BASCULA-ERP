import { Router } from "express";
import { advancesRouter } from "./modules/advances.js";
import { authRouter } from "./modules/auth.js";
import { cashRouter } from "./modules/cash.js";
import { catalogsRouter } from "./modules/catalogs.js";
import { dashboardRouter } from "./modules/dashboard.js";
import { documentsRouter } from "./modules/documents.js";
import { expensesRouter } from "./modules/expenses.js";
import { farmersRouter } from "./modules/farmers.js";
import { inventoryRouter } from "./modules/inventory.js";
import { liquidationsRouter } from "./modules/liquidations.js";
import { lotsRouter } from "./modules/lots.js";
import { mobileTicketsRouter } from "./modules/mobile-tickets.js";
import { processFlowRouter } from "./modules/process-flow.js";
import { processingRouter } from "./modules/processing.js";
import { salesRouter } from "./modules/sales.js";
import { ordersRouter } from "./modules/orders.js";
import { financeRouter } from "./modules/finance.js";
import { weighingRouter } from "./modules/weighing-tickets.js";
import { fomentosRouter } from "./modules/fomentos.js";
import { sacksRouter } from "./modules/sacks.js";
import { customersRouter } from "./modules/customers.js";
import { productsRouter } from "./modules/products.js";
import { receivableRouter } from "./modules/receivable.js";
import { equipmentRouter } from "./modules/equipment.js";
import { enforceModulePermissions, requireAuth, resolveAccionista } from "../auth/require-auth.js";
import { settingsRouter } from "./modules/settings.js";
import { auditRouter } from "./modules/audit.js";
import { auditMiddleware } from "../audit/audit.js";
import { reportsRouter } from "./modules/reports.js";
import { laborRouter } from "./modules/labor.js";
import { cuadrillaRouter } from "./modules/cuadrilla.js";
import { piladoRouter } from "./modules/pilado.js";
import { selectionRouter } from "./modules/selection.js";
import { tunnelReservationsRouter } from "./modules/tunnel-reservations.js";
import { tunnelOccupancyRouter } from "./modules/tunnel-occupancy.js";
import { suppliersRouter } from "./modules/suppliers.js";
import { purchasesRouter } from "./modules/purchases.js";
import { costosRouter } from "./modules/costos.js";

export const routes = Router();

// Registra cada escritura exitosa con el usuario que la hizo (lee req.user si
// ya fue autenticado más abajo). Va primero para cubrir también /auth (usuarios).
routes.use(auditMiddleware);

// Rutas públicas: login/bootstrap y sincronización de la app Android (no envía token)
routes.use("/auth", authRouter);
routes.use("/tickets", mobileTicketsRouter);

// Todo lo demás requiere sesión (Bearer token). Las escrituras además
// exigen permiso del módulo correspondiente (los administradores no tienen límite).
routes.use(requireAuth);
// Resolver el accionista ANTES de validar permisos: los permisos ahora son por
// accionista, así que la validación necesita saber cuál está activo.
routes.use(resolveAccionista);
routes.use(enforceModulePermissions);

routes.use("/dashboard", dashboardRouter);
routes.use("/process-flow", processFlowRouter);
routes.use("/catalogs", catalogsRouter);
routes.use("/farmers", farmersRouter);
routes.use("/advances", advancesRouter);
routes.use("/weighing-tickets", weighingRouter);
routes.use("/lots", lotsRouter);
routes.use("/inventory", inventoryRouter);
routes.use("/processing-batches", processingRouter);
routes.use("/liquidations", liquidationsRouter);
routes.use("/cash", cashRouter);
routes.use("/sales", salesRouter);
routes.use("/orders", ordersRouter);
routes.use("/finance", financeRouter);
routes.use("/expenses", expensesRouter);
routes.use("/documents", documentsRouter);
routes.use("/fomentos", fomentosRouter);
routes.use("/sacks", sacksRouter);
routes.use("/customers", customersRouter);
routes.use("/products", productsRouter);
routes.use("/receivable", receivableRouter);
routes.use("/equipment", equipmentRouter);
routes.use("/settings", settingsRouter);
routes.use("/audit", auditRouter);
routes.use("/reports", reportsRouter);
routes.use("/labor", laborRouter);
routes.use("/cuadrilla", cuadrillaRouter);
routes.use("/pilado", piladoRouter);
routes.use("/selection", selectionRouter);
routes.use("/tunnel-reservations", tunnelReservationsRouter);
routes.use("/tunnel-occupancy", tunnelOccupancyRouter);
routes.use("/suppliers", suppliersRouter);
routes.use("/purchases", purchasesRouter);
routes.use("/costos", costosRouter);
