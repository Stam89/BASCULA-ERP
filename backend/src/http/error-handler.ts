import type { NextFunction, Request, Response } from "express";

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, `Ruta no encontrada: ${req.method} ${req.path}`));
}

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction) {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  res.status(statusCode).json({
    error: error.message,
    statusCode
  });
}
