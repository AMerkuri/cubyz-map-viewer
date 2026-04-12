import type { NextFunction, Request, Response } from "express";
import { logger } from "../services/logger.js";
import { HttpError, isNodeErrorWithCode } from "./errors.js";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const statusCode =
    err instanceof HttpError
      ? err.statusCode
      : isNodeErrorWithCode(err) && err.code === "ENOENT"
        ? 404
        : 500;
  const message =
    err instanceof HttpError
      ? err.message
      : statusCode === 404
        ? "Not found"
        : "Internal server error";

  logger.error("request failed", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    error: message,
    stack: statusCode >= 500 && err instanceof Error ? err.stack : undefined,
  });

  if (err instanceof HttpError && err.headers) {
    for (const [key, value] of Object.entries(err.headers)) {
      res.setHeader(key, value);
    }
  }

  res.status(statusCode).json({
    error: message,
    requestId: req.requestId,
  });
}
