import { seedWmsEntitiesRequestSchema } from "../../shared/requests/SeedWmsEntitiesRequest";
import type { SeedWmsEntitiesRequest } from "../../shared/requests/SeedWmsEntitiesRequest";
import type { SeedWmsEntitiesResponse } from "../../shared/responses/SeedWmsEntitiesResponse";
import { SeedWmsEntitiesUseCase } from "./SeedWmsEntitiesUseCase";
import { BaseHandler } from "../BaseHandler";

export class SeedWmsEntitiesHandler extends BaseHandler<SeedWmsEntitiesRequest, SeedWmsEntitiesResponse> {
  constructor(private readonly useCase: SeedWmsEntitiesUseCase) {
    super();
  }

  async execute(request: unknown): Promise<SeedWmsEntitiesResponse> {
    const validatedRequest = this.validateRequest(request, seedWmsEntitiesRequestSchema, "SeedWmsEntities");

    const requestWithCallback: SeedWmsEntitiesRequest = {
      ...validatedRequest,
      ...(typeof request === "object" && request !== null && "onOrderProgress" in request
        ? { onOrderProgress: (request as SeedWmsEntitiesRequest).onOrderProgress }
        : {}),
    };

    return this.useCase.execute(requestWithCallback);
  }
}
