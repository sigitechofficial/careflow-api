import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  freezeSurveyIds,
  loadSurveyLibrary,
  questionKeys,
  releasedIdProblems,
  surveyQuestionRows,
  type LibrarySurvey,
  type LibrarySurveyQuestion,
} from '../../prisma/seed-lib/survey-library';

/* Fixtures live here (never in prisma/seed-data/survey-library). */

const rule = (task: string, question: string, answers: string[]) => ({
  task,
  if: [{ question, answers }],
  owner: 'REGISTERED_MANAGER' as const,
  dueWorkingDays: 2,
});

const base = (): LibrarySurvey =>
  ({
    reference: 'SUR-PWS-001',
    revision: 1,
    sections: [
      {
        title: 'Visits',
        questions: [
          { text: 'Do your care workers arrive on time?', type: 'YES_NO', required: true },
          { text: 'How do you find the rota?', type: 'SINGLE_SELECT', options: ['Red', 'Blue'], required: true },
          { id: 'q-comments', text: 'Anything else you would like to tell us?', type: 'TEXTAREA', required: false },
        ],
      },
    ],
    managerGuidance: {
      howToRun: ['Run it.'],
      actingOnResults: ['Act on it.'],
      alerts: [
        { when: 'Care workers are late', action: 'Call them.', rule: rule('Late care workers', 'q1', ['No']) },
        { when: 'Any written concern', action: 'Read the comments.' },
      ],
    },
  }) as unknown as LibrarySurvey;

const clone = (s: LibrarySurvey): LibrarySurvey => JSON.parse(JSON.stringify(s)) as LibrarySurvey;
const questionsOf = (s: LibrarySurvey) => s.sections[0].questions;
const at = 'SUR-PWS-001';

