import { cleanupRequestSchema } from "../../shared/requests/CleanupRequest";
import type { CleanupRequest } from "../../shared/requests/CleanupRequest";
import type { CleanupResponse } from "../../shared/responses/CleanupResponse";
import type { CleanupUseCase } from "./CleanupUseCase";
import { InputValidationError } from "../../services/InputParserService";

export class CleanupHandler {
  constructor(private readonly useCase: CleanupUseCase) {}

  async execute(request: unknown): Promise<CleanupResponse> {
    const result = cleanupRequestSchema.safeParse(request);

    if (!result.success) {
      const errors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new InputValidationError(`Cleanup request validation failed:\n${errors}`);
    }

    const cleanupRequest: CleanupRequest = {
      ...result.data,
      onProgress: (request as Partial<CleanupRequest>).onProgress,
    };

    return this.useCase.execute(cleanupRequest);
  }
}
