import { decideReferral } from './referral-checks.util';
import { careFlagsFromTags, houseRuleMatchesFrom, type CareFlag, type CareFlags, type ReferralExtraction } from './referral-extraction.service';
import { ageOn, effectiveRule, emailKindOf, kindAction, normaliseRules, ruleChecks } from './referral-rules.util';

const today = new Date(Date.UTC(2026, 10, 10));

type FlagPatch = Partial<Omit<CareFlags, 'present'>> & { [K in CareFlag]?: boolean };
const flags = (patch: FlagPatch = {}): CareFlags => {
  const present = Object.entries(patch)
    .filter(([k, v]) => v === true && !['delegatedHealthcare', 'complexClinical', 'risksToStaff'].includes(k))
    .map(([k]) => k as CareFlag);
  return {
    present,
    delegatedHealthcare: patch.delegatedHealthcare ?? [],
    complexClinical: patch.complexClinical ?? [],
    medicationLevel: patch.medicationLevel ?? 'PROMPT',
    risksToStaff: patch.risksToStaff ?? [],
    infectionControl: patch.infectionControl ?? '',
    ageYears: patch.ageYears ?? 0,
  };
};

const referral = (patch: Partial<ReferralExtraction> = {}): ReferralExtraction =>
  ({
    isReferral: true,
    requestType: 'CARE_REFERRAL',
    emailKind: 'NEW_REFERRAL',
    summary: 'Care for Mrs Smith',
    person: { firstName: 'Ann', lastName: 'Smith', dateOfBirth: '1940-01-01', addressLine: '', postcode: '', phone: '', nhsNumber: '', livesAlone: '' },
    contact: { name: '', relationship: '', phone: '', email: '' },
    referrer: { organisation: '', name: '', role: '', email: '', phone: '', reference: '' },
    urgency: 'ROUTINE',
    careNeeds: 'Help with washing and dressing',
    conditions: [],
    risks: [],
    care: { hoursPerWeek: '', visitsPerDay: '', visitTimes: '', carersPerVisit: '', requestedStartDate: '2026-11-20', genderPreference: '', languageOrCulture: '' },
    funding: { type: 'LOCAL_AUTHORITY', funderName: '', details: '' },
    visits: [{ label: 'Morning', startTime: '08:00', durationMinutes: 45, days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], carers: 1 }],
    careAreas: [],
    priceAsked: false,
    questionsAsked: [],
    missingInformation: [],
    attachmentsRead: [],
    careFlags: flags(),
    ...patch,
  }) as ReferralExtraction;

const keys = (e: ReferralExtraction, raw: unknown = {}, branch: string | null = null) =>
  ruleChecks(e, normaliseRules(raw), branch, today).map((c) => `${c.key}=${c.result}`);

