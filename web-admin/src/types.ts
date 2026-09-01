// Tipos de datos del dominio, extraídos de App.tsx (Fase 3, descomposición).
// Se mueven por tandas contiguas; esta es la primera. Sin cambios: solo se
// trasladaron aquí y App.tsx los importa.

export type Farmer = {
  id: string;
  identification: string | null;
  full_name: string;
  phone: string | null;
  accionista_id: string | null;
  pending_advance_balance: number;
};

export type Product = {
  id: string;
  code: string;
  name: string;
  product_type: string;
  unit: string;
  is_active?: boolean;
};

export type Warehouse = {
  id: string;
  name: string;
  type: string;
};

export type Lot = {
  id: string;
  farmer_id: string;
  lot_code: string;
  farmer_name: string | null;
  rice_type?: string | null;
  status: string;
  accionista_id?: string | null;
  /** Suma de los pesos de materia prima del lote (no de un pesaje suelto). */
  quintals: string | number | null;
  net_weight?: string | number | null;
  /** Cuántos pesos de báscula agrupa el lote. */
  entries_count?: number;
};

// Ingreso de materia prima: un pesaje de báscula que todavía no pertenece a un
// lote. El lote se forma agrupando varios de estos en un túnel de secado.
export type MateriaPrimaEntry = {
  id: string;
  ticket_number: string;
  /** Número del ticket en la app de báscula (ej: "000 074"): el que ve el usuario. */
  numero_bascula: string | null;
  farmer_name: string | null;
  rice_type: string | null;
  is_maquila: boolean;
  quintals: string | number | null;
  net_weight: string | number | null;
  qualification: string | number | null;
};

/** Ingreso de materia prima sin lote, de cualquier accionista: sirve para
 *  corregir el accionista cuando se registró con el equivocado. */
export type MateriaPrimaCorreccion = {
  id: string;
  ticket_number: string;
  numero_bascula: string | null;
  farmer_name: string | null;
  quintals: string | number | null;
  accionista_id: string | null;
  accionista_name: string | null;
  liquidado: boolean;
  created_at: string;
};

/** Ingreso de materia prima pendiente de pagarle al agricultor. */
export type PendingEntry = {
  id: string;
  ticket_number: string;
  numero_bascula: string | null;
  farmer_id: string;
  farmer_name: string | null;
  rice_type: string | null;
  quintals: string | number | null;
  net_weight: string | number | null;
  /** Lote al que ya entró (si está secándose); null si aún es materia prima suelta. */
  lot_code: string | null;
  /** Placa del vehículo que trajo el ingreso (del ticket de báscula), si se conoce. */
  placa?: string | null;
  /** Vehículo de la Flota Propia (campo_activos) auto-detectado por la placa; null = tercero/particular. */
  flota_activo_id?: string | null;
  flota_activo_nombre?: string | null;
};
