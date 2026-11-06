import { libraryRuleRows, type AlertQuestion } from './survey-alert-rules.util';
import { describePlan, planLibraryUpdate, readKeyChanges, type ExistingRule } from './survey-library-update.util';

const question = (key: string, questionText: string, questionType: AlertQuestion['questionType'], options: string[] | null = null): AlertQuestion => ({
  id: `id-${key}`,
  key,
  questionText,
  questionType,
  options,
  config: null,
  otherOption: null,
});

const oldQuestions = [
  question('q1', 'Do your care workers arrive on time?', 'YES_NO'),
  question('q-visit', 'How was your last visit?', 'SINGLE_SELECT', ['Late', 'On time', 'Missed']),
  question('q-rota', 'Do you get your rota on time?', 'YES_NO'),
  question('q-checks', 'Which checks were done?', 'MULTI_SELECT', ['Medicines', 'Food', 'Skin']),
];
// Revision 2: "Late" renamed, "Missed" dropped, the rota question retired, "Skin" dropped.
const newQuestions = [
  question('q1', 'Do your care workers arrive on time?', 'YES_NO'),
  question('q-visit', 'How was your last visit?', 'SINGLE_SELECT', ['Arrived late', 'On time']),
  question('q-checks', 'Which checks were done?', 'MULTI_SELECT', ['Medicines', 'Food']),
];

const alert = (task: string, ifs: unknown[], extra: Record<string, unknown> = {}) => ({
  when: `When: ${task}`,
  action: `Do: ${task}`,
  rule: { task, if: ifs, owner: 'REGISTERED_MANAGER', dueWorkingDays: 2, ...extra },
});
const meta = (alerts: unknown[], keyChanges?: unknown) => ({ type: 'survey-library', version: 1, managerGuidance: { alerts }, ...(keyChanges ? { keyChanges } : {}) });

const oldMeta = meta([
  alert('Late care workers', [{ question: 'q1', answers: ['No'] }], { minimumAnswers: 10 }),
  alert('Rota not on time', [{ question: 'q-rota', answers: ['No'] }]),
  alert('Late visit', [{ question: 'q-visit', answers: ['Late'] }]),
  alert('Deleted by the organisation', [{ question: 'q1', answers: ['Yes'] }]),
]);
const keyChanges = {
  retiredQuestions: [{ id: 'q-rota', revision: 2, reason: 'rotas are now in the app' }],
  answerChanges: [
    { question: 'q-visit', from: 'Late', to: 'Arrived late', revision: 2 },
    { question: 'q-visit', from: 'Missed', to: null, revision: 2 },
    { question: 'q-checks', from: 'Skin', to: null, revision: 2 },
  ],
};
const newMeta = meta(
  [
    alert('Late care workers (updated)', [{ question: 'q1', answers: ['No'] }], { minimumAnswers: 10 }),
    { when: 'Rota', action: 'Gone', retired: true, rule: { task: 'Rota not on time' } },
    alert('Late visit', [{ question: 'q-visit', answers: ['Arrived late'] }]),
    alert('Deleted by the organisation', [{ question: 'q1', answers: ['Yes'] }]),
    alert('Brand new alert', [{ question: 'q-checks', answers: ['Food'] }]),
  ],
  keyChanges,
);

const oldRows = libraryRuleRows(oldMeta, oldQuestions, { anonymous: false });
const newRows = libraryRuleRows(newMeta, newQuestions, { anonymous: false });

/** A rule as set up from the old library rows (unchanged by the organisation). */
const stored = (libraryAlert: number, over: Partial<ExistingRule> = {}): ExistingRule => {
  const row = oldRows.find((r) => r.libraryAlert === libraryAlert)!;
  return { id: `rule-${libraryAlert}`, ...row, roleId: null, isActive: true, ...over } as ExistingRule;
};
const own = (id: string, conditions: unknown, over: Partial<ExistingRule> = {}): ExistingRule => ({
  id,
  key: `own-${id}`,
  title: `Own ${id}`,
  whenText: 'w',
  actionText: 'a',
  conditions,
  ownerKey: 'REGISTERED_MANAGER',
  roleId: null,
  dueWorkingDays: 1,
  dueCalendarDays: null,
  urgent: false,
  recordKind: null,
  contactRequest: false,
  isActive: true,
  libraryAlert: null,
  minimumAnswers: null,
  ...over,
});

const plan = (rules: ExistingRule[], over: Partial<Parameters<typeof planLibraryUpdate>[0]> = {}) =>
  planLibraryUpdate({
    rulesSetUp: true,
    rules,
    oldLibraryRows: oldRows,
    newLibraryRows: newRows,
    newQuestions,
    oldQuestions,
    changes: readKeyChanges(newMeta),
    fromRevision: 1,
    toRevision: 2,
    sectionIntros: null,
    newSectionTitles: [],
    fill: (s) => s,
    ...over,
  });

describe('library rule rows', () => {
  it('carry the library minimum of answers given without a name (e.g. 10 for abuse)', () => {
    expect(oldRows.find((r) => r.libraryAlert === 0)?.minimumAnswers).toBe(10);
    expect(oldRows.find((r) => r.libraryAlert === 2)?.minimumAnswers).toBeNull();
  });

  it('skip a retired alert but keep every other alert in its released place', () => {
    expect(newRows.map((r) => r.libraryAlert)).toEqual([0, 2, 3, 4]);
    expect(newRows.map((r) => r.key)).toEqual(['library-0', 'library-2', 'library-3', 'library-4']);
  });
});