describe('referral rules', () => {
  it('a plain referral triggers nothing by default', () => {
    expect(keys(referral())).toEqual([]);
  });

  it('defaults: live-in and delegated healthcare go to a manager, dementia is a note', () => {
    const e = referral({ careFlags: flags({ liveIn: true, delegatedHealthcare: ['Insulin'], dementia: true }) });
    expect(keys(e)).toEqual(['rule:liveIn=WARN', 'rule:delegatedHealthcare=WARN', 'note:dementia=WARN']);
    const checks = ruleChecks(e, normaliseRules({}), null, today);
    expect(checks[1].detail).toBe('Insulin (a manager decides).');
  });

  it('a declined rule makes the decision "No" with the reason', () => {
    const e = referral({ careFlags: flags({ liveIn: true }) });
    const checks = ruleChecks(e, normaliseRules({ rules: [{ key: 'liveIn', outcome: 'DECLINE' }] }), null, today);
    expect(checks).toEqual([expect.objectContaining({ key: 'rule:liveIn', result: 'FAIL' })]);
    const decided = decideReferral([{ key: 'area', label: 'Area', result: 'PASS', detail: '' }, ...checks]);
    expect(decided.decision).toBe('NO');
    expect(decided.reasons[0]).toContain('Live-in care');
  });

  it('a manager rule gives "Possibly"; a note changes nothing', () => {
    const base = [
      { key: 'area', label: 'Area', result: 'PASS' as const, detail: '' },
      { key: 'carers:0', label: 'Carers', result: 'PASS' as const, detail: '' },
    ];
    expect(decideReferral([...base, { key: 'note:dementia', label: 'Dementia', result: 'WARN', detail: 'x' }]).decision).toBe('YES');
    expect(decideReferral([...base, { key: 'rule:hoist', label: 'Hoist', result: 'WARN', detail: 'x' }]).decision).toBe('POSSIBLY');
  });

  it('a branch can override the all-branches rule', () => {
    const raw = { rules: [{ key: 'hoist', outcome: 'NOTE' }, { key: 'hoist', outcome: 'DECLINE', locationId: 'b1' }] };
    const e = referral({ careFlags: flags({ hoist: true }) });
    expect(keys(e, raw, null)).toEqual(['note:hoist=WARN']);
    expect(keys(e, raw, 'b2')).toEqual(['note:hoist=WARN']);
    expect(keys(e, raw, 'b1')).toEqual(['rule:hoist=FAIL']);
    expect(effectiveRule(normaliseRules(raw), 'hoist', 'b1').outcome).toBe('DECLINE');
  });

  it('visit rules: short, early, late, hours and visits a day', () => {
    const e = referral({
      visits: [
        { label: 'Morning', startTime: '06:30', durationMinutes: 30, days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], carers: 1 },
        { label: 'Meds', startTime: '13:00', durationMinutes: 15, days: ['MON'], carers: 1 },
        { label: 'Bed', startTime: '21:45', durationMinutes: 30, days: ['MON'], carers: 2 },
      ],
    });
    const raw = { rules: [{ key: 'minHours', outcome: 'NOTE', value: 5 }, { key: 'maxVisitsPerDay', outcome: 'NOTE', value: 2 }] };
    const out = ruleChecks(e, normaliseRules(raw), null, today);
    const by = (k: string) => out.find((c) => c.key.endsWith(k));
    expect(by('shortVisits')?.detail).toBe('Meds 15 min (a manager decides).');
    expect(by('earlyVisits')?.detail).toContain('Morning at 06:30');
    expect(by('lateVisits')?.detail).toContain('Bed at 21:45');
    expect(by('doubleHanded')?.detail).toBe('Two carers at Bed (noted).');
    // 5×30 + 15 + 2×30 = 225 minutes = 3.8 hours.
    expect(by('minHours')?.detail).toBe('3.8 carer hours a week (noted).');
    expect(by('maxVisitsPerDay')?.detail).toBe('3 visits a day (noted).');
  });

  it('age from the date of birth, the stated age, or the old "a child" wording', () => {
    expect(ageOn('2010-11-11', today)).toBe(15);
    expect(ageOn('2010-11-10', today)).toBe(16);
    expect(keys(referral({ person: { ...referral().person, dateOfBirth: '2012-05-01' } }))).toEqual(['rule:minAge=WARN']);
    expect(keys(referral({ person: { ...referral().person, dateOfBirth: '' }, careFlags: flags({ ageYears: 9 }) }))).toEqual(['rule:minAge=WARN']);
    const old = referral({ person: { ...referral().person, dateOfBirth: '' }, careFlags: undefined, careNeeds: 'Support for a child aged 9 after school' });
    expect(keys(old)).toEqual(['rule:minAge=WARN']);
  });

  it('emails read before the care flags still catch live-in and clinical wording', () => {
    const old = referral({ careFlags: undefined, careNeeds: 'Live-in carer needed; PEG feed twice a day' });
    expect(keys(old)).toEqual(['rule:liveIn=WARN', 'rule:delegatedHealthcare=WARN']);
  });

  it('funding rules are off unless set', () => {
    const e = referral({ funding: { type: 'NHS', funderName: '', details: '' } });
    expect(keys(e)).toEqual([]);
    expect(keys(e, { rules: [{ key: 'fundNhs', outcome: 'DECLINE' }] })).toEqual(['rule:fundNhs=FAIL']);
  });

  it('urgent starts: emergency or today/tomorrow', () => {
    expect(keys(referral({ care: { ...referral().care, requestedStartDate: '2026-11-11' } }))).toEqual(['rule:urgentStart=WARN']);
    expect(keys(referral({ urgency: 'EMERGENCY' }))).toEqual(['rule:urgentStart=WARN']);
  });

  it('our own written rules: only matched, active rules for this branch, never a decline', () => {
    const raw = {
      custom: [
        { id: 'r1', text: 'No double-handed calls in Sutton', outcome: 'MANAGER', locationId: null, isActive: true },
        { id: 'r2', text: 'Ask for the discharge summary', outcome: 'DECLINE', locationId: null, isActive: true },
        { id: 'r3', text: 'Branch only rule', outcome: 'MANAGER', locationId: 'b1', isActive: true },
        { id: 'r4', text: 'Turned off', outcome: 'MANAGER', locationId: null, isActive: false },
      ],
    };
    const rules = normaliseRules(raw);
    expect(rules.custom.find((c) => c.id === 'r2')?.outcome).toBe('NOTE');
    const e = referral({
      houseRuleMatches: [
        { ruleId: 'r1', reason: 'Two carers in Sutton.' },
        { ruleId: 'r2', reason: 'No summary.' },
        { ruleId: 'r3', reason: 'x' },
        { ruleId: 'r4', reason: 'x' },
        { ruleId: 'nope', reason: 'x' },
      ],
    });
    expect(keys(e, raw, 'b2')).toEqual(['rule:custom:r1=WARN', 'note:custom:r2=WARN']);
    expect(keys(e, raw, 'b1')).toEqual(['rule:custom:r1=WARN', 'note:custom:r2=WARN', 'rule:custom:r3=WARN']);
  });

  it('kinds of email: defaults, saved actions, and old emails', () => {
    const rules = normaliseRules({ kinds: { COMPLAINT: 'IGNORE', NEW_REFERRAL: 'BAD' } });
    expect(kindAction(rules, 'COMPLAINT')).toBe('IGNORE');
    expect(kindAction(rules, 'NEW_REFERRAL')).toBe('AUTO');
    expect(kindAction(rules, 'SAFEGUARDING_CONCERN')).toBe('STAFF');
    expect(kindAction(rules, 'JOB_APPLICATION')).toBe('IGNORE');
    expect(emailKindOf({ isReferral: true, requestType: 'PRICE_ENQUIRY', funding: { type: 'UNKNOWN', funderName: '', details: '' } })).toBe('PRICE_ENQUIRY');
    expect(emailKindOf({ isReferral: true, requestType: 'CARE_REFERRAL', funding: { type: 'PRIVATE', funderName: '', details: '' } })).toBe('PRIVATE_ENQUIRY');
    expect(emailKindOf({ isReferral: false, requestType: 'NOT_CARE', funding: { type: 'UNKNOWN', funderName: '', details: '' } })).toBe('OTHER');
  });

  it('bad saved values fall back to safe ones', () => {
    const r = normaliseRules({ rules: [{ key: 'earlyVisits', outcome: 'MANAGER', value: '25:00' }, { key: 'unknown', outcome: 'DECLINE' }, { key: 'hoist', outcome: 'MAYBE' }] });
    expect(r.rules).toEqual([{ key: 'earlyVisits', outcome: 'MANAGER', value: '07:00', locationId: null }]);
  });

  it('Claude’s care tags become the facts the rules use', () => {
    expect(
      careFlagsFromTags(['liveIn', 'Dementia', 'delegatedHealthcare: insulin', 'riskToStaff: large dog', 'medication: administer', 'age: 9', 'infection: MRSA', 'madeUp', 'liveIn']),
    ).toEqual({
      present: ['liveIn', 'dementia'],
      delegatedHealthcare: ['insulin'],
      complexClinical: [],
      medicationLevel: 'ADMINISTER',
      risksToStaff: ['large dog'],
      infectionControl: 'MRSA',
      ageYears: 9,
    });
  });

  it('written-rule matches come back as "id: reason" lines', () => {
    expect(houseRuleMatchesFrom(['r1: Two carers in Sutton.', '[r2]: No summary yet', 'nonsense'])).toEqual([
      { ruleId: 'r1', reason: 'Two carers in Sutton.' },
      { ruleId: 'r2', reason: 'No summary yet' },
    ]);
    expect(houseRuleMatchesFrom(undefined)).toEqual([]);
  });
});
