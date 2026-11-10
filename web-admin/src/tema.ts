// 🎨 Tema de color de la app (pedido del dueño 2026-11-09: «ponle un color fosforescente»). Se elige por equipo y
// queda en <html data-tema="…">; las paletas viven en styles.css. Sin dato = verde fosforescente.
export type Tema = "neon-verde" | "neon-lima" | "neon-naranja" | "neon-rosa" | "neon-celeste" | "clasico";

export const TEMAS: Array<{ id: Tema; nombre: string; nota: string; oscuro: string; relleno: string; tinta: string }> = [
  { id: "neon-verde", nombre: "Verde fosforescente", nota: "El de la app", oscuro: "#07130b", relleno: "#39ff14", tinta: "#128000" },
  { id: "neon-lima", nombre: "Amarillo fosforescente", nota: "Limón neón", oscuro: "#0d1006", relleno: "#dfff00", tinta: "#5b6b00" },
  { id: "neon-naranja", nombre: "Naranja fosforescente", nota: "Naranja neón", oscuro: "#150c06", relleno: "#ff6a00", tinta: "#c2410c" },
  { id: "neon-rosa", nombre: "Rosado fosforescente", nota: "Fucsia neón", oscuro: "#170818", relleno: "#ff3ebf", tinta: "#be185d" },
  { id: "neon-celeste", nombre: "Celeste fosforescente", nota: "Cian neón", oscuro: "#06131a", relleno: "#00eaff", tinta: "#0e7490" },
  { id: "clasico", nombre: "Clásico", nota: "Los colores de antes", oscuro: "#0c1b17", relleno: "#0f766e", tinta: "#14b8a6" }
];

const CLAVE = "bascula-erp:tema";
const POR_DEFECTO: Tema = "neon-verde";

export function temaGuardado(): Tema {
  try {
    const t = localStorage.getItem(CLAVE);
    return TEMAS.some((x) => x.id === t) ? (t as Tema) : POR_DEFECTO;
  } catch {
    return POR_DEFECTO;
  }
}

/** Pone el tema en la página (y la barra del navegador del celular en su tono oscuro). */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === POR_DEFECTO) raiz.removeAttribute("data-tema");
  else raiz.setAttribute("data-tema", tema);
  const oscuro = TEMAS.find((x) => x.id === tema)?.oscuro ?? "#07130b";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", oscuro);
}

export function guardarTema(tema: Tema): void {
  try { localStorage.setItem(CLAVE, tema); } catch { /* sin almacenamiento: vale hasta recargar */ }
  aplicarTema(tema);
}
