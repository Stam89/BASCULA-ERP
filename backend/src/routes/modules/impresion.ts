import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";

// 🖨️ IMPRESIÓN DIRECTA (pedido del dueño 2026-10-23: «¿cómo selecciono la impresora? tengo 2»). Una página web no puede
// elegir impresora; el servidor del ERP sí, porque corre en la PC de la oficina y ve las impresoras de Windows:
//   documento HTML → PDF (Edge/Chrome sin ventana) → SumatraPDF lo manda a la impresora elegida, en silencio.
// Así cada documento sale directo a su Epson, desde cualquier equipo (PC, celular o tablet).
export const impresionRouter = Router();
const ejecutar = promisify(execFile);

const SUMATRA = [process.env.SUMATRA_PATH, "C:\\BASCULA-Impresion\\SumatraPDF.exe",
  "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe", path.join(os.homedir(), "AppData\\Local\\SumatraPDF\\SumatraPDF.exe")]
  .filter(Boolean) as string[];
const NAVEGADORES = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];
const primero = (lista: string[]) => lista.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
// Impresoras virtuales que no sirven para imprimir papel (y «Print to PDF» abre una ventana de guardar: colgaría).
const VIRTUALES = /onenote|xps document writer|print to pdf|^fax$|anydesk/i;

type Impresora = { nombre: string; predeterminada: boolean; desconectada: boolean };
let cache: { at: number; lista: Impresora[] } | null = null;

async function impresorasDeWindows(): Promise<Impresora[]> {
  if (process.platform !== "win32") return [];
  if (cache && Date.now() - cache.at < 30_000) return cache.lista;
  const { stdout } = await ejecutar("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Printer | Select-Object Name, Default, WorkOffline, PrinterStatus | ConvertTo-Json -Compress"],
    { windowsHide: true, timeout: 15_000 });
  const crudo = JSON.parse(stdout.trim() || "[]");
  const filas = (Array.isArray(crudo) ? crudo : [crudo]) as Array<{ Name: string; Default: boolean; WorkOffline: boolean; PrinterStatus: number }>;
  const lista = filas.filter((f) => f?.Name && !VIRTUALES.test(f.Name))
    .map((f) => ({ nombre: f.Name, predeterminada: !!f.Default, desconectada: !!f.WorkOffline || f.PrinterStatus === 7 }));
  cache = { at: Date.now(), lista };
  return lista;
}

impresionRouter.get("/estado", asyncRoute(async (_req, res) => {
  const sumatra = primero(SUMATRA);
  const navegador = primero(NAVEGADORES);
  let impresoras: Impresora[] = [];
  try { impresoras = await impresorasDeWindows(); } catch { impresoras = []; }
  res.json({ disponible: !!sumatra && !!navegador && impresoras.length > 0, falta: !sumatra ? "SumatraPDF" : !navegador ? "Edge o Chrome" : null, impresoras });
}));

impresionRouter.post("/imprimir", asyncRoute(async (req, res) => {
  const body = z.object({
    impresora: z.string().trim().min(1).max(200),
    html: z.string().min(20).max(1_900_000),
    copias: z.number().int().min(1).max(5).default(1),
    titulo: z.string().trim().max(120).optional()
  }).parse(req.body);
  const sumatra = primero(SUMATRA);
  const navegador = primero(NAVEGADORES);
  if (!sumatra || !navegador) throw new ApiError(503, `La impresión directa no está lista en el servidor: falta ${!sumatra ? "SumatraPDF" : "Edge o Chrome"}.`);
  // Solo impresoras que Windows conoce (el nombre va como argumento, nunca por consola).
  const impresoras = await impresorasDeWindows();
  const imp = impresoras.find((i) => i.nombre === body.impresora);
  if (!imp) throw new ApiError(404, `La impresora «${body.impresora}» no está instalada en la PC del servidor.`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-imprimir-"));
  const html = path.join(dir, "documento.html");
  const pdf = path.join(dir, "documento.pdf");
  try {
    // Las rutas relativas del documento (logo, /uploads…) se resuelven contra este mismo servidor.
    const puerto = Number(process.env.PORT) || 4000;
    const conBase = /<head[^>]*>/i.test(body.html)
      ? body.html.replace(/<head([^>]*)>/i, `<head$1><base href="http://127.0.0.1:${puerto}/">`)
      : `<base href="http://127.0.0.1:${puerto}/">${body.html}`;
    fs.writeFileSync(html, conBase, "utf8");
    await ejecutar(navegador, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
      `--user-data-dir=${path.join(dir, "perfil")}`, `--print-to-pdf=${pdf}`, `file:///${html.replace(/\\/g, "/")}`
    ], { windowsHide: true, timeout: 45_000 });
    if (!fs.existsSync(pdf) || fs.statSync(pdf).size < 200) throw new ApiError(500, "No se pudo preparar el documento para imprimir.");
    await ejecutar(sumatra, ["-print-to", imp.nombre, "-print-settings", `${body.copias}x`, "-silent", "-exit-when-done", pdf],
      { windowsHide: true, timeout: 90_000 });
    res.json({ ok: true, impresora: imp.nombre, desconectada: imp.desconectada });
  } finally {
    // Se borra después: la cola de Windows ya tomó el trabajo.
    setTimeout(() => fs.rm(dir, { recursive: true, force: true }, () => undefined), 60_000);
  }
}));
