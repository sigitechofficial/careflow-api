/**
 * List duplicate active ServiceUserMedication rows (same name per service user).
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/probe-duplicate-medications.ts [serviceUserId]
 *   npx ts-node --transpile-only prisma/scripts/probe-duplicate-medications.ts --fix [serviceUserId]
 */
import { PrismaClient } from '@prisma/client';
import { pickCanonicalMedication } from '../../src/medications/medication-name-dedupe.util';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const serviceUserId = args.find(a => !a.startsWith('--'));

async function main() {
  const where = {
    deletedAt: null,
    isActive: true,
    ...(serviceUserId ? { serviceUserId } : {}),
  };

  const allMeds = await prisma.serviceUserMedication.findMany({
    where,
    select: {
      id: true,
      serviceUserId: true,
      medicationName: true,
      createdAt: true,
      _count: { select: { events: true, schedules: true } },
    },
    orderBy: [{ serviceUserId: 'asc' }, { medicationName: 'asc' }, { createdAt: 'asc' }],
  });

  const groups = new Map<string, typeof allMeds>();
  for (const m of allMeds) {
    const key = `${m.serviceUserId}::${m.medicationName.trim().toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  const dupGroups = [...groups.entries()].filter(([, list]) => list.length > 1);

  console.log('=== Duplicate active medications (same name, same service user) ===\n');
  if (dupGroups.length === 0) {
    console.log('None found — each name appears once per service user.');
  } else {
    for (const [, rows] of dupGroups.sort((a, b) => b[1].length - a[1].length)) {
      console.log(rows[0]!.medicationName);
      console.log(`  Service user: ${rows[0]!.serviceUserId}`);
      console.log(`  Copies: ${rows.length}`);
      for (const m of rows) {
        console.log(
          `    - ${m.id}  created=${m.createdAt.toISOString()}  events=${m._count.events}  schedules=${m._count.schedules}`,
        );
      }
      console.log('');
    }
  }

  console.log('--- Summary ---');
  console.log(`Active medication rows: ${allMeds.length}`);
  console.log(`Unique name groups: ${groups.size}`);
  console.log(`Extra duplicate rows: ${allMeds.length - groups.size}`);

  const demoRows = allMeds.filter(m => m.medicationName.includes('(demo)'));
  const demoGroups = new Map<string, typeof demoRows>();
  for (const m of demoRows) {
    const k = `${m.serviceUserId}::${m.medicationName.trim().toLowerCase()}`;
    const list = demoGroups.get(k) ?? [];
    list.push(m);
    demoGroups.set(k, list);
  }
  const demoDupes = [...demoGroups.values()].filter(l => l.length > 1);
  console.log(`\n"(demo)" medications: ${demoRows.length} rows, ${demoGroups.size} unique names`);
  if (demoDupes.length > 0) {
    console.log(`"(demo)" duplicate name groups: ${demoDupes.length}`);
  }

  if (FIX && dupGroups.length > 0) {
    console.log('\n=== --fix: soft-delete duplicate copies (keep oldest/canonical) ===\n');
    const now = new Date();
    let removed = 0;
    for (const [, rows] of dupGroups) {
      const canonical = pickCanonicalMedication(
        rows.map(r => ({
          id: r.id,
          medicationName: r.medicationName,
          createdAt: r.createdAt,
          _count: r._count,
        })),
      );
      const toRemove = rows.filter(r => r.id !== canonical.id);
      for (const row of toRemove) {
        await prisma.serviceUserMedication.update({
          where: { id: row.id },
          data: { deletedAt: now, isActive: false },
        });
        console.log(`Removed duplicate ${row.id} (${row.medicationName})`);
        removed += 1;
      }
    }
    console.log(`\nSoft-deleted ${removed} duplicate row(s).`);
  } else if (FIX) {
    console.log('\n--fix: nothing to remove.');
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