describe('planLibraryUpdate', () => {
  it('updates ready-made rules the organisation never changed, removes retired ones and adds new ones', () => {
    const p = plan([stored(0), stored(1), stored(2)]);
    expect(p.rules).toEqual([
      expect.objectContaining({ kind: 'refresh', ruleId: 'rule-0', title: 'Late care workers (updated)' }),
      expect.objectContaining({ kind: 'remove', ruleId: 'rule-1' }),
      expect.objectContaining({ kind: 'refresh', ruleId: 'rule-2', title: 'Late visit' }),
      expect.objectContaining({ kind: 'add', title: 'Brand new alert' }),
    ]);
    const refreshed = p.rules[2];
    expect(refreshed.kind === 'refresh' && refreshed.row.conditions).toEqual([{ questionKey: 'q-visit', answers: ['Arrived late'] }]);
    // Alert 3 was deleted by the organisation: it stays deleted.
    expect(p.rules.some((s) => s.title === 'Deleted by the organisation')).toBe(false);
  });

  it('a rule set up before the library minimum was copied still counts as unchanged', () => {
    expect(plan([stored(0, { minimumAnswers: null })]).rules[0]).toEqual(expect.objectContaining({ kind: 'refresh' }));
  });

  it("keeps the organisation's own and changed rules, renaming answers the library renamed", () => {
    const p = plan([
      stored(2, { urgent: true }), // changed by the organisation
      own('a', [{ questionKey: 'q-visit', answers: ['Late', 'Missed'] }]),
      own('b', [{ questionKey: 'q1', answers: ['No'] }]),
    ]);
    expect(p.rules[0]).toEqual({
      kind: 'map',
      ruleId: 'rule-2',
      title: 'Late visit',
      conditions: [{ questionKey: 'q-visit', answers: ['Arrived late'] }],
      changes: ['"Late" is now "Arrived late" in "How was your last visit?"'],
    });
    expect(p.rules[1]).toEqual(
      expect.objectContaining({
        kind: 'map',
        conditions: [{ questionKey: 'q-visit', answers: ['Arrived late'] }],
        changes: ['"Late" is now "Arrived late" in "How was your last visit?"', '"Missed" is no longer an answer in "How was your last visit?"'],
      }),
    );
    expect(p.rules[2]).toEqual({ kind: 'keep', ruleId: 'b', title: 'Own b' });
  });

  it('turns off, with the reason, any rule that would check a question taken out or could widen', () => {
    const p = plan([
      stored(1, { dueWorkingDays: 5 }), // changed, on the retired rota question
      own('missed', [{ questionKey: 'q-visit', answers: ['Missed'] }]),
      own('not', [{ questionKey: 'q-checks', answers: ['Medicines', 'Skin'], not: true }]),
      own('group', [{ all: [{ questionKey: 'q1', answers: ['No'] }, { questionKey: 'q-rota', answers: ['No'] }] }]),
      own('unknown', [{ questionKey: 'q-gone', answers: ['Yes'] }]),
    ]);
    const steps = p.rules.filter((s) => s.kind !== 'add');
    expect(steps.map((s) => s.kind)).toEqual(['turnOff', 'turnOff', 'turnOff', 'turnOff', 'turnOff']);
    const reasons = steps.map((s) => (s.kind === 'turnOff' ? s.reason : ''));
    expect(reasons[0]).toBe('"Do you get your rota on time?" was taken out of the ready-made survey (rotas are now in the app).');
    expect(reasons[1]).toMatch(/None of the answers this rule checks on "How was your last visit\?"/);
    expect(reasons[2]).toMatch(/"Skin" was taken out of "Which checks were done\?", which this rule checks as "not chosen"/);
    expect(reasons[3]).toMatch(/rota on time/);
    expect(reasons[4]).toBe('"q-gone" is no longer in the survey.');
  });

  it('only renames answers changed between the two revisions', () => {
    const p = plan([own('a', [{ questionKey: 'q-visit', answers: ['Late'] }])], { fromRevision: 2, toRevision: 3 });
    // The rename was in revision 2, already applied: "Late" is simply not an answer now.
    expect(p.rules[0]).toEqual(expect.objectContaining({ kind: 'turnOff', reason: '"Late" is not an answer to "How was your last visit?".' }));
  });

  it('plans nothing for rules when the template has none set up yet (they come from the new version)', () => {
    expect(plan([], { rulesSetUp: false }).rules).toEqual([]);
  });

  it("keeps the template's own section introductions whose section is still there", () => {
    const p = plan([], {
      sectionIntros: { Visits: 'About your visits.', Rotas: 'About rotas.', Empty: '  ' },
      newSectionTitles: ['Visits', 'Food'],
    });
    expect(p.sectionIntros).toEqual({ Visits: 'About your visits.' });
    expect(p.droppedSectionIntros).toEqual(['Rotas']);
    expect(describePlan(p)).toEqual(expect.objectContaining({ sectionIntrosKept: ['Visits'], sectionIntrosDropped: ['Rotas'] }));
  });
});
