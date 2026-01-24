import type { WmsRepository } from "../repositories/interface/WmsRepository";
import type {
  CreatePnpPackageInfoRequest,
  CreatePnpBoxRequest,
  CreatePnpOrderBoxRequest,
} from "../repositories/interface/WmsRepository";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "../utils/logger";

export class WmsServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WmsServiceError";
    Object.setPrototypeOf(this, WmsServiceError.prototype);
  }
}

/**
 * Service for creating WMS entities (orders, customers, preps, etc.)
 *
 * Handles:
 * - Order and customer creation (with transactions)
 * - Variant order creation
 * - Prep and prep part creation
 * - PnP entity creation
 * - Shipment creation
 *
 * All operations are idempotent - checks for existing records before creating.
 */
export class WmsService {
  private readonly dryRun: boolean;

  constructor(
    public readonly repository: WmsRepository,
    dryRun: boolean = false,
  ) {
    this.dryRun = dryRun;
  }

  /**
   * Creates a WMS order and associated customer
   *
   * Idempotent: If order already exists (by shopifyOrderId), returns existing order.
   * If customer doesn't exist (by email + region), creates new customer.
   *
   * @param shopifyOrderId - Shopify order ID (unique identifier)
   * @param shopifyOrderNumber - Shopify order number (display number)
   * @param status - Order status (e.g., "fulfilled")
   * @param region - Region code (e.g., "CA")
   * @param customerName - Customer name
   * @param customerEmail - Customer email (used for idempotency lookup)
   * @param locationId - Optional location ID
   * @returns Order database ID, Shopify order ID, and customer ID
   * @throws WmsServiceError if database operation fails
   */
  async createOrderWithCustomer(
    shopifyOrderId: string,
    shopifyOrderNumber: string,
    status: string,
    region: string,
    customerName: string,
    customerEmail: string,
    locationId?: string,
  ): Promise<{ orderDbId: string; shopifyOrderId: string; customerId: string }> {
    // Idempotency check - still run in dry-run for validation
    const existingOrder = await this.repository.findOrderByShopifyId(shopifyOrderId);
    if (existingOrder) {
      return {
        orderDbId: existingOrder.id,
        shopifyOrderId: existingOrder.shopifyOrderId,
        customerId: "", // Will be populated if needed
      };
    }

    if (this.dryRun) {
      const orderDbId = uuidv4();
      const customerId = uuidv4();
      Logger.info("DRY RUN: Would create order with customer", {
        shopifyOrderId,
        shopifyOrderNumber,
        orderDbId,
        customerId,
        customerEmail,
        customerName,
        status,
        region,
        locationId,
      });
      return { orderDbId, shopifyOrderId, customerId };
    }

    // Idempotency: reuse existing customer if found
    let customer = await this.repository.findCustomerByEmail(customerEmail, region);
    const customerId = customer?.id || uuidv4();

    if (!customer) {
      // Use transaction to ensure atomicity: order and customer must be created together
      // Prevents orphaned orders if customer creation fails after order creation
      const result = await this.repository.createOrderWithCustomerTransaction(
        {
          shopifyOrderId: shopifyOrderId,
          shopifyOrderNumber: shopifyOrderNumber,
          status: status,
          region: region,
          locationId: locationId,
          sourceName: "wms_seed",
        },
        {
          id: customerId,
          name: customerName,
          email: customerEmail,
          region: region,
        },
      );
      return {
        orderDbId: result.order.id,
        shopifyOrderId: result.order.shopifyOrderId,
        customerId: result.customerId,
      };
    }

    // Customer exists, create order only
    const order = await this.repository.createOrder({
      shopifyOrderId: shopifyOrderId,
      shopifyOrderNumber: shopifyOrderNumber,
      status: status,
      region: region,
      customerId: customer.id,
      locationId: locationId,
      sourceName: "wms_seed",
    });

    return {
      orderDbId: order.id,
      shopifyOrderId: order.shopifyOrderId,
      customerId: customer.id,
    };
  }

