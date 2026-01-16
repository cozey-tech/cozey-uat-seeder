import type { WmsRepository, CreateCollectionPrepRequest, ICollectionPrep } from "../repositories/interface/WmsRepository";
import type { SeedConfig } from "../shared/types/SeedConfig";
import { OrderType } from "../shared/enums/OrderType";
import { PickType } from "../shared/enums/PickType";
import { Logger } from "../utils/logger";

export class CollectionPrepValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionPrepValidationError";
    Object.setPrototypeOf(this, CollectionPrepValidationError.prototype);
  }
}

/**
 * Service for creating and validating collection prep entities
 *
 * Handles:
 * - Collection prep header creation
 * - Order mix validation (regular-only, PnP-only, mixed)
 */
export class CollectionPrepService {
  private readonly dryRun: boolean;

  constructor(private readonly wmsRepository: WmsRepository, dryRun: boolean = false) {
    this.dryRun = dryRun;
  }

  /**
   * Creates a collection prep header in the WMS database
   *
   * @param request - Collection prep configuration (ID, region, carrier, location, prep date, boxes)
   * @returns Created collection prep entity
   * @throws WmsServiceError if database operation fails
   */
  async createCollectionPrep(
    request: CreateCollectionPrepRequest,
  ): Promise<ICollectionPrep> {
    if (this.dryRun) {
      const mockCollectionPrep: ICollectionPrep = {
        id: request.id,
        region: request.region,
        carrier: request.carrier,
        locationId: request.locationId,
        prepDate: request.prepDate,
        boxes: request.boxes,
      };
      Logger.info("DRY RUN: Would create collection prep", {
        collectionPrepId: request.id,
        region: request.region,
        carrier: request.carrier,
        locationId: request.locationId,
        prepDate: request.prepDate,
        boxes: request.boxes,
      });
      return mockCollectionPrep;
    }

    const collectionPrep = await this.wmsRepository.createCollectionPrep(request);
    return collectionPrep;
  }

  /**
   * Validates that order types match their declared types
   *
   * Ensures:
   * - "regular-only" orders don't contain PnP items
   * - "pnp-only" orders don't contain regular items
   * - "mixed" orders contain both types
   *
   * @param config - Seed configuration to validate
   * @param _orderIds - Order IDs (currently unused, reserved for future use)
   * @throws CollectionPrepValidationError if order mix validation fails
   */
  validateOrderMix(config: SeedConfig, _orderIds: string[]): void {
    if (!config.collectionPrep) {
      return; // No validation needed if collectionPrep not specified
    }

    // Collect order types from config
    const orderTypes = config.orders
      .map((order) => order.orderType)
      .filter((type): type is "regular-only" | "pnp-only" | "mixed" => type !== undefined);

    if (orderTypes.length === 0) {
      // No orderType specified, skip validation
      return;
    }

    // Verify we have the expected mix
    const hasRegularOnly = orderTypes.includes(OrderType.RegularOnly);
    const hasPnpOnly = orderTypes.includes(OrderType.PnpOnly);
    const hasMixed = orderTypes.includes(OrderType.Mixed);

    // Validate that orders match their declared types
    for (let i = 0; i < config.orders.length; i++) {
      const order = config.orders[i];
      if (order.orderType) {
        const actualPickTypes = new Set(
          order.lineItems.map((item) => item.pickType),
        );

        if (order.orderType === OrderType.RegularOnly) {
          const hasPnpItems = actualPickTypes.has(PickType.PickAndPack);
          if (hasPnpItems) {
            throw new CollectionPrepValidationError(
              `Order ${i + 1} is declared as 'regular-only' but contains Pick and Pack items`,
            );
          }
        } else if (order.orderType === OrderType.PnpOnly) {
          const hasRegularItems = actualPickTypes.has(PickType.Regular);
          if (hasRegularItems) {
            throw new CollectionPrepValidationError(
              `Order ${i + 1} is declared as 'pnp-only' but contains Regular items`,
            );
          }
        } else if (order.orderType === OrderType.Mixed) {
          if (actualPickTypes.size < 2) {
            throw new CollectionPrepValidationError(
              `Order ${i + 1} is declared as 'mixed' but does not contain both Regular and Pick and Pack items`,
            );
          }
        }
      }
    }

    // Warn if mix is not ideal (but don't throw - flexible)
    if (!hasRegularOnly && !hasPnpOnly && !hasMixed) {
      // This is just a warning, not an error
      // Note: Logger import would be needed if we want structured logging here
      // For now, keeping console.warn as it's a non-critical warning
    }
  }
}
