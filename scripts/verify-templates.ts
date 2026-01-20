/**
 * Verify that order templates contain valid WMS SKUs
 */

import { config } from "dotenv";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import path from "path";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

async function verifyTemplates(): Promise<void> {
  const prisma = new PrismaClient();
  const templatesPath = path.join(process.cwd(), "config", "orderTemplates.json");

  try {
    const fileContent = await fs.readFile(templatesPath, "utf-8");
    const data = JSON.parse(fileContent);

    console.log(`\n=== Verifying ${data.templates.length} Templates ===\n`);

    const region = "CA"; // Test with CA region
    let validCount = 0;
    let invalidCount = 0;

    for (const template of data.templates) {
      // Skip the basic templates (they're known to work)
      if (!template.id.startsWith("order-")) {
        continue;
      }

      console.log(`\nTemplate: ${template.name} (${template.id})`);
      console.log(`  Line items: ${template.lineItems.length}`);

      const skus = template.lineItems.map((item: { sku: string; quantity: number }) => item.sku);
      const variants = await prisma.variant.findMany({
        where: {
          sku: { in: skus },
          region,
          disabled: false,
        },
        select: {
          sku: true,
          id: true,
        },
      });

      const foundSkus = new Set(variants.map((v) => v.sku));
      const missingSkus = skus.filter((sku: string) => !foundSkus.has(sku));

      if (missingSkus.length === 0) {
        console.log(`  ✓ All SKUs valid`);
        validCount++;
      } else {
        console.log(`  ✗ Missing SKUs: ${missingSkus.join(", ")}`);
        invalidCount++;

        // Debug each missing SKU
        for (const missingSku of missingSkus) {
          const checkDisabled = await prisma.variant.findFirst({
            where: { sku: missingSku, region },
            select: { sku: true, disabled: true },
          });

          if (checkDisabled) {
            console.log(`    - ${missingSku}: Exists but disabled=${checkDisabled.disabled}`);
          } else {
            console.log(`    - ${missingSku}: Not found at all`);
          }
        }
      }
    }

    console.log(`\n\n=== Summary ===`);
    console.log(`Valid templates: ${validCount}`);
    console.log(`Invalid templates: ${invalidCount}`);

    if (invalidCount > 0) {
      console.log(`\n⚠️  Some templates have invalid SKUs. Please check the details above.`);
      process.exit(1);
    } else {
      console.log(`\n✓ All templates are valid!`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

verifyTemplates().catch(console.error);
