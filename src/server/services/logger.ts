import { mkdirSync } from "fs";
import { join } from "path";

import winston from "winston";

const logDir = process.env.LOG_DIR ?? join(process.cwd(), "logs");
mkdirSync(logDir, { recursive: true });

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const requestOnlyFormat = winston.format((info) => info.level === "http" ? info : false)();

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level}: ${message}${extra}`;
  }),
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  defaultMeta: { service: "cubyz-map-viewer-server" },
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({ filename: join(logDir, "server-error.log"), level: "error", format: fileFormat }),
    new winston.transports.File({ filename: join(logDir, "server-combined.log"), format: fileFormat }),
    new winston.transports.File({ filename: join(logDir, "server-requests.log"), level: "http", format: winston.format.combine(requestOnlyFormat, fileFormat) }),
  ],
});
