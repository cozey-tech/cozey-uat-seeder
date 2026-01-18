import { z } from "zod";
import { InputValidationError } from "../services/InputParserService";

/**
 * Base handler class that provides common request validation logic
 * for all handlers in the business layer.
 *
 * Handlers should extend this class and implement the execute method,
 * using the protected validateRequest method to validate incoming requests.
 */
export abstract class BaseHandler<RequestType, ResponseType> {
  /**
   * Validates a request against a Zod schema and throws InputValidationError
   * if validation fails.
   *
   * @param request - The request to validate (unknown type)
   * @param schema - The Zod schema to validate against
   * @param operationName - The name of the operation (for error messages)
   * @returns The validated request object
   * @throws InputValidationError if validation fails
   */
  protected validateRequest<T extends RequestType>(
    request: unknown,
    schema: z.ZodSchema<T>,
    operationName: string,
  ): T {
    const result = schema.safeParse(request);

    if (!result.success) {
      const errors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new InputValidationError(`${operationName} request validation failed:\n${errors}`);
    }

    return result.data;
  }

  /**
   * Execute the handler logic. Must be implemented by subclasses.
   *
   * @param request - The validated request
   * @returns The response
   */
  abstract execute(request: unknown): Promise<ResponseType>;
}
