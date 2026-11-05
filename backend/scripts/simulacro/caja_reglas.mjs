// 📐 Reglas de la Caja: el administrador las crea y quita; lo escrito dos veces no se duplica; sin dato o con categoría
// que no existe se rechaza; se ve el rubro que la categoría ya tiene. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`;
try {
  const a = await api("POST", "/cash/reglas", { quien: "Plan Sister", category: "REPUESTOS" }, matriz);
  check(a.status === 201, "A1. crea regla de un proveedor", mostrar(a));
  const b = await api("POST", "/cash/reglas", { quien: "plan sister", category: "GASTO_OPERATIVO" }, matriz);
  check(b.status === 201 && b.data.id === a.data.id, "A2. la misma regla se actualiza, no se duplica", mostrar(b));
  const c = await api("POST", "/cash/reglas", { quien: "Montacarga", palabra: "gasolina", category: "GASOLINA_MONTACARGA" }, matriz);
  check(c.status === 201, "A3. regla con quién y qué", mostrar(c));
  const vacia = await api("POST", "/cash/reglas", { category: "REPUESTOS" }, matriz);
  check(vacia.status === 400, "B1. sin quién ni qué se rechaza", mostrar(vacia));
  const mala = await api("POST", "/cash/reglas", { quien: "X", category: "NO_EXISTE" }, matriz);
  check(mala.status === 400, "B2. categoría que no existe se rechaza", mostrar(mala));
  const lista = await api("GET", "/cash/reglas", undefined, matriz);
  const ps = lista.data.find((x) => x.id === a.data.id);
  check(ps?.category === "GASTO_OPERATIVO" && !!ps.categoria_nombre, "C1. la lista trae el nombre de la categoría", JSON.stringify(ps));
  const conRubro = (await q("SELECT 1 FROM costo_rubros WHERE 'GASTO_OPERATIVO' = ANY (categorias)")).length > 0;
  check(!conRubro || !!ps?.rubro, "C2. y el rubro que ya tiene la categoría", JSON.stringify(ps));
  const d = await api("DELETE", `/cash/reglas/${a.data.id}`, undefined, matriz);
  check(d.ok, "D1. se quita", mostrar(d));
  const d2 = await api("DELETE", `/cash/reglas/${a.data.id}`, undefined, matriz);
  check(d2.status === 404, "D2. quitarla otra vez avisa", mostrar(d2));
  await q("DELETE FROM caja_reglas WHERE id = $1", [c.data.id]);
} catch (e) { console.log("⛔", e.message); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
