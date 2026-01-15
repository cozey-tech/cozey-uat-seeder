import { seedShopifyOrdersRequestSchema } from "../../shared/requests/SeedShopifyOrdersRequest";
import type { SeedShopifyOrdersRequest } from "../../shared/requests/SeedShopifyOrdersRequest";
import type { SeedShopifyOrdersResponse } from "../../shared/responses/SeedShopifyOrdersResponse";
import { SeedShopifyOrdersUseCase } from "./SeedShopifyOrdersUseCase";
import { InputValidationError } from "../../services/InputParserService";

export class SeedShopifyOrdersHandler {
  constructor(private readonly useCase: SeedShopifyOrdersUseCase) {}

  async execute(request: unknown): Promise<SeedShopifyOrdersResponse> {
    // Validate request with Zod schema
    const result = seedShopifyOrdersRequestSchema.safeParse(request);

    if (!result.success) {
      const errors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new InputValidationError(`SeedShopifyOrders request validation failed:\n${errors}`);
    }

    const validatedRequest: SeedShopifyOrdersRequest = result.data;

    // Execute use case
    return await this.useCase.execute(validatedRequest);
  }
}
