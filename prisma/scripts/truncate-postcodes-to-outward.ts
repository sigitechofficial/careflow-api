/**
 * Truncate all area postcodes to their outward code (district / first part).
 *
 * UK postcodes: "CR0 1AA" → "CR0", "SW1A 2PW" → "SW1A", "B1 1BB" → "B1"
 * The outward code is everything before the space, or for normalised
 * (no-space) postcodes it is all characters except the last three.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/truncate-postcodes-to-outward.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function extractOutwardCode(postcode: string): string {
  const trimmed = postcode.trim().toUpperCase();
  if (trimmed.includes(' ')) {
    return trimmed.split(' ')[0];
  }
  // No space — outward code is everything except the last 3 chars (inward code)
  if (trimmed.length > 3) {
    return trimmed.slice(0, -3);
  }
  // Already 3 chars or fewer — return as-is
  return trimmed;
}

async function main() {
  const all = await prisma.serviceUserAreaPostcode.findMany({
    select: { id: true, postcode: true, normalizedPostcode: true, serviceUserAreaId: true },
  });

  console.log(`Found ${all.length} postcode rows. Processing...`);

  let updated = 0;
  let skipped = 0;
  let deduped = 0;

  // Group by area so we can de-duplicate within each area
  const byArea = new Map<string, typeof all>();
  for (const row of all) {
    const list = byArea.get(row.serviceUserAreaId) ?? [];
    list.push(row);
    byArea.set(row.serviceUserAreaId, list);
  }

  // Track globally which outward codes are already taken (for the unique constraint)
  const globalOutward = new Map<string, string>(); // normalizedOutward → areaId that owns it

  for (const [areaId, rows] of byArea) {
    const seenOutward = new Set<string>();

    for (const row of rows) {
      const outward = extractOutwardCode(row.postcode);
      const normOutward = outward.replace(/\s+/g, '').toUpperCase();

      // Already the outward code?
      if (row.normalizedPostcode === normOutward) {
        globalOutward.set(normOutward, areaId);
        seenOutward.add(normOutward);
        skipped++;
        continue;
      }

      // Duplicate within same area after truncation?
      if (seenOutward.has(normOutward)) {
        await prisma.serviceUserAreaPostcode.delete({ where: { id: row.id } });
        deduped++;
        console.log(`  Deleted duplicate: "${row.postcode}" → "${outward}" (area already has it)`);
        continue;
      }

      // Taken by another area?
      const owner = globalOutward.get(normOutward);
      if (owner && owner !== areaId) {
        console.log(`  CONFLICT: "${row.postcode}" → "${outward}" already belongs to area ${owner}. Deleting this row.`);
        await prisma.serviceUserAreaPostcode.delete({ where: { id: row.id } });
        deduped++;
        continue;
      }

      // Update to outward code
      await prisma.serviceUserAreaPostcode.update({
        where: { id: row.id },
        data: {
          postcode: outward,
          normalizedPostcode: normOutward,
        },
      });
      globalOutward.set(normOutward, areaId);
      seenOutward.add(normOutward);
      updated++;
      console.log(`  Updated: "${row.postcode}" → "${outward}"`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (already short): ${skipped}, Removed (duplicates): ${deduped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
