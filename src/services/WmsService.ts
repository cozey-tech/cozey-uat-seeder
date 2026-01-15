import type { WmsRepository } from "../repositories/interface/WmsRepository";
import type {
  CreateOrderRequest,
  CreateVariantOrderRequest,
  CreatePrepRequest,
  CreateShipmentRequest,
  CreatePrepPartRequest,
  CreatePrepPartItemRequest,
  CreatePnpPackageInfoRequest,
  CreatePnpBoxRequest,
  CreatePnpOrderBoxRequest,
} from "../repositories/interface/WmsRepository";
import { v4 as uuidv4 } from "uuid";

export class WmsServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WmsServiceError";
    Object.setPrototypeOf(this, WmsServiceError.prototype);
  }
}

export class WmsService {
  constructor(private readonly repository: WmsRepository) {}

  async createOrderWithCustomer(
    shopifyOrderId: string,
    shopifyOrderNumber: string,
    status: string,
    region: string,
    customerName: string,
    customerEmail: string,
    locationId?: string,
  ): Promise<{ orderId: string; customerId: string }> {
    // Generate or find customer ID
    const customerId = uuidv4();
    const existingCustomer = await this.repository.findCustomerById(customerId);

    if (!existingCustomer) {
      await this.repository.createCustomer({
        id: customerId,
        name: customerName,
        email: customerEmail,
        region: region,
      });
    }

    // Create order
    const order = await this.repository.createOrder({
      shopifyOrderId: shopifyOrderId,
      shopifyOrderNumber: shopifyOrderNumber,
      status: status,
      region: region,
      customerId: customerId,
      locationId: locationId,
      sourceName: "wms_seed",
    });

    return {
      orderId: order.id,
      customerId: customerId,
    };
  }

  async createVariantOrdersForOrder(
    orderId: string,
    lineItems: Array<{ lineItemId: string; sku: string; quantity: number }>,
    region: string,
  ): Promise<Array<{ variantId: string; lineItemId: string }>> {
    const results: Array<{ variantId: string; lineItemId: string }> = [];

    for (const lineItem of lineItems) {
      // Find variant by SKU
      const variant = await this.repository.findVariantBySku(lineItem.sku, region);
      if (!variant) {
        throw new WmsServiceError(`Variant not found for SKU: ${lineItem.sku}`);
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
    const results: Array<{ prepPartId: string; prepPartItemId: string; partId: string }> = [];

    for (const prep of preps) {
      const lineItem = lineItems.find((item) => item.lineItemId === prep.lineItemId);
      if (!lineItem) {
        throw new WmsServiceError(`Line item not found: ${prep.lineItemId}`);
      }

      // Find part by SKU
      const part = await this.repository.findPartBySku(lineItem.sku, region);
      if (!part) {
        throw new WmsServiceError(`Part not found for SKU: ${lineItem.sku}`);
      }

      // Create prepPart
      const prepPart = await this.repository.createPrepPart({
        prepId: prep.prepId,
        partId: part.id,
        quantity: lineItem.quantity,
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
        partId: part.id,
      });
    }

    return results;
  }

  async createShipmentForOrder(
    collectionPrepId: string,
    orderId: string,
    region: string,
  ): Promise<string> {
    const shipment = await this.repository.createShipment({
      collectionPrepId: collectionPrepId,
      orderId: orderId,
      region: region,
      status: "ACTIVE",
    });

    return (shipment as { id: string }).id;
  }

  async createPnpPackageInfo(packageInfo: CreatePnpPackageInfoRequest): Promise<string> {
    const created = await this.repository.createPnpPackageInfo(packageInfo);
    return (created as { id: string }).id;
  }

  async createPnpBoxes(boxes: CreatePnpBoxRequest[]): Promise<string[]> {
    const boxIds: string[] = [];

    for (const box of boxes) {
      const created = await this.repository.createPnpBox(box);
      boxIds.push((created as { id: string }).id);
    }

    return boxIds;
  }

  async createPnpOrderBoxes(
    orderBoxes: CreatePnpOrderBoxRequest[],
  ): Promise<Array<{ id: string; lpn: string }>> {
    const results: Array<{ id: string; lpn: string }> = [];

    for (const orderBox of orderBoxes) {
      const created = await this.repository.createPnpOrderBox(orderBox);
      results.push({
        id: (created as { id: string }).id,
        lpn: orderBox.lpn,
      });
    }

    return results;
  }
}
