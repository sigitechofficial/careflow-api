/**
 * One-off: archive the SAMPLE pay / charge rate cards (PAY-*-2026, CHG-*-2026 from
 * prisma/seed-data/*-card-presets.ts) that earlier seed runs created with made-up demo rates.
 *
 * Reversible: only sets status = ARCHIVED and appends a note — rows, rules and links are kept.
 * To undo for one card, set its status back to ACTIVE.
 *
 * Reports (does not change) anything still pointing at a sample card: employee default pay
 * cards, funder / service user / funding default charge cards, employee funder assignments.
 *
 * Usage (DATABASE_URL must point at the target database):
 *   npx ts-node --transpile-only prisma/scripts/archive-sample-billing-cards.ts            # dry run (default)
 *   npx ts-node --transpile-only prisma/scripts/archive-sample-billing-cards.ts --apply    # make the change
 */
import { BillingCardStatus, PrismaClient } from '@prisma/client';
import { PAY_CARD_PRESETS } from '../seed-data/pay-card-presets';
import { CHARGE_CARD_PRESETS } from '../seed-data/charge-card-presets';

const ARCHIVE_NOTE = 'Archived: sample rate card from demo seed data (not a real Allfor Care rate).';

export const SAMPLE_PAY_CARD_CODES = [...new Set(PAY_CARD_PRESETS.map((p) => p.code))];
export const SAMPLE_CHARGE_CARD_CODES = [...new Set(CHARGE_CARD_PRESETS.map((p) => p.code))];

const appendNote = (notes: string | null) =>
  notes?.includes(ARCHIVE_NOTE) ? notes : [notes, ARCHIVE_NOTE].filter(Boolean).join('\n');

export async function archiveSampleBillingCards(prisma: PrismaClient, apply: boolean) {
  const payCards = await prisma.payCard.findMany({
    where: { code: { in: SAMPLE_PAY_CARD_CODES }, deletedAt: null },
    select: {
      id: true,
      code: true,
      version: true,
      status: true,
      notes: true,
      _count: { select: { defaultEmployments: true, employeeFunderAssignments: true } },
    },
    orderBy: { code: 'asc' },
  });
  const chargeCards = await prisma.chargeCard.findMany({
    where: { code: { in: SAMPLE_CHARGE_CARD_CODES }, deletedAt: null },
    select: {
      id: true,
      code: true,
      status: true,
      notes: true,
      _count: {
        select: { defaultFunders: true, defaultServiceUsers: true, defaultFundings: true },
      },
    },
    orderBy: { code: 'asc' },
  });

  const toArchive = {
    pay: payCards.filter((c) => c.status !== BillingCardStatus.ARCHIVED),
    charge: chargeCards.filter((c) => c.status !== BillingCardStatus.ARCHIVED),
  };

  console.log(`Sample pay cards found: ${payCards.length} (to archive: ${toArchive.pay.length})`);
  for (const c of payCards) {
    const refs = c._count.defaultEmployments + c._count.employeeFunderAssignments;
    console.log(`  PAY ${c.code} v${c.version} ${c.status}${refs ? ` — still referenced by ${refs} row(s)` : ''}`);
  }
  console.log(`Sample charge cards found: ${chargeCards.length} (to archive: ${toArchive.charge.length})`);
  for (const c of chargeCards) {
    const refs = c._count.defaultFunders + c._count.defaultServiceUsers + c._count.defaultFundings;
    console.log(`  CHG ${c.code} ${c.status}${refs ? ` — still referenced by ${refs} row(s)` : ''}`);
  }

  if (!apply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to archive.');
    return { archivedPay: 0, archivedCharge: 0 };
  }

  await prisma.$transaction(async (tx) => {
    for (const c of toArchive.pay) {
      await tx.payCard.update({
        where: { id: c.id },
        data: { status: BillingCardStatus.ARCHIVED, notes: appendNote(c.notes) },
      });
    }
    for (const c of toArchive.charge) {
      await tx.chargeCard.update({
        where: { id: c.id },
        data: { status: BillingCardStatus.ARCHIVED, notes: appendNote(c.notes) },
      });
    }
  });
  console.log(`\nArchived ${toArchive.pay.length} pay card(s) and ${toArchive.charge.length} charge card(s).`);
  return { archivedPay: toArchive.pay.length, archivedCharge: toArchive.charge.length };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  archiveSampleBillingCards(prisma, process.argv.includes('--apply'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
