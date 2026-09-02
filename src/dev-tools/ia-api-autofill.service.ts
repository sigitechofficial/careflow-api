import { BadRequestException, Injectable } from '@nestjs/common';
import { InitialAssessmentTemplatesService } from '../initial-assessment-templates/initial-assessment-templates.service';
import {
  buildAutofillAnswers,
  buildHolisticWorksheetMetadata,
  collectWritableDemoQuestionIds,
  type AnswerInput,
  type IaAutofillLevel,
  type TemplateQuestion,
} from './ia-autofill-build.util';
import { IA_HOLISTIC_TAB_COUNT } from './dto/generate-ia-section.dto';

/**
 * Holistic document tab (1..18) → its primary DB section (`sectionNumber`). Mirrors
 * `enterpriseSection` in the frontend `holistic-assessment-tabs.ts`. Used to scope the
 * section demo's `sectionComments`/`sectionFooters` metadata.
 */
const TAB_ENTERPRISE_SECTION: Record<number, number> = {
  1: 1, 2: 12, 3: 2, 4: 11, 5: 11, 6: 12, 7: 6, 8: 12, 9: 12,
  10: 5, 11: 5, 12: 3, 13: 13, 14: 13, 15: 14, 16: 14, 17: 10, 18: 11,
};

/**
 * Holistic tab → the `submission.metadata` worksheet key(s) that tab owns. Several tabs map to
 * one DB section but distinct metadata keys, so scoping by tab (not section) keeps each tab's
 * "Fill Demo Data" from touching a sibling tab's tool data. Keys come from
 * `buildHolisticWorksheetMetadata`. Tabs not listed are answer-only (no worksheet metadata).
 */
const TAB_METADATA_KEYS: Record<number, string[]> = {
  1: ['adl'],
  2: ['practicalCare', 'financeSupport'],
  4: ['skinIntegrityCheck'],
  5: ['waterlow'],
  6: ['equipmentSelection', 'equipmentChecklist', 'dailyLivingAids'],
  7: ['mustAssessment'],
  8: ['fallsScreening'],
  9: ['movingHandlingOperations', 'transfers'],
  10: ['painAssessment'],
  11: ['therapyAideMemoire'],
  12: ['environmentAssessment'],
  13: ['advanceCarePlanning'],
  14: ['endOfLifeAssessment'],
  15: ['clinicalOutcomeSummary'],
  16: ['carePlanObjectives'],
  17: ['mentalCapacityChecklist'],
  18: ['photographyConsent'],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Build the metadata patch owned by a single tab: only that tab's worksheet key(s) plus the
 * `sectionComments`/`sectionFooters` entry for its DB section. Leaves every other tab's tool
 * data untouched.
 */
function pickTabMetadata(full: Record<string, unknown>, tabId: number): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of TAB_METADATA_KEYS[tabId] ?? []) {
    if (key in full) patch[key] = full[key];
  }
  const sectionNumber = String(TAB_ENTERPRISE_SECTION[tabId] ?? tabId);
  const comments = full.sectionComments;
  if (isRecord(comments) && comments[sectionNumber] !== undefined) {
    patch.sectionComments = { [sectionNumber]: comments[sectionNumber] };
  }
  const footers = full.sectionFooters;
  if (isRecord(footers) && footers[sectionNumber] !== undefined) {
    patch.sectionFooters = { [sectionNumber]: footers[sectionNumber] };
  }
  return patch;
}

@Injectable()
export class IaApiAutofillService {
  constructor(private readonly templates: InitialAssessmentTemplatesService) {}

  /**
   * Generate (but do NOT save) severity-aware demo values for ONE holistic tab.
   *
   * Reuses the severity builder for this tab's requested IDs plus tab-owned extras
   * (worksheet tabs that have no visible template questions, hidden follow-ups, §1
   * assessorName). Occupied profile identity fields and secure fields are never
   * overwritten. Empty identity fields receive synthetic QA values. NOTHING is persisted.
   */
  async generateSection(
    level: IaAutofillLevel,
    tabId: number,
    questionIds: string[],
    identity?: import('./ia-autofill-build.util').IaDemoIdentity | null,
  ): Promise<{ answers: AnswerInput[]; metadata: Record<string, unknown> }> {
    if (!Number.isInteger(tabId) || tabId < 1 || tabId > IA_HOLISTIC_TAB_COUNT) {
      throw new BadRequestException(`tabId must be an integer between 1 and ${IA_HOLISTIC_TAB_COUNT}`);
    }

    const allQuestions = await this.loadTemplateQuestions();
    const writable = collectWritableDemoQuestionIds(tabId, allQuestions, questionIds, level, identity);
    const answers = buildAutofillAnswers(allQuestions, level, writable, identity);
    const metadata = pickTabMetadata(buildHolisticWorksheetMetadata(level, identity), tabId);

    return { answers, metadata };
  }

  /** Load the default template's questions flattened with sectionNumber + metadata (no submission). */
  private async loadTemplateQuestions(): Promise<TemplateQuestion[]> {
    const templateRes = await this.templates.getDefaultTemplate();
    const template = templateRes.data;
    return (template.sections ?? []).flatMap((section) =>
      (section.questions ?? []).map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        isRequired: q.isRequired,
        sortOrder: q.sortOrder,
        metadata:
          q.metadata && typeof q.metadata === 'object' && !Array.isArray(q.metadata)
            ? (q.metadata as Record<string, unknown>)
            : null,
        options: q.options ?? undefined,
        sectionNumber: section.sectionNumber,
      })),
    );
  }
}