  async createVariantOrdersForOrder(
    orderId: string,
    lineItems: Array<{ lineItemId: string; sku: string; quantity: number }>,
    region: string,
  ): Promise<Array<{ variantId: string; lineItemId: string }>> {
    // Batch lookup all variants at once (still run in dry-run for validation)
    const skus = lineItems.map((item) => item.sku);
    const variantMap = await this.repository.findVariantsBySkus(skus, region);

    const results: Array<{ variantId: string; lineItemId: string }> = [];

    for (const lineItem of lineItems) {
      const variant = variantMap.get(lineItem.sku);
      if (!variant) {
        throw new WmsServiceError(`Variant not found for SKU: ${lineItem.sku}`);
      }

      if (this.dryRun) {
        Logger.info("DRY RUN: Would create variant order", {
          orderId,
          lineItemId: lineItem.lineItemId,
          variantId: variant.id,
          sku: lineItem.sku,
          quantity: lineItem.quantity,
          region,
        });
        results.push({
          variantId: variant.id,
          lineItemId: lineItem.lineItemId,
        });
        continue;
      }

      // Create variantOrder
      await this.repository.createVariantOrder({
        orderId: orderId,
        lineItemId: lineItem.lineItemId,
        variantId: variant.id,
        quantity: lineItem.quantity,
        region: region,
      });

      results.push({
        variantId: variant.id,
        lineItemId: lineItem.lineItemId,
      });
    }

    return results;
  }

  async createPrepsForOrder(
    orderId: string,
    variantOrders: Array<{ variantId: string; lineItemId: string }>,
    collectionPrepId: string | undefined,
    region: string,
  ): Promise<Array<{ prepId: string; variantId: string; lineItemId: string }>> {
    const results: Array<{ prepId: string; variantId: string; lineItemId: string }> = [];

    for (const variantOrder of variantOrders) {
      // Generate prep ID (composite key: prep + region)
      const prepId = uuidv4();

      if (this.dryRun) {
        Logger.info("DRY RUN: Would create prep", {
          orderId,
          prepId,
          variantId: variantOrder.variantId,
          lineItemId: variantOrder.lineItemId,
          collectionPrepId,
          region,
        });
        results.push({
          prepId: prepId,
          variantId: variantOrder.variantId,
          lineItemId: variantOrder.lineItemId,
        });
        continue;
      }

      await this.repository.createPrep({
        orderId: orderId,
        prep: prepId,
        collectionPrepId: collectionPrepId,
        region: region,
        variantId: variantOrder.variantId,
        lineItemId: variantOrder.lineItemId,
      });

      results.push({
        prepId: prepId,
        variantId: variantOrder.variantId,
        lineItemId: variantOrder.lineItemId,
      });
    }

    return results;
  }

  async createPrepPartsAndItems(
    preps: Array<{ prepId: string; variantId: string; lineItemId: string }>,
    lineItems: Array<{ lineItemId: string; sku: string; quantity: number }>,
    region: string,
  ): Promise<Array<{ prepPartId: string; prepPartItemId: string; partId: string }>> {
    // Batch lookup all parts by variant IDs to avoid N+1 queries
    // VariantPart relationship maps variants to their constituent parts
    const variantIds = preps.map((prep) => prep.variantId);
    const partsByVariantId = await this.repository.findPartsByVariantIds(variantIds, region);

    const results: Array<{ prepPartId: string; prepPartItemId: string; partId: string }> = [];

    for (const prep of preps) {
      const lineItem = lineItems.find((item) => item.lineItemId === prep.lineItemId);
      if (!lineItem) {
        throw new WmsServiceError(`Line item not found: ${prep.lineItemId}`);
      }

      const variantParts = partsByVariantId.get(prep.variantId) || [];
      if (variantParts.length === 0) {
        throw new WmsServiceError(`No parts found for variant ID: ${prep.variantId} (SKU: ${lineItem.sku})`);
      }

      // Create prep parts for each part in the variant
      // The quantity for each prep part is: variantPart.quantity * lineItem.quantity
      for (const variantPart of variantParts) {
        const prepPartQuantity = variantPart.quantity * lineItem.quantity;

        if (this.dryRun) {
          const prepPartId = uuidv4();
          const prepPartItemId = uuidv4();
          Logger.info("DRY RUN: Would create prep part and item", {
            prepId: prep.prepId,
            prepPartId,
            prepPartItemId,
            partId: variantPart.id,
            partSku: variantPart.sku,
            variantPartQuantity: variantPart.quantity,
            lineItemQuantity: lineItem.quantity,
            prepPartQuantity,
            region,
          });
          results.push({
            prepPartId,
            prepPartItemId,
            partId: variantPart.id,
          });
          continue;
        }

        // Create prepPart
        const prepPart = await this.repository.createPrepPart({
          prepId: prep.prepId,
          partId: variantPart.id,
          quantity: prepPartQuantity,
          region: region,
        });

        const prepPartId = (prepPart as { id: string }).id;

        // Create prepPartItem
        const prepPartItem = await this.repository.createPrepPartItem({
          prepPartId: prepPartId,
          region: region as "CA" | "US",
        });

        const prepPartItemId = (prepPartItem as { id: string }).id;

        results.push({
          prepPartId: prepPartId,
          prepPartItemId: prepPartItemId,
          partId: variantPart.id,
        });
      }
    }

    return results;
  }

