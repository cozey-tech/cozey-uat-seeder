import { seedShopifyOrdersRequestSchema } from "../../shared/requests/SeedShopifyOrdersRequest";
import type { SeedShopifyOrdersRequest } from "../../shared/requests/SeedShopifyOrdersRequest";
import type { SeedShopifyOrdersResponse } from "../../shared/responses/SeedShopifyOrdersResponse";
import { SeedShopifyOrdersUseCase } from "./SeedShopifyOrdersUseCase";
import { BaseHandler } from "../BaseHandler";

export class SeedShopifyOrdersHandler extends BaseHandler<SeedShopifyOrdersRequest, SeedShopifyOrdersResponse> {
  constructor(private readonly useCase: SeedShopifyOrdersUseCase) {
    super();
  }

  async execute(request: unknown): Promise<SeedShopifyOrdersResponse> {
    const validatedRequest = this.validateRequest(request, seedShopifyOrdersRequestSchema, "SeedShopifyOrders");

    // Execute use case
    return await this.useCase.execute(validatedRequest);
  }
}
