import { seedConfigSchema, type SeedConfig } from "../shared/validation/seedConfigSchema";
import { readJsonFile } from "../utils/fileReader";

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
    Object.setPrototypeOf(this, InputValidationError.prototype);
  }
}

export class InputParserService {
  parseInputFile(filePath: string): SeedConfig {
    let rawData: unknown;

    // Determine file type by extension
    if (filePath.endsWith(".json")) {
      rawData = readJsonFile(filePath);
    } else if (filePath.endsWith(".csv")) {
      // For CSV, we'd need to convert to JSON structure
      // For now, CSV support is limited - would need custom conversion logic
      throw new InputValidationError("CSV input format not yet implemented. Please use JSON format.");
    } else {
      // Try JSON first, fall back to error
      try {
        rawData = readJsonFile(filePath);
      } catch {
        throw new InputValidationError(`Unsupported file format. Expected .json or .csv file. Got: ${filePath}`);
      }
    }

    // Validate with Zod schema
    const result = seedConfigSchema.safeParse(rawData);

    if (!result.success) {
      const errors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new InputValidationError(`Input file validation failed:\n${errors}`);
    }

    return result.data;
  }
}
