import { PrismaClient } from '@prisma/client';
import {
  CHARGE_CARD_PRESETS,
  type ChargeCardPreset,
} from '../seed-data/charge-card-presets';

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
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  return branch?.id ?? null;
}

async function resolveFunderTargetId(
  prisma: PrismaClient,
  preset: ChargeCardPreset,
): Promise<string | null> {
  if (preset.funderCodeHint?.trim()) {
    const byCode = await prisma.funder.findFirst({
      where: {
        deletedAt: null,
        code: preset.funderCodeHint.trim(),
      },
      select: { id: true },
    });
    if (byCode) return byCode.id;
  }

  if (preset.funderNameHint?.trim()) {
    const byName = await prisma.funder.findFirst({
      where: {
        deletedAt: null,
        name: { contains: preset.funderNameHint.trim(), mode: 'insensitive' },
      },
      select: { id: true },
      orderBy: { name: 'asc' },
    });
    if (byName) return byName.id;
  }

  return null;
}

async function upsertChargeCard(
  prisma: PrismaClient,
  preset: ChargeCardPreset,
  targets: { branchTargetId?: string | null; funderTargetId?: string | null },
) {
  const effectiveFrom = new Date(`${preset.effectiveFrom}T00:00:00.000Z`);
  const effectiveTo = preset.effectiveTo
    ? new Date(`${preset.effectiveTo}T00:00:00.000Z`)
    : null;

  let assignmentTargetId: string | null = null;
  let assignmentTargetKey: string | null = preset.assignmentTargetKey ?? null;

  if (preset.assignmentLevel === 'FUNDER') {
    assignmentTargetId = targets.funderTargetId ?? null;
  } else if (preset.assignmentLevel === 'BRANCH_REGION') {
    assignmentTargetId = targets.branchTargetId ?? null;
  } else if (
    preset.assignmentLevel === 'ORGANISATION_DEFAULT'
  ) {
    assignmentTargetId = null;
    assignmentTargetKey = null;
  }

  const data = {
    name: preset.name,
    assignmentLevel: preset.assignmentLevel,
    assignmentTargetId,
    assignmentTargetKey,
    assignmentLabel: preset.assignmentLabel ?? null,
    currency: 'GBP',
    billingFrequency: preset.billingFrequency,
    paymentTerms: preset.paymentTerms ?? null,
    taxTreatment: preset.taxTreatment ?? null,
    defaultChargeMethod: preset.defaultChargeMethod,
    status: preset.status,
    effectiveFrom,
    effectiveTo,
    notes: preset.notes ?? null,
    deletedAt: null,
  };

  const template = await prisma.chargeCard.upsert({
    where: { code: preset.code },
    update: data,
    create: {
      code: preset.code,
      ...data,
    },
  });

  await prisma.chargeCardRule.deleteMany({ where: { chargeCardId: template.id } });
  if (preset.rules.length) {
    await prisma.chargeCardRule.createMany({
      data: preset.rules.map((rule, index) => ({
        chargeCardId: template.id,
        label: rule.label,
        serviceType: rule.serviceType ?? null,
        dayType: rule.dayType,
        chargeMethod: rule.chargeMethod,
        rateType: rule.rateType,
        amount: rule.amount,
        minimumMinutes: rule.minimumMinutes ?? null,
        chargeableFlag: true,
        sortOrder: rule.sortOrder ?? index,
      })),
    });
  }

  return template;
}

export type SeedChargeCardsResult = {
  upserted: number
  codes: string[]
  funderLinked: string[]
  branchLinked: string | null
}

export async function seedChargeCards(prisma: PrismaClient): Promise<SeedChargeCardsResult> {
  const branchHints = [
    ...new Set(
      CHARGE_CARD_PRESETS.map(p => p.branchNameHint).filter((h): h is string => Boolean(h?.trim())),
    ),
  ];

  const branchIds = new Map<string, string | null>();
  for (const hint of branchHints) {
    branchIds.set(hint, await resolveBranchTargetId(prisma, hint));
  }

  const funderLinked: string[] = [];
  const codes: string[] = [];

  for (const preset of CHARGE_CARD_PRESETS) {
    const branchTargetId = preset.branchNameHint
      ? branchIds.get(preset.branchNameHint) ?? null
      : null;
    const funderTargetId =
      preset.assignmentLevel === 'FUNDER'
        ? await resolveFunderTargetId(prisma, preset)
        : null;

    if (preset.assignmentLevel === 'FUNDER' && funderTargetId) {
      funderLinked.push(preset.code);
    }

    await upsertChargeCard(prisma, preset, { branchTargetId, funderTargetId });
    codes.push(preset.code);
  }

  return {
    upserted: codes.length,
    codes,
    funderLinked,
    branchLinked: branchIds.get('London') ?? null,
  };
}
