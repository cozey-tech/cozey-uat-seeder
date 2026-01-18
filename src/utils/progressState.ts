/**
 * Progress state storage utility for resume/retry capability
 *
 * Stores progress state to allow resuming failed operations.
 * Uses file-based storage for simplicity (can be migrated to database later).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

export interface ProgressState {
  batchId: string;
  timestamp: number;
  shopifyOrders: {
    successful: Array<{
      orderIndex: number;
      shopifyOrderId: string;
      shopifyOrderNumber: string;
      customerEmail: string;
    }>;
    failed: Array<{
      orderIndex: number;
      customerEmail: string;
      error: string;
    }>;
  };
  wmsEntities: {
    successful: Array<{
      orderIndex: number;
      orderId: string;
      shopifyOrderId: string;
    }>;
    failed: Array<{
      orderIndex: number;
      shopifyOrderId: string;
      customerEmail?: string;
      error: string;
    }>;
  };
  collectionPrep?: {
    collectionPrepId: string;
    region: string;
  };
}

/**
 * Get the progress state directory path
 */
function getProgressStateDir(): string {
  return join(process.cwd(), ".progress");
}

/**
 * Get the progress state file path for a batch ID
 */
function getProgressStatePath(batchId: string): string {
  return join(getProgressStateDir(), `${batchId}.json`);
}

/**
 * Save progress state to file
 */
export function saveProgressState(state: ProgressState): void {
  const stateDir = getProgressStateDir();
  
  // Ensure directory exists
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  
  const filePath = getProgressStatePath(state.batchId);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Load progress state from file
 */
export function loadProgressState(batchId: string): ProgressState | null {
  const filePath = getProgressStatePath(batchId);
  
  if (!existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as ProgressState;
  } catch (error) {
    throw new Error(
      `Failed to load progress state for batch ${batchId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Delete progress state file (cleanup after successful completion)
 */
export function deleteProgressState(batchId: string): void {
  const filePath = getProgressStatePath(batchId);
  
  if (existsSync(filePath)) {
    const { unlinkSync } = require("fs");
    try {
      unlinkSync(filePath);
    } catch (error) {
      // Ignore errors when deleting (file might not exist or be locked)
      console.warn(`Warning: Could not delete progress state file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * List all available progress states
 */
export function listProgressStates(): Array<{ batchId: string; timestamp: number }> {
  const stateDir = getProgressStateDir();
  
  if (!existsSync(stateDir)) {
    return [];
  }
  
  const { readdirSync } = require("fs");
  const files = readdirSync(stateDir).filter((f: string) => f.endsWith(".json"));
  
  return files
    .map((file: string) => {
      const batchId = file.replace(".json", "");
      const filePath = join(stateDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const state = JSON.parse(content) as ProgressState;
        return {
          batchId,
          timestamp: state.timestamp,
        };
      } catch {
        return null;
      }
    })
    .filter((item: { batchId: string; timestamp: number } | null): item is { batchId: string; timestamp: number } => item !== null)
    .sort((a: { timestamp: number }, b: { timestamp: number }) => b.timestamp - a.timestamp);
}
