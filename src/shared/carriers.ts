import { z } from "zod";
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

// Zod schema for runtime validation of carriers.json
const carrierSchema = z.object({
  code: z.string(),
  region: z.string().nullable(),
  name: z.string(),
  minimumBoxesQty: z.number().optional(),
  nearestWarehouses: z
    .array(
      z.object({
        locationId: z.string(),
        locationName: z.string(),
      }),
    )
    .optional(),
  postalCodes: z.array(z.string()).optional(),
});

const carriersDataSchema = z.object({
  carriers: z.array(carrierSchema),
});

// Validate carriers.json structure at module load time
const validated = carriersDataSchema.parse(carriersData);

// Load carriers from JSON config file with runtime validation
export const carriers: ICarrier[] = validated.carriers;
