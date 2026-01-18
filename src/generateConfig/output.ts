/**
 * Output and save functions for config generator
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { SeedConfig } from "../shared/types/SeedConfig";
import { InteractivePromptService } from "../services/InteractivePromptService";
import { OutputFormatter } from "../utils/outputFormatter";

/**
 * Save or preview generated config
 */
export async function saveOrPreviewConfig(config: SeedConfig, defaultPath: string, isDryRun: boolean): Promise<void> {
  if (isDryRun) {
    console.log();
    console.log(OutputFormatter.header("Generated Config (Preview)", "📄"));
    console.log(OutputFormatter.separator());
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  const promptService = new InteractivePromptService();
  const outputPath = defaultPath;

  // Show preview option
  const showPreview = await promptService.promptConfirm("Preview config summary before saving?", false);

  if (showPreview) {
    const previewItems: Array<{ label: string; value: string | number }> = [
      { label: "Orders", value: config.orders.length },
    ];

    if (config.collectionPreps && config.collectionPreps.length > 0) {
      previewItems.push({ label: "Collection Preps", value: config.collectionPreps.length });
    } else if (config.collectionPrep) {
      previewItems.push({
        label: "Collection Prep",
        value: `${config.collectionPrep.carrier} at ${config.collectionPrep.locationId}`,
      });
    }

    console.log();
    console.log(
      OutputFormatter.summary({
        title: OutputFormatter.header("Config Preview", "📄"),
        items: previewItems,
      }),
    );
    console.log();
  }

  // Check if file exists and warn
  if (existsSync(outputPath)) {
    const shouldOverwrite = await promptService.promptConfirm(`File exists: ${outputPath}\nOverwrite?`, false);

    if (!shouldOverwrite) {
      console.log(OutputFormatter.info("Save cancelled."));
      process.exit(0);
    }
  }

  // Final confirmation
  const shouldSave = await promptService.promptConfirm(`Save config to ${outputPath}?`, true);

  if (!shouldSave) {
    console.log(OutputFormatter.info("Save cancelled."));
    process.exit(0);
  }

  // Ensure output directory exists
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(config, null, 2), "utf-8");
  console.log();
  console.log(OutputFormatter.success(`Configuration saved to: ${outputPath}`));
}

/**
 * Display performance summary
 */
export function displayPerformanceSummary(performanceMetrics: {
  totalTime: number;
  referenceDataLoadTime: number;
  orderCreationTime: number;
  collectionPrepTime: number;
  collectionPrepCount: number;
  parallelOperations: number;
  validationTime: number;
  orderCount: number;
}): void {
  const perfItems: Array<{ label: string; value: string | number }> = [
    { label: "Total Time", value: OutputFormatter.duration(performanceMetrics.totalTime) },
    { label: "Reference Data Load", value: OutputFormatter.duration(performanceMetrics.referenceDataLoadTime) },
    {
      label: "Order Creation",
      value: `${OutputFormatter.duration(performanceMetrics.orderCreationTime)} (${performanceMetrics.orderCount} orders)`,
    },
  ];

  if (performanceMetrics.collectionPrepCount > 0) {
    perfItems.push({
      label: "Collection Prep Generation",
      value: `${OutputFormatter.duration(performanceMetrics.collectionPrepTime)} (${performanceMetrics.collectionPrepCount} preps)`,
    });
    if (performanceMetrics.parallelOperations > 0) {
      perfItems.push({
        label: "Parallel Operations",
        value: `${performanceMetrics.parallelOperations} collection preps generated in parallel`,
      });
    }
  }

  perfItems.push({
    label: "Validation",
    value: OutputFormatter.duration(performanceMetrics.validationTime),
  });

  console.log();
  console.log(
    OutputFormatter.summary({
      title: OutputFormatter.header("Performance Summary", "📊"),
      items: perfItems,
    }),
  );
  console.log();
}
