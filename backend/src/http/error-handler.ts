import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, `Ruta no encontrada: ${req.method} ${req.path}`));
}

type PgError = Error & { code?: string; detail?: string; constraint?: string };

// Los errores crudos de Postgres ("llave duplicada viola restriccion de
// unicidad") llegaban tal cual a la pantalla: no dicen que hacer y asustan.
// Aqui se traducen a algo accionable. Son la ultima red: cada ruta deberia
// validar antes y dar un mensaje con contexto.
const MENSAJES_POSTGRES: Record<string, { status: number; mensaje: string }> = {
  // unique_violation
  "23505": { status: 409, mensaje: "Ese registro ya existe. Refresca la pantalla para ver el estado actual antes de volver a guardar." },
  // foreign_key_violation
  "23503": { status: 409, mensaje: "No se puede completar: el registro esta enlazado con otro que depende de el." },
  // not_null_violation
  "23502": { status: 400, mensaje: "Falta un dato obligatorio." },
  // check_violation
  "23514": { status: 400, mensaje: "Hay un valor fuera de lo permitido." },
  // invalid_text_representation
  "22P02": { status: 400, mensaje: "Hay un dato con formato invalido." }
};

export function errorHandler(error: Error, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({ error: error.message, statusCode: error.statusCode });
    return;
  }

  // Datos mal formados: antes salia el JSON crudo de zod. Se nombra el campo.
  if (error instanceof ZodError) {
    // Si alguna regla trae mensaje propio (p.ej. "la clave debe tener 8
    // caracteres"), se muestra ese; si no, se listan los campos a revisar.
    const conMensaje = error.issues.find((i) => i.message && !/^(Required|Invalid)/i.test(i.message));
    if (conMensaje) {
      res.status(400).json({ error: conMensaje.message, statusCode: 400 });
      return;
    }
    const campos = error.issues
      .map((i) => i.path.join(".") || "el formulario")
      .filter((c, i, todos) => todos.indexOf(c) === i)
      .join(", ");
    res.status(400).json({
      error: `Revisa estos datos: ${campos}`,
      statusCode: 400
    });
    return;
  }

  const pg = error as PgError;
  const traducido = pg.code ? MENSAJES_POSTGRES[pg.code] : undefined;

  // El detalle tecnico se queda en el log del servidor, donde sirve para
  // diagnosticar, en vez de en la cara del usuario.
  console.error(`[error] ${req.method} ${req.path}`, {
    code: pg.code,
    constraint: pg.constraint,
    detail: pg.detail,
    message: error.message
  });

  if (traducido) {
    res.status(traducido.status).json({ error: traducido.mensaje, statusCode: traducido.status });
    return;
  }

  res.status(500).json({
    error: "Ocurrio un error inesperado. Intenta de nuevo; si sigue igual, avisa con la hora exacta.",
    statusCode: 500
  });
}
