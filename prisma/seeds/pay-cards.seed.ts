import { PrismaClient } from '@prisma/client';
import { PAY_CARD_PRESETS, type PayCardPreset } from '../seed-data/pay-card-presets';

async function resolveBranchTargetId(
  prisma: PrismaClient,
  hint?: string,
): Promise<string | null> {
  if (!hint?.trim()) return null;
  const branch = await prisma.location.findFirst({
    where: {
      deletedAt: null,
      name: { contains: hint.trim(), mode: 'insensitive' },
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return branch?.id ?? null;
}

async function upsertPayCard(prisma: PrismaClient, preset: PayCardPreset, branchTargetId?: string | null) {
  const effectiveFrom = new Date(`${preset.effectiveFrom}T00:00:00.000Z`);
  const effectiveTo = preset.effectiveTo
    ? new Date(`${preset.effectiveTo}T00:00:00.000Z`)
    : null;

  let assignmentTargetId: string | null = null;
  if (preset.assignmentLevel === 'BRANCH') {
    assignmentTargetId = branchTargetId ?? null;
  }

  const data = {
    name: preset.name,
    assignmentLevel: preset.assignmentLevel,
    assignmentTargetId,
    assignmentTargetKey: preset.assignmentTargetKey ?? null,
    assignmentLabel: preset.assignmentLabel ?? null,
    currency: 'GBP',
    status: preset.status,
    effectiveFrom,
    effectiveTo,
    notes: preset.notes ?? null,
    deletedAt: null,
  };

  const template = await prisma.payCard.upsert({
    where: { code: preset.code },
    update: data,
    create: {
      code: preset.code,
      ...data,
    },
  });

  await prisma.payCardRule.deleteMany({ where: { payCardId: template.id } });
  if (preset.rules.length) {
    await prisma.payCardRule.createMany({
      data: preset.rules.map((rule, index) => ({
        payCardId: template.id,
        label: rule.label,
        serviceType: rule.serviceType ?? null,
        dayType: rule.dayType,
        startTime: rule.startTime ?? null,
        endTime: rule.endTime ?? null,
        rateType: rule.rateType,
        amount: rule.amount,
        multiplier: rule.multiplier ?? null,
        minimumMinutes: rule.minimumMinutes ?? null,
        priority: rule.priority ?? 0,
        sortOrder: rule.sortOrder ?? index,
      })),
    });
  }

  return template;
}

export type SeedPayCardsResult = {
  upserted: number
  codes: string[]
  branchLinked: string | null
}

export async function seedPayCards(prisma: PrismaClient): Promise<SeedPayCardsResult> {
  const branchHints = [
    ...new Set(
      PAY_CARD_PRESETS.map(p => p.branchNameHint).filter((h): h is string => Boolean(h?.trim())),
    ),
  ];

  const branchIds = new Map<string, string | null>();
  for (const hint of branchHints) {
    branchIds.set(hint, await resolveBranchTargetId(prisma, hint));
  }

  const codes: string[] = [];
  for (const preset of PAY_CARD_PRESETS) {
    const branchTargetId = preset.branchNameHint
      ? branchIds.get(preset.branchNameHint) ?? null
      : null;
    await upsertPayCard(prisma, preset, branchTargetId);
    codes.push(preset.code);
  }

  const londonBranchId = branchIds.get('London') ?? null;
  return {
    upserted: codes.length,
    codes,
    branchLinked: londonBranchId,
  };
}
