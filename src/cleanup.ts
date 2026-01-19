#!/usr/bin/env node

import { parseCleanupArgs } from "./cli/cleanupArgs";
import { executeCleanup } from "./cli/cleanupOrchestration";
import { PrismaClient } from "@prisma/client";
import { WmsPrismaRepository } from "./repositories/prisma/WmsPrismaRepository";
import { ShopifyService } from "./services/ShopifyService";
import { WmsCleanupService } from "./services/WmsCleanupService";
import { CleanupUseCase } from "./business/cleanup/CleanupUseCase";
import { CleanupHandler } from "./business/cleanup/CleanupHandler";
import { InteractivePromptService } from "./services/InteractivePromptService";
import { OutputFormatter } from "./utils/outputFormatter";
import { Logger } from "./utils/logger";

async function main(): Promise<void> {
  try {
    const args = parseCleanupArgs();

    const prisma = new PrismaClient();
    const wmsRepository = new WmsPrismaRepository(prisma);
    const shopifyService = new ShopifyService(args.dryRun);
    const wmsCleanupService = new WmsCleanupService(wmsRepository, args.dryRun);
    const cleanupUseCase = new CleanupUseCase(shopifyService, wmsCleanupService);
    const cleanupHandler = new CleanupHandler(cleanupUseCase);
    const interactivePromptService = new InteractivePromptService();

    const services = {
      cleanupHandler,
      shopifyService,
      interactivePromptService,
    };

    await executeCleanup(args, services);

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    Logger.error("Cleanup failed", error, {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(OutputFormatter.error(`\nCleanup failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

main();
