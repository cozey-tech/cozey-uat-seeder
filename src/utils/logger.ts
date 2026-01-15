/**
 * Simple structured logger for the seeder tool
 * In production, this could be replaced with a proper logging library
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  [key: string]: unknown;
}

function maskEmail(email: string): string {
  if (!email || !email.includes("@")) {
    return email;
  }
  const [local, domain] = email.split("@");
  if (local.length <= 2) {
    return `${local[0]}*@${domain}`;
  }
  return `${local.substring(0, 2)}***@${domain}`;
}

function maskPii(data: unknown): unknown {
  if (typeof data === "string" && data.includes("@")) {
    return maskEmail(data);
  }
  if (typeof data === "object" && data !== null) {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.toLowerCase().includes("email")) {
        masked[key] = typeof value === "string" ? maskEmail(value) : value;
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }
  return data;
}

export class Logger {
  private static log(level: LogLevel, message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    const maskedContext = context ? maskPii(context) : undefined;
    const logEntry: Record<string, unknown> = {
      timestamp,
      level,
      message,
    };
    if (maskedContext && typeof maskedContext === "object") {
      logEntry.context = maskedContext;
    }

    // In production, this would go to a logging service
    if (level === "error") {
      console.error(JSON.stringify(logEntry));
    } else if (level === "warn") {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }

  static info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  static warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  static error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext: LogContext = {
      ...context,
      error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
    };
    this.log("error", message, errorContext);
  }

  static debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }
}
