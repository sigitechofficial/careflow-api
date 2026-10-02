/**
 * Read-only report: service users whose legacy DOM Care door code disagrees with the Home & access
 * key-safe code (the master carers see). Nothing is changed and no codes are printed — the office
 * confirms the right code in DOM Care → Home & access.
 *
 *   npm run report:key-safe-reconciliation
 */
import { PrismaClient } from '@prisma/client';

function normalise(code: string | null | undefined): string {
  return (code ?? '').replace(/\s+/g, '').toLowerCase();
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.serviceUserDomCare.findMany({
      where: { doorCode: { not: null } },
      select: {
        serviceUserId: true,
        doorCode: true,
        serviceUser: {
          select: {
            firstName: true,
            lastName: true,
            deletedAt: true,
            address: { select: { keySafeNumber: true, deletedAt: true } },
          },
        },
      },
    });
    const findings: string[] = [];
    for (const r of rows) {
      if (r.serviceUser.deletedAt) continue;
      const legacy = normalise(r.doorCode);
      if (!legacy) continue;
      const addr = r.serviceUser.address;
      const master = addr && !addr.deletedAt ? normalise(addr.keySafeNumber) : '';
      if (legacy === master) continue;
      const name = `${r.serviceUser.firstName ?? ''} ${r.serviceUser.lastName ?? ''}`.trim();
      findings.push(
        `${r.serviceUserId}  ${name || '(no name)'}  — ${
          master ? 'legacy door code DIFFERS from Home & access key safe' : 'Home & access key safe is EMPTY (legacy door code only)'
        }`,
      );
    }
    console.log(`Key-safe reconciliation: ${findings.length} service user(s) need office confirmation.`);
    for (const line of findings) console.log(`  ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