describe('released library question ids', () => {
  it('keeps every released key on its question when a question is added before them', () => {
    const s = base();
    expect(questionKeys(s)).toEqual(['q1', 'q2', 'q-comments']);
    const released = freezeSurveyIds(s, null);
    const next = clone(s);
    questionsOf(next).unshift({ text: 'Which branch supports you?', type: 'SINGLE_SELECT', options: ['North', 'South'], required: false } as LibrarySurveyQuestion);
    // Without the released ids every key would move along by one…
    expect(questionKeys(next)).toEqual(['q1', 'q2', 'q3', 'q-comments']);
    // …with them, the new question takes the next number never used.
    expect(questionKeys(next, released)).toEqual(['q3', 'q1', 'q2', 'q-comments']);
    expect(surveyQuestionRows(next, released).map((r) => r.key)).toEqual(['q3', 'q1', 'q2', 'q-comments']);
    expect(releasedIdProblems(next, released, at)).toEqual([]);
  });

  it('refuses a released question that disappears, and says how to reword or retire it', () => {
    const released = freezeSurveyIds(base(), null);
    const reworded = clone(base());
    questionsOf(reworded)[0].text = 'Do your care workers usually arrive on time?';
    const problems = releasedIdProblems(reworded, released, at);
    expect(problems.join('\n')).toMatch(/question "q1" \("Do your care workers arrive on time\?"\) was released in revision 1 and is missing/);
    expect(problems.join('\n')).toMatch(/give the reworded question "id": "q1"/);
    expect(problems.join('\n')).toMatch(/list it in retiredQuestions/);

    // Rewording with the released key kept is fine.
    questionsOf(reworded)[0].id = 'q1';
    expect(questionKeys(reworded, released)).toEqual(['q1', 'q2', 'q-comments']);
    expect(releasedIdProblems(reworded, released, at)).toEqual([]);
  });

  it('lets a released question go only with a recorded retirement in a new revision, and never reuses its id', () => {
    const released = freezeSurveyIds(base(), null);
    const s = clone(base());
    questionsOf(s).splice(0, 1);
    s.managerGuidance.alerts[0].retired = true;
    s.retiredQuestions = [{ id: 'q1', revision: 1, reason: 'Asked in the visit check instead' }];
    expect(releasedIdProblems(s, released, at).join('\n')).toMatch(/retiring "q1" needs a new revision/);

    s.revision = 2;
    s.retiredQuestions[0].revision = 2;
    expect(releasedIdProblems(s, released, at)).toEqual([]);

    const frozen = freezeSurveyIds(s, released);
    expect(frozen.questions.q1.retiredIn).toBe(2);
    // Still valid once frozen…
    expect(releasedIdProblems(s, frozen, at)).toEqual([]);
    // …the old text never brings the key back, and the id can never be given to another question.
    const again = clone(s);
    questionsOf(again).unshift({ text: 'Do your care workers arrive on time?', type: 'YES_NO', required: true } as LibrarySurveyQuestion);
    expect(questionKeys(again, frozen)[0]).toBe('q3');
    questionsOf(again)[0].id = 'q1';
    expect(releasedIdProblems(again, frozen, at).join('\n')).toMatch(/"q1" was retired in revision 2 and can never be used again/);
  });

  it('refuses a released question changing its answer type', () => {
    const released = freezeSurveyIds(base(), null);
    const s = clone(base());
    questionsOf(s)[1].type = 'MULTI_SELECT';
    expect(releasedIdProblems(s, released, at).join('\n')).toMatch(/"q2" was released as SINGLE_SELECT and is now MULTI_SELECT/);
  });

  it('needs an answerChanges entry (in a new revision) for a released answer that is renamed or dropped', () => {
    const released = freezeSurveyIds(base(), null);
    const s = clone(base());
    questionsOf(s)[1].options = ['Crimson', 'Blue'];
    expect(releasedIdProblems(s, released, at).join('\n')).toMatch(/"q2" no longer offers "Red".*answerChanges/);

    s.answerChanges = [{ question: 'q2', from: 'Red', to: 'Crimson', revision: 1 }];
    expect(releasedIdProblems(s, released, at).join('\n')).toMatch(/needs a new revision/);
    s.revision = 2;
    s.answerChanges[0].revision = 2;
    expect(releasedIdProblems(s, released, at)).toEqual([]);

    const frozen = freezeSurveyIds(s, released);
    expect(frozen.questions.q2.answers).toEqual(expect.arrayContaining(['Red', 'Crimson', 'Blue']));
    expect(releasedIdProblems(s, frozen, at)).toEqual([]);
    // The entry is kept for good: dropping it later is refused.
    const dropped = clone(s);
    delete dropped.answerChanges;
    expect(releasedIdProblems(dropped, frozen, at).join('\n')).toMatch(/no longer offers "Red"/);
    // A change pointing at an answer that does not exist is refused.
    s.answerChanges[0].to = 'Purple';
    expect(releasedIdProblems(s, released, at).join('\n')).toMatch(/"Purple" is not an answer to "q2"/);
  });

  it('keeps alerts in their released places: no reordering, no dropping, retiring in place needs a new revision', () => {
    const released = freezeSurveyIds(base(), null);
    const reordered = clone(base());
    reordered.managerGuidance.alerts.reverse();
    expect(releasedIdProblems(reordered, released, at).join('\n')).toMatch(/was released as alert 1 and is now alert 2/);

    const dropped = clone(base());
    dropped.managerGuidance.alerts.pop();
    expect(releasedIdProblems(dropped, released, at).join('\n')).toMatch(/alert 2 \("Any written concern"\) was released and is missing/);

    const added = clone(base());
    added.managerGuidance.alerts.push({ when: 'A new worry', action: 'Act.' });
    expect(releasedIdProblems(added, released, at)).toEqual([]);

    const retired = clone(base());
    retired.managerGuidance.alerts[1].retired = true;
    expect(releasedIdProblems(retired, released, at).join('\n')).toMatch(/retiring alert 2 needs a new revision/);
    retired.revision = 2;
    expect(releasedIdProblems(retired, released, at)).toEqual([]);
  });

  it('refuses a released survey missing from the library', () => {
    const dir = mkdtempSync(join(tmpdir(), 'survey-lib-released-'));
    try {
      mkdirSync(join(dir, 'people-we-support'));
      writeFileSync(
        join(dir, 'people-we-support', 'group.json'),
        JSON.stringify({ code: 'PEOPLE_WE_SUPPORT', name: 'People we support', researchedOn: '2026-11-01', displayOrder: 10 }),
      );
      const released = { 'SUR-PWS-001': freezeSurveyIds(base(), null) };
      expect(() => loadSurveyLibrary(dir, { policyReferences: new Set(), released })).toThrow(/SUR-PWS-001: was released and is missing/);
      expect(() => loadSurveyLibrary(dir, { policyReferences: new Set(), released: {} })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every survey in the library passes against its own frozen ids (freezing is consistent)', () => {
    const files = loadSurveyLibrary(undefined, { partial: true, released: {} });
    const surveys = files.flatMap((f) => f.surveys);
    expect(surveys.length).toBeGreaterThan(0);
    for (const s of surveys) {
      const frozen = freezeSurveyIds(s, null);
      expect({ ref: s.reference, problems: releasedIdProblems(s, frozen, s.reference) }).toEqual({ ref: s.reference, problems: [] });
      // Freezing again changes nothing (append-only, stable).
      expect(freezeSurveyIds(s, frozen)).toEqual(frozen);
      expect(questionKeys(s, frozen)).toEqual(questionKeys(s));
    }
  });
});
