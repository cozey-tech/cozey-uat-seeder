import { Prisma, PrismaClient } from "@prisma/client";
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
  IPrep,
  IDeletionPreview,
} from "../interface/WmsRepository";
import { WmsRepositoryError } from "../errors/WmsRepositoryError";
import { Logger } from "../../utils/logger";

export class WmsPrismaRepository implements WmsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Handle Prisma errors and convert them to typed WmsRepositoryError
   * @param error - The Prisma error
   * @param context - Context message for the error (e.g., "Order with shopifyOrderId X")
   * @throws WmsRepositoryError with appropriate type and metadata
   */
  private handlePrismaError(error: unknown, context: string): never {
    throw WmsRepositoryError.fromPrismaError(error, context);
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

  async findOrdersByShopifyIds(shopifyOrderIds: string[]): Promise<IOrder[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        shopifyOrderId: { in: shopifyOrderIds },
      },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderNumber: true,
        status: true,
        region: true,
      },
    });

    return orders;
  }

  async findOrdersBySourceName(sourceName: string, region?: string): Promise<IOrder[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        sourceName,
        ...(region && { region }),
      },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderNumber: true,
        status: true,
        region: true,
      },
    });

    return orders;
  }

  async findPrepsByOrderIds(orderIds: string[], region: string): Promise<IPrep[]> {
    const preps = await this.prisma.prep.findMany({
      where: {
        orderId: { in: orderIds },
        region,
      },
      select: {
        prep: true,
        region: true,
        orderId: true,
        collectionPrepId: true,
      },
    });

    return preps;
  }

  async findShipmentsByOrderIds(orderIds: string[]): Promise<IShipment[]> {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        orderId: { in: orderIds },
      },
      select: {
        id: true,
        collectionPrepId: true,
        orderId: true,
        status: true,
      },
    });

    return shipments;
  }

  async findCollectionPrepById(id: string, region: string): Promise<ICollectionPrep | null> {
    const collectionPrep = await this.prisma.collectionPrep.findUnique({
      where: {
        id_region: { id, region },
      },
      select: {
        id: true,
        region: true,
        carrier: true,
        locationId: true,
        prepDate: true,
        boxes: true,
      },
    });

    return collectionPrep;
  }

  async findCollectionPrepsByIds(ids: string[], region: string): Promise<ICollectionPrep[]> {
    const collectionPreps = await this.prisma.collectionPrep.findMany({
      where: {
        id: { in: ids },
        region,
      },
      select: {
        id: true,
        region: true,
        carrier: true,
        locationId: true,
        prepDate: true,
        boxes: true,
      },
    });

    return collectionPreps;
  }

  async previewBatchDeletion(shopifyOrderIds: string[]): Promise<Map<string, IDeletionPreview>> {
    const orders = await this.prisma.order.findMany({
      where: {
        shopifyOrderId: { in: shopifyOrderIds },
      },
      include: {
        preps: {
          include: {
            prepPart: {
              include: {
                prepPartItem: {
                  select: {
                    id: true,
                    pnpOrderBoxId: true,
                  },
                },
              },
            },
          },
        },
        variantOrder: { select: { lineItemId: true } },
        shipments: { select: { id: true } },
      },
    });

    return new Map(
      orders.map((order) => [
        order.shopifyOrderId,
        {
          preps: order.preps.length,
          prepParts: order.preps.reduce((sum, p) => sum + p.prepPart.length, 0),
          prepPartItems: order.preps.reduce(
            (sum, p) => sum + p.prepPart.reduce((s2, pp) => s2 + pp.prepPartItem.length, 0),
            0,
          ),
          pnpOrderBoxes: order.preps.reduce(
            (sum, p) =>
              sum +
              p.prepPart.reduce((s2, pp) => s2 + pp.prepPartItem.filter((ppi) => ppi.pnpOrderBoxId !== null).length, 0),
            0,
          ),
          variantOrders: order.variantOrder.length,
          shipments: order.shipments.length,
        },
      ]),
    );
  }

  private async executeWithRetry<T>(operation: () => Promise<T>, context: string, maxRetries: number = 3): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        const isRetryable =
          prismaError.code === "P2034" || // Transaction conflict
          prismaError.code === "P2024" || // Connection timeout
          prismaError.code === "P1001"; // Connection refused

        if (isRetryable && attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000;
          Logger.warn("Retrying transient error", {
            context,
            attempt: attempt + 1,
            maxRetries,
            delayMs,
            errorCode: prismaError.code,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unreachable");
  }

  async deleteOrderEntitiesTransaction(shopifyOrderId: string): Promise<{
    deletedPnpOrderBoxes: number;
    deletedPrepPartItems: number;
    deletedPrepParts: number;
    deletedPreps: number;
    deletedShipments: number;
    deletedVariantOrders: number;
    deletedOrder: boolean;
  }> {
    return this.executeWithRetry(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const order = await tx.order.findUnique({ where: { shopifyOrderId } });
            if (!order) {
              return {
                deletedPnpOrderBoxes: 0,
                deletedPrepPartItems: 0,
                deletedPrepParts: 0,
                deletedPreps: 0,
                deletedShipments: 0,
                deletedVariantOrders: 0,
                deletedOrder: false,
              };
            }

            const preps = await tx.prep.findMany({
              where: { orderId: shopifyOrderId },
              select: { prep: true, region: true },
            });
            const prepIds = preps.map((p) => p.prep);

            const prepParts = await tx.prepPart.findMany({
              where: {
                prepId: { in: prepIds },
                region: order.region,
              },
              select: { id: true },
            });
            const prepPartIds = prepParts.map((pp) => pp.id);

            const pnpOrderBoxIds = await tx.prepPartItem
              .findMany({
                where: { prepPartId: { in: prepPartIds } },
                select: { pnpOrderBoxId: true },
              })
              .then((items) => items.map((i) => i.pnpOrderBoxId).filter((id): id is string => id !== null));

            const deletedPnpOrderBoxes = await tx.pnpOrderBox.deleteMany({
              where: { id: { in: pnpOrderBoxIds } },
            });

            const deletedPrepPartItems = await tx.prepPartItem.deleteMany({
              where: { prepPartId: { in: prepPartIds } },
            });

            const deletedPrepParts = await tx.prepPart.deleteMany({
              where: { prepId: { in: prepIds }, region: order.region },
            });

            const deletedPreps = await tx.prep.deleteMany({
              where: {
                OR: preps.map((p) => ({
                  prep: p.prep,
                  region: p.region,
                })),
              },
            });

            const deletedShipments = await tx.shipment.deleteMany({
              where: { orderId: shopifyOrderId },
            });

            const deletedVariantOrders = await tx.variantOrder.deleteMany({
              where: { orderId: shopifyOrderId },
            });

            await tx.order.delete({ where: { shopifyOrderId } });

            return {
              deletedPnpOrderBoxes: deletedPnpOrderBoxes.count,
              deletedPrepPartItems: deletedPrepPartItems.count,
              deletedPrepParts: deletedPrepParts.count,
              deletedPreps: deletedPreps.count,
              deletedShipments: deletedShipments.count,
              deletedVariantOrders: deletedVariantOrders.count,
              deletedOrder: true,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 30000,
          },
        ),
      `deleteOrderEntities:${shopifyOrderId}`,
    );
  }

  async deleteCollectionPrep(id: string, region: string): Promise<boolean> {
    const referencingPreps = await this.prisma.prep.count({
      where: { collectionPrepId: id, region },
    });

    if (referencingPreps > 0) {
      Logger.warn("Collection prep still referenced, skipping deletion", {
        collectionPrepId: id,
        region,
        referencingPreps,
      });
      return false;
    }

    await this.prisma.collectionPrep.delete({
      where: { id_region: { id, region } },
    });

    Logger.info("Collection prep deleted", { collectionPrepId: id, region });
    return true;
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