  /**
   * Find shipment by order ID and collection prep ID
   * Used when checking if a shipment already exists for idempotent orders
   */
  async findShipmentByOrderAndCollectionPrep(orderId: string, collectionPrepId: string): Promise<string | null> {
    const shipments = await this.repository.findShipmentsByOrderIds([orderId]);
    const matchingShipment = shipments.find((s) => s.collectionPrepId === collectionPrepId);
    return matchingShipment?.id || null;
  }

  async createShipmentForOrder(collectionPrepId: string, orderId: string, region: string): Promise<string> {
    if (this.dryRun) {
      const shipmentId = uuidv4();
      Logger.info("DRY RUN: Would create shipment", {
        collectionPrepId,
        orderId,
        shipmentId,
        region,
      });
      return shipmentId;
    }

    const shipment = await this.repository.createShipment({
      collectionPrepId: collectionPrepId,
      orderId: orderId,
      region: region,
      status: "ACTIVE",
    });

    return (shipment as { id: string }).id;
  }

  async createPnpPackageInfo(packageInfo: CreatePnpPackageInfoRequest): Promise<string> {
    if (this.dryRun) {
      const packageInfoId = uuidv4();
      Logger.info("DRY RUN: Would create PnP package info", {
        identifier: packageInfo.identifier,
        packageInfoId,
        length: packageInfo.length,
        width: packageInfo.width,
        height: packageInfo.height,
        weight: packageInfo.weight,
        lengthUnit: packageInfo.lengthUnit,
        widthUnit: packageInfo.widthUnit,
        heightUnit: packageInfo.heightUnit,
        weightUnit: packageInfo.weightUnit,
      });
      return packageInfoId;
    }

    const created = await this.repository.createPnpPackageInfo(packageInfo);
    return (created as { id: string }).id;
  }

  async createPnpBoxes(boxes: CreatePnpBoxRequest[]): Promise<string[]> {
    const boxIds: string[] = [];

    for (const box of boxes) {
      if (this.dryRun) {
        const boxId = uuidv4();
        Logger.info("DRY RUN: Would create PnP box", {
          identifier: box.identifier,
          boxId,
          region: box.region,
          length: box.length,
          width: box.width,
          height: box.height,
          lengthUnit: box.lengthUnit,
          widthUnit: box.widthUnit,
          heightUnit: box.heightUnit,
        });
        boxIds.push(boxId);
        continue;
      }

      const created = await this.repository.createPnpBox(box);
      boxIds.push((created as { id: string }).id);
    }

    return boxIds;
  }

  async createPnpOrderBoxes(orderBoxes: CreatePnpOrderBoxRequest[]): Promise<Array<{ id: string; lpn: string }>> {
    const results: Array<{ id: string; lpn: string }> = [];

    for (const orderBox of orderBoxes) {
      if (this.dryRun) {
        const orderBoxId = uuidv4();
        Logger.info("DRY RUN: Would create PnP order box", {
          orderId: orderBox.orderId,
          pnpBoxId: orderBox.pnpBoxId,
          collectionPrepId: orderBox.collectionPrepId,
          lpn: orderBox.lpn,
          status: orderBox.status,
          region: orderBox.region,
          orderBoxId: orderBoxId,
        });
        results.push({
          id: orderBoxId,
          lpn: orderBox.lpn,
        });
        continue;
      }

      const created = await this.repository.createPnpOrderBox(orderBox);
      results.push({
        id: (created as { id: string }).id,
        lpn: orderBox.lpn,
      });
    }

    return results;
  }
}
