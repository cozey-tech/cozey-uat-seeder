import { createCollectionPrepRequestSchema } from "../../shared/requests/CreateCollectionPrepRequest";
import type { CreateCollectionPrepRequest } from "../../shared/requests/CreateCollectionPrepRequest";
import type { CreateCollectionPrepResponse } from "../../shared/responses/CreateCollectionPrepResponse";
import { CreateCollectionPrepUseCase } from "./CreateCollectionPrepUseCase";
import { BaseHandler } from "../BaseHandler";

export class CreateCollectionPrepHandler extends BaseHandler<
  CreateCollectionPrepRequest,
  CreateCollectionPrepResponse
> {
  constructor(private readonly useCase: CreateCollectionPrepUseCase) {
    super();
  }

  async execute(request: unknown): Promise<CreateCollectionPrepResponse> {
    const validatedRequest = this.validateRequest(request, createCollectionPrepRequestSchema, "CreateCollectionPrep");

    return this.useCase.execute(validatedRequest);
  }
}
