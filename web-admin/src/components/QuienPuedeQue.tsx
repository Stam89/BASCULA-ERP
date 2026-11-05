import { useMemo, useState } from "react";
import { clavesAntiguasConEfecto, haceCuanto, nivelDePermiso, sinUsoReciente, type NivelPermiso } from "./permisosUtil";

// 🔎 ¿Quién puede qué? Una sola tabla con los permisos de todos los operadores en un accionista, y lo que conviene revisar.
// Solo lee lo que ya trajo la lista de usuarios. Los administradores pueden todo y por eso no salen.

type Usuario = {
  id: string;
  name: string;
  is_active: boolean;
  role_name: string | null;
  recovery_email?: string | null;
  ultimo_ingreso_at?: string | null;
  accionista_modules?: Array<{ accionista_id: string; modules: string[] }> | null;
};

const MARCA: Record<NivelPermiso, { txt: string; titulo: string }> = {
  editar: { txt: "✏️", titulo: "Ve y edita" },
  ver: { txt: "👁️", titulo: "Solo ver" },
  parcial: { txt: "◐", titulo: "Solo algunas secciones o algunas en solo ver" },
  si: { txt: "✓", titulo: "Tiene el permiso" },
  no: { txt: "·", titulo: "Sin acceso" }
};

export function QuienPuedeQue({ usuarios, accionistas, grupos, conocidas }: {
  usuarios: Usuario[];
  accionistas: Array<{ id: string; name: string; is_active: boolean }>;
  grupos: Array<{ label: string; rows: Array<{ key: string; label: string }> }>;
  conocidas: Set<string>;
}) {
  const activos = accionistas.filter((a) => a.is_active);
  const [accId, setAccId] = useState(activos[0]?.id ?? "");
  const operadores = useMemo(() => usuarios.filter((u) => u.is_active && u.role_name !== "ADMINISTRADOR"), [usuarios]);
  const clavesDe = (u: Usuario, id: string) => (u.accionista_modules ?? []).find((x) => x.accionista_id === id)?.modules ?? null;
  const conAcceso = operadores.filter((u) => clavesDe(u, accId) !== null);
  const nombreAcc = (id: string) => accionistas.find((a) => a.id === id)?.name ?? "";

  const panel = operadores.filter((u) => (u.accionista_modules ?? []).some((x) => (x.modules ?? []).includes("Dashboard")));
  const antiguas = clavesAntiguasConEfecto(operadores.map((u) => ({
    name: u.name,
    vinculos: (u.accionista_modules ?? []).map((x) => ({ accionista: nombreAcc(x.accionista_id), modules: x.modules ?? [] }))
  })), conocidas);
  const sinCorreo = operadores.filter((u) => !u.recovery_email);
  const sinUso = operadores.filter((u) => sinUsoReciente(u.ultimo_ingreso_at));

  return (
    <div className="quienPuede">
      <label className="quienPuede__acc">
        <span>Accionista</span>
        <select value={accId} onChange={(e) => setAccId(e.target.value)}>
          {activos.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <p className="muted quienPuede__leyenda">
        {(["editar", "ver", "parcial", "si"] as const).map((n) => <span key={n}><b>{MARCA[n].txt}</b> {MARCA[n].titulo}</span>)}
        <span>Los administradores pueden todo.</span>
      </p>
      {conAcceso.length === 0 ? (
        <p className="muted">Ningún operador tiene acceso a {nombreAcc(accId)}.</p>
      ) : (
        <div className="quienPuede__tabla">
          <table className="cajaTable">
            <thead>
              <tr><th>Permiso</th>{conAcceso.map((u) => <th key={u.id}>{u.name}</th>)}</tr>
            </thead>
            <tbody>
              {grupos.flatMap((g) => g.rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  {conAcceso.map((u) => {
                    const n = nivelDePermiso(clavesDe(u, accId) ?? [], row.key);
                    return <td key={u.id} className={n === "no" ? "muted quienPuede__celda" : "quienPuede__celda"} title={MARCA[n].titulo}>{MARCA[n].txt}</td>;
                  })}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="quienPuede__titulo">Para revisar</h4>
      <ul className="quienPuede__lista">
        <li>
          <b>Ven las cifras de todos los accionistas</b> (Panel Integral): {panel.length ? panel.map((u) => u.name).join(", ") : "nadie"}.
          {panel.length > 0 && " Si no deben verlas, quita esa fila en sus permisos."}
        </li>
        {antiguas.length > 0 && (
          <li>
            <b>Claves antiguas que la matriz no mostraba:</b>
            <ul>
              {antiguas.map((a) => <li key={a.clave}><code>{a.clave}</code>: {a.efecto}. Lo tienen: {a.quienes}.</li>)}
            </ul>
            Se quitan en «Accionistas y permisos» de cada usuario, al final de la tabla.
          </li>
        )}
        {sinUso.length > 0 && (
          <li><b>Sin usar su usuario en 30 días o más:</b> {sinUso.map((u) => `${u.name} (${haceCuanto(u.ultimo_ingreso_at).toLowerCase()})`).join(", ")}. Si ya no lo usan, desactívalos.</li>
        )}
        {sinCorreo.length > 0 && (
          <li><b>Sin correo para recuperar la clave:</b> {sinCorreo.map((u) => u.name).join(", ")}.</li>
        )}
      </ul>
    </div>
  );
}
