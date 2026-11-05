import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { ESCRITURA_SIN_MODULO, LECTURA_SIN_MODULO, READ_MODULES_BY_PREFIX, WRITE_MODULES_BY_PREFIX } from "./require-auth.js";

// 🔐 Toda ruta nueva debe decidir quién la usa. Si alguien monta un prefijo y no lo clasifica, esta prueba falla
// (y mientras tanto el servidor lo deja cerrado para los operadores: ver aplicarPermisosDeEscritura).
const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes");
const index = fs.readFileSync(path.join(routesDir, "index.ts"), "utf8");
const archivoDe = Object.fromEntries([...index.matchAll(/import \{ (\w+) \} from "\.\/modules\/([\w-]+)\.js";/g)].map((m) => [m[1], m[2]]));
const trasElFiltro = index.slice(index.indexOf("routes.use(enforceModulePermissions);"));
const montados = [...trasElFiltro.matchAll(/routes\.use\("\/([\w-]+)", (\w+)\)/g)].map((m) => ({ prefix: m[1], router: m[2] }));
const tieneEscrituras = (router: string) =>
  new RegExp(`${router}\\.(post|put|patch|delete)\\(`).test(fs.readFileSync(path.join(routesDir, "modules", `${archivoDe[router]}.ts`), "utf8"));

describe("cobertura de permisos", () => {
  it("encuentra los prefijos montados", () => {
    expect(montados.length).toBeGreaterThan(40);
  });

  it("todo prefijo con escrituras tiene módulo o está declarado a propósito", () => {
    const sinRegla = montados.filter(({ prefix, router }) => tieneEscrituras(router) && !WRITE_MODULES_BY_PREFIX[prefix] && !ESCRITURA_SIN_MODULO.has(prefix));
    expect(sinRegla.map((m) => m.prefix)).toEqual([]);
  });

  it("todo prefijo se lee con un módulo o está declarado libre a propósito", () => {
    const sinRegla = montados.filter(({ prefix }) => !READ_MODULES_BY_PREFIX[prefix] && !LECTURA_SIN_MODULO.has(prefix));
    expect(sinRegla.map((m) => m.prefix)).toEqual([]);
  });

  it("lo declarado libre no choca con una regla", () => {
    expect([...ESCRITURA_SIN_MODULO].filter((p) => WRITE_MODULES_BY_PREFIX[p])).toEqual([]);
    expect([...LECTURA_SIN_MODULO].filter((p) => READ_MODULES_BY_PREFIX[p])).toEqual([]);
  });
});
