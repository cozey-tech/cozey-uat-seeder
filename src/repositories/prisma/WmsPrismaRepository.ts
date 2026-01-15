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

  async createOrder(order: CreateOrderRequest): Promise<IOrder> {
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
  }

  async createVariantOrder(variantOrder: CreateVariantOrderRequest): Promise<unknown> {
    return await this.prisma.variantOrder.create({
      data: {
        orderId: variantOrder.orderId,
        lineItemId: variantOrder.lineItemId,
        variantId: variantOrder.variantId,
        quantity: variantOrder.quantity,
        region: variantOrder.region,
      },
    });
  }

  async createPrep(prep: CreatePrepRequest): Promise<unknown> {
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
  }

  async createPnpPackageInfo(packageInfo: CreatePnpPackageInfoRequest): Promise<unknown> {
    return await this.prisma.pnpPackageInfo.create({
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
    return await this.prisma.pnpBox.create({
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
    return await this.prisma.pnpOrderBox.create({
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

  async createPrepPart(prepPart: CreatePrepPartRequest): Promise<unknown> {
    return await this.prisma.prepPart.create({
      data: {
        prepId: prepPart.prepId,
        partId: prepPart.partId,
        quantity: prepPart.quantity,
        region: prepPart.region,
      },
    });
  }

  async createPrepPartItem(prepPartItem: CreatePrepPartItemRequest): Promise<unknown> {
    return await this.prisma.prepPartItem.create({
      data: {
        prepPartId: prepPartItem.prepPartId,
        region: (prepPartItem.region || "CA") as "CA" | "US",
      },
    });
  }

  async findCustomerById(customerId: string): Promise<{ id: string; name: string } | null> {
    const customer = await this.prisma.customer.findUnique({
      where: {
        id: customerId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    return customer;
  }

  async createCustomer(customer: {
    id: string;
    name: string;
    email?: string;
    region: string;
  }): Promise<unknown> {
    return await this.prisma.customer.create({
      data: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        region: customer.region,
      },
    });
  }
}
