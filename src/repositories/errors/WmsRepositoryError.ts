/**
 * Prisma error codes that we handle
 */
export enum PrismaErrorCode {
  UNIQUE_CONSTRAINT_VIOLATION = "P2002",
  FOREIGN_KEY_CONSTRAINT_FAILED = "P2003",
  RECORD_NOT_FOUND = "P2025",
}

/**
 * Types of WMS repository errors
 */
export enum WmsRepositoryErrorType {
  DUPLICATE_RECORD = "DUPLICATE_RECORD",
  FOREIGN_KEY_VIOLATION = "FOREIGN_KEY_VIOLATION",
  RECORD_NOT_FOUND = "RECORD_NOT_FOUND",
  UNKNOWN_DATABASE_ERROR = "UNKNOWN_DATABASE_ERROR",
}

/**
 * Structured error for WMS repository operations
 */
export class WmsRepositoryError extends Error {
  public readonly type: WmsRepositoryErrorType;
  public readonly context: string;
  public readonly prismaErrorCode?: string;
  public readonly constraintFields?: string[];

  constructor(type: WmsRepositoryErrorType, context: string, prismaErrorCode?: string, constraintFields?: string[]) {
    const message = WmsRepositoryError.formatMessage(type, context, constraintFields);
    super(message);
    this.name = "WmsRepositoryError";
    this.type = type;
    this.context = context;
    this.prismaErrorCode = prismaErrorCode;
    this.constraintFields = constraintFields;
    Object.setPrototypeOf(this, WmsRepositoryError.prototype);
  }

  private static formatMessage(type: WmsRepositoryErrorType, context: string, constraintFields?: string[]): string {
    switch (type) {
      case WmsRepositoryErrorType.DUPLICATE_RECORD:
        return `${context} already exists${constraintFields ? ` (constraint on: ${constraintFields.join(", ")})` : ""}`;
      case WmsRepositoryErrorType.FOREIGN_KEY_VIOLATION:
        return `Foreign key constraint failed for ${context}`;
      case WmsRepositoryErrorType.RECORD_NOT_FOUND:
        return `${context} not found`;
      case WmsRepositoryErrorType.UNKNOWN_DATABASE_ERROR:
        return `Database error for ${context}`;
      default:
        return `Error for ${context}`;
    }
  }

  /**
   * Create a WmsRepositoryError from a Prisma error
   * @param error - The Prisma error object
   * @param context - Context message (e.g., "Order with shopifyOrderId X")
   * @returns WmsRepositoryError with appropriate type and metadata
   */
  static fromPrismaError(error: unknown, context: string): WmsRepositoryError {
    if (!error || typeof error !== "object") {
      return new WmsRepositoryError(WmsRepositoryErrorType.UNKNOWN_DATABASE_ERROR, context);
    }

    const prismaError = error as { code?: string; meta?: { target?: string[] } };

    switch (prismaError.code) {
      case PrismaErrorCode.UNIQUE_CONSTRAINT_VIOLATION:
        return new WmsRepositoryError(
          WmsRepositoryErrorType.DUPLICATE_RECORD,
          context,
          prismaError.code,
          prismaError.meta?.target,
        );
      case PrismaErrorCode.FOREIGN_KEY_CONSTRAINT_FAILED:
        return new WmsRepositoryError(
          WmsRepositoryErrorType.FOREIGN_KEY_VIOLATION,
          context,
          prismaError.code,
          prismaError.meta?.target,
        );
      case PrismaErrorCode.RECORD_NOT_FOUND:
        return new WmsRepositoryError(WmsRepositoryErrorType.RECORD_NOT_FOUND, context, prismaError.code);
      default:
        return new WmsRepositoryError(WmsRepositoryErrorType.UNKNOWN_DATABASE_ERROR, context, prismaError.code);
    }
  }
}
