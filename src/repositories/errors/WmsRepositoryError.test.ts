import { describe, expect, it } from "vitest";

import { WmsRepositoryError, WmsRepositoryErrorType, PrismaErrorCode } from "./WmsRepositoryError";

describe("WmsRepositoryError", () => {
  describe("constructor", () => {
    it("should create error with basic properties", () => {
      const error = new WmsRepositoryError(
        WmsRepositoryErrorType.DUPLICATE_RECORD,
        "Order with shopifyOrderId gid://shopify/Order/123",
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(WmsRepositoryError);
      expect(error.name).toBe("WmsRepositoryError");
      expect(error.type).toBe(WmsRepositoryErrorType.DUPLICATE_RECORD);
      expect(error.context).toBe("Order with shopifyOrderId gid://shopify/Order/123");
      expect(error.message).toContain("already exists");
    });

    it("should include constraint fields in message", () => {
      const error = new WmsRepositoryError(
        WmsRepositoryErrorType.DUPLICATE_RECORD,
        "Order with shopifyOrderId X",
        PrismaErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
        ["shopifyOrderId"],
      );

      expect(error.message).toContain("constraint on: shopifyOrderId");
      expect(error.constraintFields).toEqual(["shopifyOrderId"]);
      expect(error.prismaErrorCode).toBe(PrismaErrorCode.UNIQUE_CONSTRAINT_VIOLATION);
    });

    it("should format foreign key violation message", () => {
      const error = new WmsRepositoryError(
        WmsRepositoryErrorType.FOREIGN_KEY_VIOLATION,
        "Order with invalid customerId",
      );

      expect(error.message).toContain("Foreign key constraint failed");
    });

    it("should format record not found message", () => {
      const error = new WmsRepositoryError(WmsRepositoryErrorType.RECORD_NOT_FOUND, "Order with id 123");

      expect(error.message).toContain("not found");
    });

    it("should format unknown database error message", () => {
      const error = new WmsRepositoryError(WmsRepositoryErrorType.UNKNOWN_DATABASE_ERROR, "Order creation");

      expect(error.message).toContain("Database error");
    });
  });

  describe("fromPrismaError", () => {
    it("should handle P2002 unique constraint violation", () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["shopifyOrderId"],
        },
      };

      const error = WmsRepositoryError.fromPrismaError(
        prismaError,
        "Order with shopifyOrderId gid://shopify/Order/123",
      );

      expect(error.type).toBe(WmsRepositoryErrorType.DUPLICATE_RECORD);
      expect(error.prismaErrorCode).toBe(PrismaErrorCode.UNIQUE_CONSTRAINT_VIOLATION);
      expect(error.constraintFields).toEqual(["shopifyOrderId"]);
      expect(error.message).toContain("already exists");
      expect(error.message).toContain("shopifyOrderId");
    });

    it("should handle P2003 foreign key constraint violation", () => {
      const prismaError = {
        code: "P2003",
        meta: {
          target: ["customerId"],
        },
      };

      const error = WmsRepositoryError.fromPrismaError(prismaError, "Order with invalid customerId");

      expect(error.type).toBe(WmsRepositoryErrorType.FOREIGN_KEY_VIOLATION);
      expect(error.prismaErrorCode).toBe(PrismaErrorCode.FOREIGN_KEY_CONSTRAINT_FAILED);
      expect(error.message).toContain("Foreign key constraint failed");
    });

    it("should handle P2025 record not found", () => {
      const prismaError = {
        code: "P2025",
      };

      const error = WmsRepositoryError.fromPrismaError(prismaError, "Order with id 123");

      expect(error.type).toBe(WmsRepositoryErrorType.RECORD_NOT_FOUND);
      expect(error.prismaErrorCode).toBe(PrismaErrorCode.RECORD_NOT_FOUND);
      expect(error.message).toContain("not found");
    });

    it("should handle unknown Prisma error codes", () => {
      const prismaError = {
        code: "P9999",
      };

      const error = WmsRepositoryError.fromPrismaError(prismaError, "Order creation");

      expect(error.type).toBe(WmsRepositoryErrorType.UNKNOWN_DATABASE_ERROR);
      expect(error.prismaErrorCode).toBe("P9999");
      expect(error.message).toContain("Database error");
    });

    it("should handle non-Prisma errors", () => {
      const genericError = new Error("Something went wrong");

      const error = WmsRepositoryError.fromPrismaError(genericError, "Order creation");

      expect(error.type).toBe(WmsRepositoryErrorType.UNKNOWN_DATABASE_ERROR);
      expect(error.prismaErrorCode).toBeUndefined();
    });

    it("should handle null/undefined errors", () => {
      const error = WmsRepositoryError.fromPrismaError(null, "Order creation");

      expect(error.type).toBe(WmsRepositoryErrorType.UNKNOWN_DATABASE_ERROR);
      expect(error.prismaErrorCode).toBeUndefined();
    });

    it("should handle errors without meta field", () => {
      const prismaError = {
        code: "P2002",
      };

      const error = WmsRepositoryError.fromPrismaError(prismaError, "Order with shopifyOrderId X");

      expect(error.type).toBe(WmsRepositoryErrorType.DUPLICATE_RECORD);
      expect(error.constraintFields).toBeUndefined();
      expect(error.message).not.toContain("constraint on:");
    });
  });

  describe("error properties", () => {
    it("should maintain prototype chain", () => {
      const error = new WmsRepositoryError(WmsRepositoryErrorType.DUPLICATE_RECORD, "Test context");

      expect(error instanceof Error).toBe(true);
      expect(error instanceof WmsRepositoryError).toBe(true);
    });

    it("should be throwable and catchable as Error", () => {
      const throwError = (): void => {
        throw new WmsRepositoryError(WmsRepositoryErrorType.DUPLICATE_RECORD, "Test");
      };

      expect(throwError).toThrow(Error);
      expect(throwError).toThrow(WmsRepositoryError);
    });
  });
});
