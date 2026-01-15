import type { CreateCollectionPrepRequest } from "../../shared/requests/CreateCollectionPrepRequest";
import type { CreateCollectionPrepResponse } from "../../shared/responses/CreateCollectionPrepResponse";
import { CollectionPrepService } from "../../services/CollectionPrepService";
import { v4 as uuidv4 } from "uuid";

export class CreateCollectionPrepUseCase {
  constructor(private readonly collectionPrepService: CollectionPrepService) {}

  async execute(request: CreateCollectionPrepRequest): Promise<CreateCollectionPrepResponse> {
    // Generate unique collection prep ID
    const collectionPrepId = uuidv4();

    const collectionPrep = await this.collectionPrepService.createCollectionPrep({
      id: collectionPrepId,
      region: request.region,
      carrier: request.carrier,
      locationId: request.locationId,
      prepDate: new Date(request.prepDate),
      boxes: request.orderIds.length, // Use order count as boxes count
    });

    return {
      collectionPrepId: collectionPrep.id,
      region: collectionPrep.region,
    };
  }
}
