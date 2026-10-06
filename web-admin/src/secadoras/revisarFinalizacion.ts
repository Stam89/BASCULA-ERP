// Revisión previa al finalizar un túnel de secado: detecta los errores típicos ANTES de
// cerrar (se cerró el túnel equivocado, hora final antes del inicio o en el futuro,
// duración rara). Es lógica pura: no toca la pantalla ni el servidor.
//
//  · «bloqueo»   → no se puede finalizar hasta corregirlo.
//  · «confirmar» → se puede, pero hay que marcar «confirmo que es correcto».
//  · «info»      → solo informa.

export type NivelAviso = "bloqueo" | "confirmar" | "info";
export type AvisoFinalizacion = { nivel: NivelAviso; texto: string };

export type TunelHermano = {
  tunel: number;
  /** ISO (o datetime-local) de cuando empezó a secar; null si no se anotó. */
  inicio: string | null;
};

export type EntradaRevision = {
  tunel: number;
  motor: number;
  /** Valores tal cual los escribió la persona (datetime-local: «2026-10-02T07:00»). */
  inicio: string;
  fin: string;
  ahora?: Date;
  /** Otros túneles del MISMO motor que siguen en proceso. */
  hermanosEnProceso: TunelHermano[];
};

export type ResultadoRevision = {
  /** Horas de secado (fin − inicio); null si faltan o no son válidas las fechas. */
  horas: number | null;
  avisos: AvisoFinalizacion[];
  bloqueado: boolean;
  /** Hay algo que exige marcar «confirmo» antes de finalizar. */
  requiereConfirmar: boolean;
};

/** Un secado normal dura ~13–16 h; fuera de este rango se pide confirmar. */
export const HORAS_NORMAL_MIN = 6;
export const HORAS_NORMAL_MAX = 30;
const TOLERANCIA_FUTURO_MIN = 5;

const fechaHora = (d: Date) =>
  d.toLocaleString("es-EC", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function duracionTexto(horas: number): string {
  const min = Math.round(horas * 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function revisarFinalizacion(e: EntradaRevision): ResultadoRevision {
  const ahora = e.ahora ?? new Date();
  const avisos: AvisoFinalizacion[] = [];
  const ini = e.inicio ? new Date(e.inicio) : null;
  const fin = e.fin ? new Date(e.fin) : null;
  const iniOk = !!ini && !Number.isNaN(ini.getTime());
  const finOk = !!fin && !Number.isNaN(fin.getTime());

  if (!iniOk) avisos.push({ nivel: "bloqueo", texto: "Falta la hora de inicio del secado." });
  if (!finOk) avisos.push({ nivel: "bloqueo", texto: "Falta la hora final del secado." });

  let horas: number | null = null;
  if (iniOk && finOk) {
    horas = (fin!.getTime() - ini!.getTime()) / 3600000;
    if (horas <= 0) {
      avisos.push({ nivel: "bloqueo", texto: "La hora final es anterior (o igual) a la hora de inicio. Corrígela antes de finalizar." });
    } else {
      if (fin!.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MIN * 60000) {
        avisos.push({ nivel: "confirmar", texto: `La hora final (${fechaHora(fin!)}) todavía no ha llegado. ¿Seguro que ya terminó?` });
      }
      if (horas < HORAS_NORMAL_MIN || horas > HORAS_NORMAL_MAX) {
        avisos.push({ nivel: "confirmar", texto: `La duración (${duracionTexto(horas)}) es poco común: un secado normal dura unas 13 a 16 horas. Revisa las horas.` });
      }
    }
  }

  // El error típico: finalizar el túnel que no era. Si otro túnel del mismo motor se
  // llenó ANTES y sigue en proceso, lo normal es que termine primero ese.
  if (iniOk) {
    for (const h of [...e.hermanosEnProceso].sort((a, b) => a.tunel - b.tunel)) {
      const hi = h.inicio ? new Date(h.inicio) : null;
      if (hi && !Number.isNaN(hi.getTime()) && hi.getTime() < ini!.getTime()) {
        avisos.push({
          nivel: "confirmar",
          texto: `El Túnel ${h.tunel} empezó antes (${fechaHora(hi)}) y sigue en proceso. Normalmente termina primero el que se llenó primero: confirma que este (Túnel ${e.tunel}) es el que terminó.`
        });
      }
    }
  }

  const restantes = e.hermanosEnProceso.length;
  avisos.push({
    nivel: "info",
    texto: restantes === 0
      ? `Este es el último túnel del Motor ${e.motor}: al finalizar te pedirá registrar el combustible para apagar el motor.`
      : `Después de finalizar, el Motor ${e.motor} sigue con ${restantes === 1 ? `el Túnel ${e.hermanosEnProceso[0].tunel}` : `${restantes} túneles`} en proceso.`
  });

  return {
    horas,
    avisos,
    bloqueado: avisos.some((a) => a.nivel === "bloqueo"),
    requiereConfirmar: avisos.some((a) => a.nivel === "confirmar")
  };
}
