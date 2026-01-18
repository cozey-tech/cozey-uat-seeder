import { PrismaClient } from "@prisma/client";
import type {
  WmsRepository,
  CreateOrderRequest,
  CreateVariantOrderRequest,
  CreatePrepRequest,
  CreateCollectionPrepRequest,
  CreateShipmentRequest,
  CreatePnpPackageInfoRequest,
  CreatePnpBoxRequest,
  CreatePnpOrderBoxRequest,
  CreatePrepPartRequest,
  CreatePrepPartItemRequest,
  IOrder,
  ICollectionPrep,
  IShipment,
} from "../interface/WmsRepository";

export class WmsPrismaRepository implements WmsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Handle Prisma unique constraint violation errors (P2002)
   * @param error - The error to check
   * @param context - Context message for the error (e.g., "Order with shopifyOrderId X")
   * @throws Error with context message if P2002 error, otherwise re-throws original error
   */
  private handlePrismaError(error: unknown, context: string): never {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new Error(`${context} already exists`);
    }
    throw error;
  }

  async createOrder(order: CreateOrderRequest): Promise<IOrder> {
    try {
      const created = await this.prisma.order.create({
        data: {
          shopifyOrderId: order.shopifyOrderId,
          shopifyOrderNumber: order.shopifyOrderNumber,
          status: order.status,
          region: order.region,
          customerId: order.customerId,
          locationId: order.locationId,
          sourceName: order.sourceName || "wms_seed",
        },
      });

      return {
        id: created.id,
        shopifyOrderId: created.shopifyOrderId,
        shopifyOrderNumber: created.shopifyOrderNumber,
        status: created.status,
        region: created.region,
      };
    } catch (error: unknown) {
      this.handlePrismaError(error, `Order with shopifyOrderId ${order.shopifyOrderId}`);
    }
  }

  async createVariantOrder(variantOrder: CreateVariantOrderRequest): Promise<unknown> {
    try {
      return await this.prisma.variantOrder.create({
        data: {
          orderId: variantOrder.orderId,
          lineItemId: variantOrder.lineItemId,
          variantId: variantOrder.variantId,
          quantity: variantOrder.quantity,
          region: variantOrder.region,
        },
      });
    } catch (error: unknown) {
      this.handlePrismaError(error, `VariantOrder with lineItemId ${variantOrder.lineItemId}`);
    }
  }

  async createPrep(prep: CreatePrepRequest): Promise<unknown> {
    try {
      return await this.prisma.prep.create({
        data: {
          orderId: prep.orderId,
          prep: prep.prep,
          collectionPrepId: prep.collectionPrepId,
          region: prep.region,
          variantId: prep.variantId,
          lineItemId: prep.lineItemId,
        },
      });
    } catch (error: unknown) {
      this.handlePrismaError(error, `Prep with id ${prep.prep} and region ${prep.region}`);
    }
  }

  async createCollectionPrep(collectionPrep: CreateCollectionPrepRequest): Promise<ICollectionPrep> {
    const created = await this.prisma.collectionPrep.create({
      data: {
        id: collectionPrep.id,
        region: collectionPrep.region,
        carrier: collectionPrep.carrier,
        locationId: collectionPrep.locationId,
        prepDate: collectionPrep.prepDate,
        boxes: collectionPrep.boxes,
      },
    });

    return {
      id: created.id,
      region: created.region,
      carrier: created.carrier,
      locationId: created.locationId,
      prepDate: created.prepDate,
      boxes: created.boxes,
    };
  }

  async createShipment(shipment: CreateShipmentRequest): Promise<IShipment> {
    try {
      const created = await this.prisma.shipment.create({
        data: {
          collectionPrepId: shipment.collectionPrepId,
          orderId: shipment.orderId,
          region: shipment.region,
          status: shipment.status,
        },
      });

      return {
        id: created.id,
        collectionPrepId: created.collectionPrepId,
        orderId: created.orderId,
        status: created.status,
      };
    } catch (error: unknown) {
      this.handlePrismaError(
        error,
        `Shipment for order ${shipment.orderId} and collectionPrep ${shipment.collectionPrepId}`,
      );
    }
  }

  async createPnpPackageInfo(packageInfo: CreatePnpPackageInfoRequest): Promise<unknown> {
    return this.prisma.pnpPackageInfo.create({
      data: {
        identifier: packageInfo.identifier,
        length: packageInfo.length,
        width: packageInfo.width,
        height: packageInfo.height,
        weight: packageInfo.weight,
        lengthUnit: packageInfo.lengthUnit || "IN",
        widthUnit: packageInfo.widthUnit || "IN",
        heightUnit: packageInfo.heightUnit || "IN",
        weightUnit: packageInfo.weightUnit || "LB",
      },
    });
  }

  async createPnpBox(box: CreatePnpBoxRequest): Promise<unknown> {
    return this.prisma.pnpBox.create({
      data: {
        identifier: box.identifier,
        length: box.length,
        width: box.width,
        height: box.height,
        region: box.region,
        lengthUnit: box.lengthUnit || "IN",
        widthUnit: box.widthUnit || "IN",
        heightUnit: box.heightUnit || "IN",
      },
    });
  }

  async createPnpOrderBox(orderBox: CreatePnpOrderBoxRequest): Promise<unknown> {
    return this.prisma.pnpOrderBox.create({
      data: {
        collectionPrepId: orderBox.collectionPrepId,
        orderId: orderBox.orderId,
        lpn: orderBox.lpn,
        status: orderBox.status,
        pnpBoxId: orderBox.pnpBoxId,
        region: orderBox.region,
      },
    });
  }

  async findPartBySku(sku: string, region: string): Promise<{ id: string; sku: string } | null> {
    const part = await this.prisma.part.findFirst({
      where: {
        sku: sku,
        region: region,
      },
      select: {
        id: true,
        sku: true,
      },
    });

    return part;
  }

  async findVariantBySku(sku: string, region: string): Promise<{ id: string; sku: string } | null> {
    const variant = await this.prisma.variant.findFirst({
      where: {
        sku: sku,
        region: region,
      },
      select: {
        id: true,
        sku: true,
      },
    });

    return variant;
  }

  async findVariantsBySkus(skus: string[], region: string): Promise<Map<string, { id: string; sku: string }>> {
    const variants = await this.prisma.variant.findMany({
      where: {
        sku: { in: skus },
        region: region,
      },
      select: {
        id: true,
        sku: true,
      },
    });

    const variantMap = new Map<string, { id: string; sku: string }>();
    for (const variant of variants) {
      variantMap.set(variant.sku, variant);
    }
    return variantMap;
  }

  async findPartsBySkus(skus: string[], region: string): Promise<Map<string, { id: string; sku: string }>> {
    const parts = await this.prisma.part.findMany({
      where: {
        sku: { in: skus },
        region: region,
      },
      select: {
        id: true,
        sku: true,
      },
    });

    const partMap = new Map<string, { id: string; sku: string }>();
    for (const part of parts) {
      partMap.set(part.sku, part);
    }
    return partMap;
  }

  async findPartsByVariantIds(
    variantIds: string[],
    region: string,
  ): Promise<Map<string, Array<{ id: string; sku: string; quantity: number }>>> {
    const variantParts = await this.prisma.variantPart.findMany({
      where: {
        variantId: { in: variantIds },
        region: region,
      },
      include: {
        part: {
          select: {
            id: true,
            sku: true,
          },
        },
      },
    });

    // Group parts by variantId
    const partsByVariantId = new Map<string, Array<{ id: string; sku: string; quantity: number }>>();
    for (const variantPart of variantParts) {
      const existing = partsByVariantId.get(variantPart.variantId) || [];
      existing.push({
        id: variantPart.part.id,
        sku: variantPart.part.sku,
        quantity: Number(variantPart.quantity),
      });
      partsByVariantId.set(variantPart.variantId, existing);
    }
    return partsByVariantId;
  }

  async createPrepPart(prepPart: CreatePrepPartRequest): Promise<unknown> {
    return this.prisma.prepPart.create({
      data: {
        prepId: prepPart.prepId,
        partId: prepPart.partId,
        quantity: prepPart.quantity,
        region: prepPart.region,
      },
    });
  }

  async createPrepPartItem(prepPartItem: CreatePrepPartItemRequest): Promise<unknown> {
    return this.prisma.prepPartItem.create({
      data: {
        prepPartId: prepPartItem.prepPartId,
        region: (prepPartItem.region || "CA") as "CA" | "US",
      },
    });
  }

  async findCustomerById(customerId: string): Promise<{ id: string; name: string; email?: string } | null> {
    const customer = await this.prisma.customer.findUnique({
      where: {
        id: customerId,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!customer) {
      return null;
    }

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email ?? undefined,
    };
  }

  async findCustomerByEmail(
    email: string,
    region: string,
  ): Promise<{ id: string; name: string; email?: string } | null> {
    const customer = await this.prisma.customer.findFirst({
      where: {
        email: email,
        region: region,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!customer) {
      return null;
    }

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email ?? undefined,
    };
  }

  async findOrderByShopifyId(shopifyOrderId: string): Promise<IOrder | null> {
    const order = await this.prisma.order.findUnique({
      where: {
        shopifyOrderId: shopifyOrderId,
      },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderNumber: true,
        status: true,
        region: true,
      },
    });

    return order;
  }

  async createCustomer(customer: { id: string; name: string; email?: string; region: string }): Promise<unknown> {
    try {
      return await this.prisma.customer.create({
        data: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          region: customer.region,
        },
      });
    } catch (error: unknown) {
      this.handlePrismaError(error, `Customer with id ${customer.id} or email ${customer.email}`);
    }
  }

  // Transaction ensures atomicity: order and customer must be created together
  // Prevents orphaned orders if customer creation fails after order creation
  async createOrderWithCustomerTransaction(
    order: CreateOrderRequest,
    customer: { id: string; name: string; email?: string; region: string },
  ): Promise<{ order: IOrder; customerId: string }> {
    return this.prisma.$transaction(async (tx) => {
      // Upsert customer (create if not exists, update if exists)
      const customerRecord = await tx.customer.upsert({
        where: {
          id: customer.id,
        },
        update: {
          name: customer.name,
          email: customer.email,
        },
        create: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          region: customer.region,
        },
      });

      // Create order
      const orderRecord = await tx.order.create({
        data: {
          shopifyOrderId: order.shopifyOrderId,
          shopifyOrderNumber: order.shopifyOrderNumber,
          status: order.status,
          region: order.region,
          customerId: customerRecord.id,
          locationId: order.locationId,
          sourceName: order.sourceName || "wms_seed",
        },
      });

      return {
        order: {
          id: orderRecord.id,
          shopifyOrderId: orderRecord.shopifyOrderId,
          shopifyOrderNumber: orderRecord.shopifyOrderNumber,
          status: orderRecord.status,
          region: orderRecord.region,
        },
        customerId: customerRecord.id,
      };
    });
  }

  // Transaction ensures atomicity: order, variantOrders, and preps must be created together
  // Prevents partial state if any operation fails (e.g., order created but variantOrders fail)
  async createOrderEntitiesTransaction(
    order: CreateOrderRequest,
    variantOrders: CreateVariantOrderRequest[],
    preps: CreatePrepRequest[],
  ): Promise<{ order: IOrder; variantOrderIds: string[]; prepIds: string[] }> {
    return this.prisma.$transaction(async (tx) => {
      // Create order
      const orderRecord = await tx.order.create({
        data: {
          shopifyOrderId: order.shopifyOrderId,
          shopifyOrderNumber: order.shopifyOrderNumber,
          status: order.status,
          region: order.region,
          customerId: order.customerId,
          locationId: order.locationId,
          sourceName: order.sourceName || "wms_seed",
        },
      });

      // Create variantOrders
      const variantOrderIds: string[] = [];
      for (const variantOrder of variantOrders) {
        const created = await tx.variantOrder.create({
          data: {
            orderId: variantOrder.orderId,
            lineItemId: variantOrder.lineItemId,
            variantId: variantOrder.variantId,
            quantity: variantOrder.quantity,
            region: variantOrder.region,
          },
        });
        variantOrderIds.push(created.lineItemId);
      }

      // Create preps
      const prepIds: string[] = [];
      for (const prep of preps) {
        const created = await tx.prep.create({
          data: {
            orderId: prep.orderId,
            prep: prep.prep,
            collectionPrepId: prep.collectionPrepId,
            region: prep.region,
            variantId: prep.variantId,
            lineItemId: prep.lineItemId,
          },
        });
        prepIds.push(created.prep);
      }

      return {
        order: {
          id: orderRecord.id,
          shopifyOrderId: orderRecord.shopifyOrderId,
          shopifyOrderNumber: orderRecord.shopifyOrderNumber,
          status: orderRecord.status,
          region: orderRecord.region,
        },
        variantOrderIds,
        prepIds,
      };
    });
  }
}
