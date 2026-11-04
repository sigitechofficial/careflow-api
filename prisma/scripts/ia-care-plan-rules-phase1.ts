/**
 * Phase 1 IA → care plan rule configuration update (2026-11).
 *
 *   npx ts-node --transpile-only prisma/scripts/ia-care-plan-rules-phase1.ts                 # dry run (default)
 *   npx ts-node --transpile-only prisma/scripts/ia-care-plan-rules-phase1.ts --apply --backup-dir <dir>
 *
 * Only additive, verified changes:
 *  1. Deactivates (never deletes) a rule only when its target form is the soft-deleted "Testing Form".
 *  2. Adds the carer medication support levels to the Medication rule (only levels that exist as
 *     options on the live template's medicationSupportLevel question). Existing conditions are kept.
 *  3. Creates starter rules for Washing and dressing, Personal Safety, Pain Management, Dementia Care
 *     plan and Eating and Drinking — only when that form has never had a rule (deleted rules count)
 *     and every condition resolves on the live template.
 * Every other rule is left exactly as the administrator configured it. A JSON backup of all rules
 * is written before anything changes.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CarePathwayFormType, Prisma, PrismaClient } from '@prisma/client';
import { IA_CARE_PLAN_STARTER_RULES } from '../seeds/initial-assessment-care-plan-rules.seed';
import { validateRuleConditionsAgainstTemplate } from '../../src/initial-assessments/initial-assessment-care-plan-rules.validation';
import { ruleConditionsFromJson } from '../../src/initial-assessments/initial-assessment-care-plan-rules.util';
import type { CarePlanRuleCondition } from '../../src/initial-assessments/initial-assessment-care-plan-rules.types';

const NEW_RULE_FORMS = [
  'Washing and dressing',
  'Personal Safety',
  'Pain Management',
  'Dementia Care plan',
  'Eating and Drinking',
];
const CARER_MEDICATION_LEVELS = [
  'level_1a',
  'level_1b',
  'level_2a',
  'level_2b',
];
const KNOWN_DELETED_TEST_FORM = 'Testing Form';

type Change =
  | { kind: 'deactivate'; ruleId: string; reason: string }
  | {
      kind: 'add-conditions';
      ruleId: string;
      formName: string;
      add: CarePlanRuleCondition[];
    }
  | {
      kind: 'create';
      formId: string;
      formName: string;
      starter: (typeof IA_CARE_PLAN_STARTER_RULES)[number];
    };

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function optionValues(options: Prisma.JsonValue): string[] {
  const list = Array.isArray(options)
    ? options
    : options &&
        typeof options === 'object' &&
        Array.isArray((options as { options?: unknown }).options)
      ? (options as { options: unknown[] }).options
      : [];
  return list
    .map((o) =>
      o && typeof o === 'object' && !Array.isArray(o)
        ? (o as { value?: unknown }).value
        : o,
    )
    .filter((v): v is string => typeof v === 'string');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const rules =
      await prisma.initialAssessmentCarePlanRecommendationRule.findMany({
        orderBy: { createdAt: 'asc' },
      });
    const ruleForms = await prisma.carePathwayForm.findMany({
      where: { id: { in: rules.map((r) => r.carePathwayFormId) } },
      select: {
        id: true,
        name: true,
        deletedAt: true,
        isActive: true,
        status: true,
        formType: true,
      },
    });
    const formById = new Map(ruleForms.map((f) => [f.id, f]));
    const template = await prisma.initialAssessmentTemplate.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    if (!template) throw new Error('No default initial assessment template');
    const questions = await prisma.initialAssessmentQuestion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        section: { templateId: template.id, deletedAt: null },
      },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        options: true,
        metadata: true,
        carePlanTrigger: true,
        section: {
          select: { sectionNumber: true, title: true, carePlanArea: true },
        },
      },
    });

    const changes: Change[] = [];
    const notes: string[] = [];

    // 1. Rules targeting the soft-deleted "Testing Form".
    for (const rule of rules.filter((r) => !r.deletedAt && r.isActive)) {
      const form = formById.get(rule.carePathwayFormId);
      if (form && form.deletedAt && form.name === KNOWN_DELETED_TEST_FORM) {
        changes.push({
          kind: 'deactivate',
          ruleId: rule.id,
          reason: `Target form "${form.name}" (${form.id}) was soft-deleted on ${form.deletedAt.toISOString()}; the rule produced a generic "Care plan" recommendation that cannot be created.`,
        });
      } else if (
        !form ||
        form.deletedAt ||
        !form.isActive ||
        form.formType !== CarePathwayFormType.CARE_PLAN
      ) {
        notes.push(
          `Rule ${rule.id} targets an unavailable form (${form?.name ?? 'missing'}) — left unchanged; the engine skips it. Review in diagnostics.`,
        );
      }
    }

    // 2. Medication support levels.
    const medForm = await prisma.carePathwayForm.findFirst({
      where: {
        name: 'Medication',
        formType: CarePathwayFormType.CARE_PLAN,
        deletedAt: null,
        isActive: true,
      },
    });
    const levelQuestion = questions.find(
      (q) =>
        q.metadata &&
        typeof q.metadata === 'object' &&
        (q.metadata as Record<string, unknown>).fieldKey ===
          'medicationSupportLevel',
    );
    const liveLevels = new Set(
      levelQuestion ? optionValues(levelQuestion.options) : [],
    );
    const medRule = medForm
      ? rules.find((r) => r.carePathwayFormId === medForm.id && !r.deletedAt)
      : undefined;
    if (!medForm || !medRule || !levelQuestion) {
      notes.push(
        'Medication: form, rule or medicationSupportLevel question missing — no change.',
      );
    } else {
      const existing = ruleConditionsFromJson(medRule.conditions);
      const add = CARER_MEDICATION_LEVELS.filter((level) =>
        liveLevels.has(level),
      )
        .filter(
          (level) =>
            !existing.some(
              (c) =>
                c.fieldKey === 'medicationSupportLevel' &&
                c.when === 'select_equals' &&
                c.value === level,
            ),
        )
        .map((value) => ({
          fieldKey: 'medicationSupportLevel',
          when: 'select_equals' as const,
          value,
        }));
      const missingOnTemplate = CARER_MEDICATION_LEVELS.filter(
        (level) => !liveLevels.has(level),
      );
      if (missingOnTemplate.length)
        notes.push(
          `Medication: levels not on the live template (skipped): ${missingOnTemplate.join(', ')}`,
        );
      if (add.length)
        changes.push({
          kind: 'add-conditions',
          ruleId: medRule.id,
          formName: 'Medication',
          add,
        });
    }

    // 3. New starter rules for validated forms.
    for (const formName of NEW_RULE_FORMS) {
      const starter = IA_CARE_PLAN_STARTER_RULES.find(
        (s) => s.formName === formName,
      );
      const form = await prisma.carePathwayForm.findFirst({
        where: {
          name: formName,
          formType: CarePathwayFormType.CARE_PLAN,
          deletedAt: null,
          isActive: true,
        },
      });
      if (!starter || !form) {
        notes.push(
          `${formName}: ${!form ? 'no active care plan form' : 'no starter definition'} — not created.`,
        );
        continue;
      }
      const anyRule =
        await prisma.initialAssessmentCarePlanRecommendationRule.findFirst({
          where: { carePathwayFormId: form.id },
        });
      if (anyRule) {
        notes.push(
          `${formName}: a rule already exists (${anyRule.id}${anyRule.deletedAt ? ', deleted by an administrator' : ''}) — not created.`,
        );
        continue;
      }
      const { errors } = validateRuleConditionsAgainstTemplate(
        starter.conditions,
        questions,
      );
      if (errors.length) {
        notes.push(
          `${formName}: conditions do not resolve on the live template — not created: ${errors.join(' ')}`,
        );
        continue;
      }
      changes.push({ kind: 'create', formId: form.id, formName, starter });
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'APPLY' : 'DRY RUN',
          template: {
            id: template.id,
            name: template.name,
            version: template.version,
          },
          changes,
          notes,
        },
        null,
        2,
      ),
    );
    if (!apply) {
      console.log(
        '\nDry run only. Re-run with --apply --backup-dir <dir> to make these changes.',
      );
      return;
    }

    const backupDir = argValue('--backup-dir') ?? os.tmpdir();
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(
      backupDir,
      `ia-care-plan-rules-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        { takenAt: new Date().toISOString(), rules, forms: ruleForms },
        null,
        2,
      ),
    );
    console.log(`Backup written: ${backupFile}`);

    await prisma.$transaction(async (tx) => {
      for (const change of changes) {
        if (change.kind === 'deactivate') {
          await tx.initialAssessmentCarePlanRecommendationRule.update({
            where: { id: change.ruleId },
            data: { isActive: false },
          });
        } else if (change.kind === 'add-conditions') {
          const current =
            await tx.initialAssessmentCarePlanRecommendationRule.findUniqueOrThrow(
              { where: { id: change.ruleId } },
            );
          const next = [
            ...(Array.isArray(current.conditions) ? current.conditions : []),
            ...change.add,
          ];
          await tx.initialAssessmentCarePlanRecommendationRule.update({
            where: { id: change.ruleId },
            data: { conditions: next as unknown as Prisma.InputJsonValue },
          });
        } else {
          await tx.initialAssessmentCarePlanRecommendationRule.create({
            data: {
              carePathwayFormId: change.formId,
              label: change.starter.label ?? null,
              matchMode: change.starter.matchMode ?? 'ANY',
              conditions: change.starter
                .conditions as unknown as Prisma.InputJsonValue,
              suppressLegacyArea: change.starter.suppressLegacyArea ?? null,
              sortOrder: change.starter.sortOrder ?? 0,
              isActive: true,
            },
          });
        }
      }
    });

    const after =
      await prisma.initialAssessmentCarePlanRecommendationRule.findMany({
        orderBy: { createdAt: 'asc' },
      });
    console.log(
      JSON.stringify({ applied: changes.length, rulesAfter: after }, null, 2),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
