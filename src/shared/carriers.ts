import carriersData from "../../config/carriers.json";

// Region constants
export const Region = {
  CA: "CA",
  US: "US",
} as const;

export interface ICarrier {
  code: string;
  region: string | null;
  name: string;
  minimumBoxesQty?: number;
  nearestWarehouses?: { locationId: string; locationName: string }[];
  postalCodes?: string[];
}

// Load carriers from JSON config file
export const carriers: ICarrier[] = carriersData.carriers;
