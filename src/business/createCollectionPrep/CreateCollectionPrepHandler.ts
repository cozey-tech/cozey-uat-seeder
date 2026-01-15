import { createCollectionPrepRequestSchema } from "../../shared/requests/CreateCollectionPrepRequest";
import type { CreateCollectionPrepRequest } from "../../shared/requests/CreateCollectionPrepRequest";
import type { CreateCollectionPrepResponse } from "../../shared/responses/CreateCollectionPrepResponse";
import { CreateCollectionPrepUseCase } from "./CreateCollectionPrepUseCase";
import { InputValidationError } from "../../services/InputParserService";

export class CreateCollectionPrepHandler {
  constructor(private readonly useCase: CreateCollectionPrepUseCase) {}

  async execute(request: unknown): Promise<CreateCollectionPrepResponse> {
    // Validate request with Zod schema
    const result = createCollectionPrepRequestSchema.safeParse(request);

    if (!result.success) {
      const errors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new InputValidationError(`CreateCollectionPrep request validation failed:\n${errors}`);
    }

    const validatedRequest: CreateCollectionPrepRequest = result.data;

    // Execute use case
    return await this.useCase.execute(validatedRequest);
  }
}
