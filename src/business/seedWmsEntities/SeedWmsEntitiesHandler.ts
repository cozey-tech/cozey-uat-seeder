import { seedWmsEntitiesRequestSchema } from "../../shared/requests/SeedWmsEntitiesRequest";
import type { SeedWmsEntitiesRequest } from "../../shared/requests/SeedWmsEntitiesRequest";
import type { SeedWmsEntitiesResponse } from "../../shared/responses/SeedWmsEntitiesResponse";
import { SeedWmsEntitiesUseCase } from "./SeedWmsEntitiesUseCase";
import { InputValidationError } from "../../services/InputParserService";

export class SeedWmsEntitiesHandler {
  constructor(private readonly useCase: SeedWmsEntitiesUseCase) {}

  async execute(request: unknown): Promise<SeedWmsEntitiesResponse> {
    // Validate request with Zod schema
    const result = seedWmsEntitiesRequestSchema.safeParse(request);

    if (!result.success) {
      const errors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new InputValidationError(`SeedWmsEntities request validation failed:\n${errors}`);
    }

    const validatedRequest: SeedWmsEntitiesRequest = result.data;

    // Execute use case
    return await this.useCase.execute(validatedRequest);
  }
}
