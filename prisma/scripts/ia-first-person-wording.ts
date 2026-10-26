/**
 * Applies the IA first-person wording (prisma/seed-data/ia-first-person-wording.ts) to the default
 * (Enterprise) template. Idempotent — safe to re-run.
 * - sets `metadata.displayLabel` on each listed question (stored `questionText` is not changed)
 * - relabels the listed option values (option values are not changed)
 * - removes `displayLabel` from questions no longer listed, so the wording file stays the only source
 *
 * Runs on deploy after `prisma db seed` and the IA template cleanup (see run-deploy-seeds.sh): the
 * seed rewrites question metadata and options, so the wording must be applied after it.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { IA_FIRST_PERSON_WORDING } from '../seed-data/ia-first-person-wording';

type OptionRow = { value?: unknown; label?: unknown };

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Options are stored as `{ options: [{ value, label }] }` (or, in older rows, a bare array). */
function relabelOptions(
  options: Prisma.JsonValue | null,
  labels: Record<string, string>,
): { next: Prisma.InputJsonValue; changed: boolean; missing: string[] } | null {
  const wrapped = !Array.isArray(options);
  const rows = (wrapped ? asRecord(options).options : options) as OptionRow[] | undefined;
  if (!Array.isArray(rows)) return null;
  let changed = false;
  const seen = new Set<string>();
  const nextRows = rows.map((row) => {
    const value = typeof row?.value === 'string' ? row.value : null;
    if (!value || !(value in labels)) return row;
    seen.add(value);
    if (row.label === labels[value]) return row;
    changed = true;
    return { ...row, label: labels[value] };
  });
  const missing = Object.keys(labels).filter((v) => !seen.has(v));
  const next = (wrapped ? { ...asRecord(options), options: nextRows } : nextRows) as Prisma.InputJsonValue;
  return { next, changed, missing };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const template = await prisma.initialAssessmentTemplate.findFirst({
      where: { isDefault: true, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!template) {
      console.log('[ia-first-person-wording] no default IA template — nothing to do.');
      return;
    }

    const questions = await prisma.initialAssessmentQuestion.findMany({
      where: { deletedAt: null, section: { templateId: template.id } },
      select: { id: true, questionText: true, options: true, metadata: true, section: { select: { sectionNumber: true } } },
    });

    const listed = new Set<string>();
    let labelled = 0;
    let relabelledOptions = 0;
    const notFound: string[] = [];

    for (const entry of IA_FIRST_PERSON_WORDING) {
      const matches = questions.filter(
        (q) => q.section.sectionNumber === entry.sectionNumber && q.questionText === entry.questionText,
      );
      if (!matches.length) {
        notFound.push(`§${entry.sectionNumber} "${entry.questionText}"`);
        continue;
      }
      for (const q of matches) {
        listed.add(q.id);
        const metadata = asRecord(q.metadata);
        const data: Prisma.InitialAssessmentQuestionUpdateInput = {};
        if (metadata.displayLabel !== entry.label) {
          data.metadata = { ...metadata, displayLabel: entry.label } as Prisma.InputJsonValue;
          labelled += 1;
        }
        if (entry.options) {
          const result = relabelOptions(q.options, entry.options);
          if (!result) {
            console.warn(`[${template.name}] §${entry.sectionNumber} "${entry.questionText}" has no option list to relabel.`);
          } else {
            if (result.missing.length) {
              console.warn(
                `[${template.name}] §${entry.sectionNumber} "${entry.questionText}" has no option value(s): ${result.missing.join(', ')}`,
              );
            }
            if (result.changed) {
              data.options = result.next;
              relabelledOptions += 1;
            }
          }
        }
        if (Object.keys(data).length) {
          await prisma.initialAssessmentQuestion.update({ where: { id: q.id }, data });
        }
      }
    }

    let cleared = 0;
    for (const q of questions) {
      if (listed.has(q.id)) continue;
      const metadata = asRecord(q.metadata);
      if (!('displayLabel' in metadata)) continue;
      const { displayLabel: _removed, ...rest } = metadata;
      await prisma.initialAssessmentQuestion.update({
        where: { id: q.id },
        data: { metadata: rest as Prisma.InputJsonValue },
      });
      cleared += 1;
    }

    console.log(
      `[${template.name}] first-person wording: ${labelled} label(s) set, ${relabelledOptions} option list(s) relabelled, ${cleared} old label(s) cleared.`,
    );
    if (notFound.length) {
      console.warn(`[${template.name}] ${notFound.length} wording entr(y/ies) matched no question:\n  ${notFound.join('\n  ')}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
