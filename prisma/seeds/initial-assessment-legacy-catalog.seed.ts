import { InitialAssessmentQuestionType, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { ENTERPRISE_TEMPLATE_NAME } from './initial-assessment-enterprise.seed';
import { LEGACY_SPEC_REF_BY_CATALOG_SECTION } from './initial-assessment-enterprise-metadata';

type CatalogItem = { id: string; label: string };
type CatalogSection = { id: string; title: string; items: CatalogItem[] };

/** Maps care-admin catalog section id → enterprise template sectionNumber (1–14). */
const CATALOG_SECTION_TO_ENTERPRISE: Record<string, number> = {
  sec_care_assistance_required: 1,
  sec_environment: 3,
  sec_flooring: 3,
  sec_pets: 3,
  sec_build: 4,
  sec_breathing_difficulties: 5,
  sec_distress_pain_physical_state: 5,
  sec_swallowing: 5,
  sec_appetite: 6,
  sec_hydration: 6,
  sec_nutrition: 6,
  sec_incontinence: 7,
  sec_speech_impairment: 8,
  sec_hearing: 8,
  sec_sight: 8,
  sec_medication: 9,
  sec_emotional_well_being_client_states: 10,
  sec_cognitive_ability: 10,
  sec_skin_condition: 11,
  sec_additional_risks: 13,
};

function catalogPath(): string {
  return path.resolve(
    __dirname,
    '../../../care-admin/src/features/service-users/initial-assessment-catalog.json',
  );
}

function loadCatalog(): CatalogSection[] {
  const raw = fs.readFileSync(catalogPath(), 'utf8');
  return JSON.parse(raw) as CatalogSection[];
}

function normalizeLabel(label: string): string {
  return label.replace(/\{name\}/gi, 'Service User').trim();
}

/**
 * Appends legacy checkbox questions from initial-assessment-catalog.json into the enterprise template.
 * Idempotent: upserts by metadata.legacyCatalogId per section.
 */
export async function seedInitialAssessmentLegacyCatalog(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) {
    console.warn('[seed] Enterprise initial assessment template not found; skip legacy catalog import.');
    return 0;
  }

  const sections = await prisma.initialAssessmentSection.findMany({
    where: { templateId: template.id, deletedAt: null },
  });
  const sectionByNumber = new Map(sections.map((s) => [s.sectionNumber, s]));

  const catalog = loadCatalog();
  let imported = 0;
  const LEGACY_SORT_BASE = 1000;
  const sectionQuestionCache = new Map<
    string,
    { id: string; metadata: unknown }[]
  >();

  for (const catSection of catalog) {
    // §3.8 / §3.10 / §3.11 use consolidated enterprise YES/NO fields — skip legacy checkboxes.
    if (
      catSection.id === 'sec_flooring' ||
      catSection.id === 'sec_environment' ||
      catSection.id === 'sec_pets' ||
      catSection.id === 'sec_breathing_difficulties' ||
      catSection.id === 'sec_distress_pain_physical_state' ||
      catSection.id === 'sec_swallowing' ||
      catSection.id === 'sec_appetite' ||
      catSection.id === 'sec_hydration' ||
      catSection.id === 'sec_nutrition' ||
      catSection.id === 'sec_emotional_well_being_client_states' ||
      catSection.id === 'sec_cognitive_ability' ||
      catSection.id === 'sec_care_assistance_required' ||
      catSection.id === 'sec_build' ||
      catSection.id === 'sec_incontinence' ||
      catSection.id === 'sec_speech_impairment' ||
      catSection.id === 'sec_hearing' ||
      catSection.id === 'sec_sight' ||
      catSection.id === 'sec_medication' ||
      catSection.id === 'sec_skin_condition' ||
      catSection.id === 'sec_additional_risks'
    ) {
      continue;
    }
    const sectionNumber = CATALOG_SECTION_TO_ENTERPRISE[catSection.id];
    if (!sectionNumber) {
      console.warn(`[seed] No enterprise section mapping for catalog ${catSection.id}`);
      continue;
    }
    const sectionRow = sectionByNumber.get(sectionNumber);
    if (!sectionRow) continue;

    let sort = LEGACY_SORT_BASE;
    for (const item of catSection.items) {
      sort += 1;
      const questionText = normalizeLabel(item.label);
      const metadata = {
        legacyCatalogId: item.id,
        legacyCatalogSection: catSection.id,
        legacyCatalogSectionTitle: catSection.title,
        specRef: LEGACY_SPEC_REF_BY_CATALOG_SECTION[catSection.id],
        source: 'initial-assessment-catalog.json',
      };

      if (!sectionQuestionCache.has(sectionRow.id)) {
        sectionQuestionCache.set(
          sectionRow.id,
          await prisma.initialAssessmentQuestion.findMany({
            where: { sectionId: sectionRow.id, deletedAt: null },
            select: { id: true, metadata: true },
          }),
        );
      }
      const sectionQuestions = sectionQuestionCache.get(sectionRow.id)!;
      const existing = sectionQuestions.find(
        (q) =>
          q.metadata &&
          typeof q.metadata === 'object' &&
          !Array.isArray(q.metadata) &&
          (q.metadata as Record<string, unknown>).legacyCatalogId === item.id,
      );

      const data = {
        questionText,
        questionType: InitialAssessmentQuestionType.CHECKBOX,
        isRequired: false,
        riskFlag: false,
        carePlanTrigger: false,
        sortOrder: sort,
        metadata: metadata as object,
        isActive: true,
      };

      if (existing?.id) {
        await prisma.initialAssessmentQuestion.update({ where: { id: existing.id }, data });
      } else {
        await prisma.initialAssessmentQuestion.create({
          data: { sectionId: sectionRow.id, ...data },
        });
      }
      imported += 1;
    }
  }

  await prisma.initialAssessmentTemplate.update({
    where: { id: template.id },
    data: { version: Math.max(template.version, 7) },
  });

  return imported;
}
