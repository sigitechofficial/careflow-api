import {
  applyCarePlanPersonalisationTokens,
  type CarePlanPersonalisationContext,
} from '../../care-plan-text/care-plan-text.util';
import { sanitizeRichTextHtml } from '../../common/utils/rich-text-html.util';
import { factsheetCodesForCarePlan } from './care-plan-factsheet-attachments';
import { CONDITION_FACTSHEET_BY_CODE } from './condition-factsheets.data';

export type ResolvedConditionFactsheet = {
  code: string;
  title: string;
  summary: string;
  contentHtml: string;
  plainText: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveCarePlanFactsheets(
  formName: string,
  personalisation: CarePlanPersonalisationContext,
): ResolvedConditionFactsheet[] {
  const codes = factsheetCodesForCarePlan(formName);
  const sheets: ResolvedConditionFactsheet[] = [];

  for (const code of codes) {
    const def = CONDITION_FACTSHEET_BY_CODE.get(code);
    if (!def) continue;

    // The factsheet HTML is ours, but the names put into it are typed by users.
    const contentHtml = sanitizeRichTextHtml(
      applyCarePlanPersonalisationTokens(def.contentHtml, personalisation),
    );
    const title = applyCarePlanPersonalisationTokens(def.title, personalisation);
    const summary = applyCarePlanPersonalisationTokens(def.summary, personalisation);

    sheets.push({
      code: def.code,
      title,
      summary,
      contentHtml,
      plainText: stripHtml(contentHtml),
    });
  }

  return sheets;
}
