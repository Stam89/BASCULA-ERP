// 🚚 Bajada de carro PARCIAL (pedido del dueño 2026-10-30): una volqueta se vacía sola (no se paga), pero uno de los
// chicos ayudó a bajar una parte → se le paga solo esos QQ. Luego «todo el ticket» y «no se paga». SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 240)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
try {
  const datos = exigir(await api("GET", "/cuadrilla/bajadas?todo=1", undefined, matriz), "0. bajadas del período");
  const f = datos.filas.find((x) => !x.paid_at && !x.antes_del_corte && x.qq > 10);
  check(!!f, "1. hay un ticket por pagar", f?.numero);
  const tarifa = Number(datos.tarifa);
  const entrada = async () => (await q("SELECT worker_name, quantity::float qq, subtotal::float s, notes FROM cuadrilla_entries WHERE origen='BASCULA' AND referencia_id=$1", [f.ticket_id]))[0];

  exigir(await api("POST", "/cuadrilla/bajadas/asignar", { ticket_id: f.ticket_id, trabajador: null, no_se_paga: true }, matriz), "2. marcar «no se paga» (volqueta)");
  check(!(await entrada()), "3. no queda bajada por pagar", await entrada());

  const mas = await api("POST", "/cuadrilla/bajadas/asignar", { ticket_id: f.ticket_id, trabajador: "SIM AYUDANTE", qq: f.qq + 5 }, matriz);
  check(mas.status === 400, "4. no deja pagar más QQ que el ticket", mostrar(mas));

  exigir(await api("POST", "/cuadrilla/bajadas/asignar", { ticket_id: f.ticket_id, trabajador: "SIM AYUDANTE", qq: 10 }, matriz), "5. SIM AYUDANTE bajó 10 QQ");
  const e1 = await entrada();
  check(e1 && e1.worker_name === "SIM AYUDANTE" && cerca(e1.qq, 10) && cerca(e1.s, 10 * tarifa) && /bajó 10 de/.test(e1.notes), "6. se le pagan solo 10 QQ", e1);
  const fila = (await api("GET", "/cuadrilla/bajadas?todo=1", undefined, matriz)).data.filas.find((x) => x.ticket_id === f.ticket_id);
  check(cerca(fila.bajada_qq, 10), "7. la pantalla ve la parte", fila.bajada_qq);

  exigir(await api("POST", "/cuadrilla/bajadas/asignar", { ticket_id: f.ticket_id, trabajador: "SIM OTRO" }, matriz), "8. cambiar el nombre sin tocar la parte");
  check(cerca((await entrada()).qq, 10), "9. sigue siendo la parte de 10 QQ", await entrada());

  exigir(await api("POST", "/cuadrilla/bajadas/asignar", { ticket_id: f.ticket_id, trabajador: "SIM OTRO", qq: null }, matriz), "10. volver a «todo el ticket»");
  check(cerca((await entrada()).qq, f.qq), "11. vuelve a pagar todo el ticket", await entrada());

  exigir(await api("POST", "/cuadrilla/bajadas/asignar", { ticket_id: f.ticket_id, trabajador: "SIM OTRO", qq: 4 }, matriz), "12. parte de 4 QQ");
  exigir(await api("POST", "/cuadrilla/bajadas/asignar", { ticket_id: f.ticket_id, trabajador: null, no_se_paga: true }, matriz), "13. «no se paga» otra vez");
  const t = (await q("SELECT bajada_qq FROM mobile_synced_tickets WHERE id=$1", [f.ticket_id]))[0];
  check(t.bajada_qq === null && !(await entrada()), "14. «no se paga» borra la parte", t);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
