/**
 * Structured logger for the seeder tool with operation tracking and performance logging
 * In production, this could be replaced with a proper logging library
 */

type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogContext {
  [key: string]: unknown;
}

export interface OperationContext extends LogContext {
  operation: string;
  operationId?: string;
}

export interface PerformanceMetrics {
  operation: string;
  duration: number;
  queryCount?: number;
  queryTime?: number;
  itemCount?: number;
  [key: string]: unknown;
}

interface OperationState {
  operationId: string;
  operation: string;
  startTime: number;
  context?: LogContext;
}

// Global operation tracking
const activeOperations = new Map<string, OperationState>();

// Log level filtering (can be set via environment variable)
const getLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  if (envLevel && levels.includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }
  return "info"; // Default to info
};

const shouldLog = (level: LogLevel): boolean => {
  const currentLevel = getLogLevel();
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  const currentIndex = levels.indexOf(currentLevel);
  const messageIndex = levels.indexOf(level);
  return messageIndex >= currentIndex;
};

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
    if (!shouldLog(level)) {
      return;
    }

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
      error: error instanceof Error ? { message: error.message, name: error.name, stack: error.stack } : String(error),
    };
    this.log("error", message, errorContext);
  }

  static debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  /**
   * Start tracking an operation
   * @param operation - Name of the operation (e.g., "createShopifyOrder")
   * @param context - Optional context to include in logs
   * @returns Operation ID for tracking
   */
  static startOperation(operation: string, context?: LogContext): string {
    const operationId = `${operation}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const startTime = Date.now();

    activeOperations.set(operationId, {
      operationId,
      operation,
      startTime,
      context,
    });

    this.info(`Operation started: ${operation}`, {
      operationId,
      operation,
      ...context,
    });

    return operationId;
  }

  /**
   * End tracking an operation
   * @param operationId - Operation ID from startOperation
   * @param success - Whether the operation succeeded
   * @param result - Optional result context
   */
  static endOperation(operationId: string, success: boolean, result?: LogContext): void {
    const operationState = activeOperations.get(operationId);
    if (!operationState) {
      this.warn(`Operation ${operationId} not found in tracking`, { operationId });
      return;
    }

    const duration = Date.now() - operationState.startTime;
    activeOperations.delete(operationId);

    const logContext: LogContext = {
      operationId,
      operation: operationState.operation,
      duration,
      success,
      ...operationState.context,
      ...result,
    };

    if (success) {
      this.info(`Operation completed: ${operationState.operation}`, logContext);
    } else {
      this.warn(`Operation failed: ${operationState.operation}`, logContext);
    }
  }

  /**
   * Log performance metrics for an operation
   * @param metrics - Performance metrics to log
   */
  static performance(metrics: PerformanceMetrics): void {
    const logContext: LogContext = {
      ...metrics,
      type: "performance",
    };
    this.info(`Performance: ${metrics.operation}`, logContext);
  }

  /**
   * Create a context helper that adds common fields to all logs
   * @param baseContext - Base context to include in all logs
   * @returns Logger instance with context
   */
  static withContext(baseContext: LogContext): {
    info: (message: string, context?: LogContext) => void;
    warn: (message: string, context?: LogContext) => void;
    error: (message: string, error?: Error | unknown, context?: LogContext) => void;
    debug: (message: string, context?: LogContext) => void;
    startOperation: (operation: string, context?: LogContext) => string;
    endOperation: (operationId: string, success: boolean, result?: LogContext) => void;
    performance: (metrics: PerformanceMetrics) => void;
  } {
    const mergeContext = (context?: LogContext): LogContext => {
      return { ...baseContext, ...context };
    };

    return {
      info: (message: string, context?: LogContext): void => {
        Logger.info(message, mergeContext(context));
      },
      warn: (message: string, context?: LogContext): void => {
        Logger.warn(message, mergeContext(context));
      },
      error: (message: string, error?: Error | unknown, context?: LogContext): void => {
        Logger.error(message, error, mergeContext(context));
      },
      debug: (message: string, context?: LogContext): void => {
        Logger.debug(message, mergeContext(context));
      },
      startOperation: (operation: string, context?: LogContext): string => {
        return Logger.startOperation(operation, mergeContext(context));
      },
      endOperation: (operationId: string, success: boolean, result?: LogContext): void => {
        Logger.endOperation(operationId, success, mergeContext(result));
      },
      performance: (metrics: PerformanceMetrics): void => {
        Logger.performance({ ...baseContext, ...metrics });
      },
    };
  }

  /**
   * Track an async operation with automatic start/end logging
   * @param operation - Name of the operation
   * @param fn - Async function to execute
   * @param context - Optional context
   * @returns Result of the function
   */
  static async trackOperation<T>(operation: string, fn: () => Promise<T>, context?: LogContext): Promise<T> {
    const operationId = this.startOperation(operation, context);
    try {
      const result = await fn();
      this.endOperation(operationId, true, { result: "success" });
      return result;
    } catch (error) {
      this.endOperation(operationId, false, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
