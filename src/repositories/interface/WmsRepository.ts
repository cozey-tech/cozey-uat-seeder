
export type CreateOrderRequest = {
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  status: string;
  region: string;
  customerId?: string;
  locationId?: string;
  sourceName?: string;
};

export type CreateVariantOrderRequest = {
  orderId: string;
  lineItemId: string;
  variantId: string;
  quantity: number;
  region: string;
};

export type CreatePrepRequest = {
  orderId: string;
  prep: string;
  collectionPrepId?: string;
  region: string;
  variantId: string;
  lineItemId: string;
};

export type CreateCollectionPrepRequest = {
  id: string;
  region: string;
  carrier: string;
  locationId: string;
  prepDate: Date;
  boxes: number;
};

export type CreateShipmentRequest = {
  collectionPrepId: string;
  orderId: string;
  region: string;
  status: "ACTIVE" | "CANCELLED";
};

export type CreatePnpPackageInfoRequest = {
  identifier: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  lengthUnit?: "IN" | "CM";
  widthUnit?: "IN" | "CM";
  heightUnit?: "IN" | "CM";
  weightUnit?: "LB" | "KG";
};

export type CreatePnpBoxRequest = {
  identifier: string;
  length: number;
  width: number;
  height: number;
  region: "CA" | "US";
  lengthUnit?: "IN" | "CM";
  widthUnit?: "IN" | "CM";
  heightUnit?: "IN" | "CM";
};

export type CreatePnpOrderBoxRequest = {
  collectionPrepId: string;
  orderId: string;
  lpn: string;
  status: "OPEN" | "CLOSED";
  pnpBoxId: string;
  region: string;
};

export interface IOrder {
  id: string;
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  status: string;
  region: string;
}

export interface ICollectionPrep {
  id: string;
  region: string;
  carrier: string;
  locationId: string;
  prepDate: Date;
  boxes: number;
}

export interface IShipment {
  id: string;
  collectionPrepId: string;
  orderId: string;
  status: string;
}

export interface WmsRepository {
  createOrder(order: CreateOrderRequest): Promise<IOrder>;
  createVariantOrder(variantOrder: CreateVariantOrderRequest): Promise<unknown>;
  createPrep(prep: CreatePrepRequest): Promise<unknown>;
  createCollectionPrep(collectionPrep: CreateCollectionPrepRequest): Promise<ICollectionPrep>;
  createShipment(shipment: CreateShipmentRequest): Promise<IShipment>;
  createPnpPackageInfo(packageInfo: CreatePnpPackageInfoRequest): Promise<unknown>;
  createPnpBox(box: CreatePnpBoxRequest): Promise<unknown>;
  createPnpOrderBox(orderBox: CreatePnpOrderBoxRequest): Promise<unknown>;
  findPartBySku(sku: string, region: string): Promise<{ id: string; sku: string } | null>;
  findCustomerById(customerId: string): Promise<{ id: string; name: string } | null>;
  createCustomer(customer: { id: string; name: string; email?: string; region: string }): Promise<unknown>;
}
