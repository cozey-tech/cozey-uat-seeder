import type { CreateCollectionPrepRequest } from "../../shared/requests/CreateCollectionPrepRequest";
import type { CreateCollectionPrepResponse } from "../../shared/responses/CreateCollectionPrepResponse";
import { CollectionPrepService } from "../../services/CollectionPrepService";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { carriers } from "../../shared/carriers";

export class CreateCollectionPrepUseCase {
  constructor(
    private readonly collectionPrepService: CollectionPrepService,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Generate a 4-digit UUID (hexadecimal)
   */
  private generate4DigitUuid(): string {
    // Generate 2 random bytes (4 hex digits)
    return randomBytes(2).toString("hex").toUpperCase();
  }

  /**
   * Generate collection prep name in format: [Test Tag]-[Carrier]-[FC]-[4-digit UUID]
   * Example: Outbound_Compliance-Canpar-Langley-1234
   */
  private async generateCollectionPrepName(
    testTag: string | undefined,
    carrierId: string,
    locationId: string,
    region: string,
  ): Promise<string> {
    // Get carrier name from enum
    const carrier = carriers.find(
      (c) => c.code.toLowerCase() === carrierId.toLowerCase(),
    );

    if (!carrier) {
      throw new Error(`Carrier ${carrierId} not found in carriers enum`);
    }

    // Check if carrier is available for the specified region
    // Carriers with region: null are available for all regions
    const isAvailableForRegion = carrier.region === null || carrier.region === region;

    if (!isAvailableForRegion) {
      throw new Error(`Carrier ${carrierId} is not available for region ${region}`);
    }

    // Get location name
    const location = await this.prisma.location.findUnique({
      where: {
        id_region: {
          id: locationId,
          region,
        },
      },
      select: {
        name: true,
      },
    });

    if (!location) {
      throw new Error(`Location ${locationId} not found for region ${region}`);
    }

    // Format carrier name (title case: capitalize first letter of each word)
    const carrierName = carrier.name
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");

    // Format location name (title case: capitalize first letter of each word)
    const locationName = location.name
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");

    // Use test tag if provided, otherwise default
    const tag = testTag || "Test";

    // Generate 4-digit UUID
    const uuid = this.generate4DigitUuid();

    // Format: [Test Tag]-[Carrier]-[FC]-[uuid]
    return `${tag}-${carrierName}-${locationName}-${uuid}`;
  }

  async execute(request: CreateCollectionPrepRequest): Promise<CreateCollectionPrepResponse> {
    // Generate collection prep name in new format
    const collectionPrepId = await this.generateCollectionPrepName(
      request.testTag,
      request.carrier,
      request.locationId,
      request.region,
    );

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
