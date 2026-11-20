import { Injectable } from '@nestjs/common';
import { CqcFrameworkService } from '../cqc-evidence/cqc-framework.service';
import { matchStatements } from '../cqc-evidence/cqc-statement-match.util';
import { SurveyLibraryService } from '../surveys/survey-library.service';

/** A ready-made survey that gathers evidence for a quality statement. */
export type StatementSurvey = {
  id: string;
  reference: string | null;
  title: string;
  respondents: string;
  audience: string;
  groupName: string;
  /** The organisation's own template made from it, when adopted. */
  adoptedTemplateId: string | null;
  /** How many quality statements the survey covers: fewer means it is more about this one. */
  statementCount: number;
};

/**
 * Ready-made surveys by quality statement, for mock inspections: which surveys ask people, families,
 * staff or partners about each statement. Statements are matched from the survey library's own
 * labels with the same rules CQC evidence uses (cqc-statement-match.util.ts).
 */
@Injectable()
export class CqcMockInspectionSurveysService {
  constructor(
    private readonly library: SurveyLibraryService,
    private readonly framework: CqcFrameworkService,
  ) {}

  /** Statement code → ready-made surveys for it, most specific first. */
  async byStatement(): Promise<{ data: Record<string, StatementSurvey[]> }> {
    const [library, framework] = await Promise.all([
      this.library.list(),
      this.framework.active(),
    ]);
    const out: Record<string, StatementSurvey[]> = {};
    for (const s of library.data) {
      const { matched } = matchStatements(
        s.cqc?.qualityStatements ?? [],
        framework.statements,
      );
      for (const st of matched) {
        (out[st.code] ??= []).push({
          id: s.id,
          reference: s.reference ?? null,
          title: s.title,
          respondents: s.respondents,
          audience: s.audience,
          groupName: s.group.name,
          adoptedTemplateId: s.adoptedTemplateId,
          statementCount: matched.length,
        });
      }
    }
    // Most specific first: a survey about a few statements says more about each of them.
    for (const list of Object.values(out)) {
      list.sort(
        (a, b) =>
          a.statementCount - b.statementCount ||
          (a.reference ?? '').localeCompare(b.reference ?? ''),
      );
    }
    return { data: out };
  }
}
