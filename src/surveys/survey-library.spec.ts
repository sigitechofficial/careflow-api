import { BadRequestException } from '@nestjs/common';
import { SurveyQuestionType } from '@prisma/client';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  expectedMinutes,
  fillOrganisation,
  isPersonFacing,
  mentionsAnonymity,
  minutesRange,
  ratedQuestions,
  scaleProblem,
  loadSurveyLibrary,
  questionLogicProblem,
  questionSettingsProblem,
  surveyDescription,
  surveyLogicProblems as libSurveyLogicProblems,
  surveyLibraryMeta,
  anonymousVariantOf,
  surveyQuestionRows,
  surveyScoringRow,
  validateLibrarySurvey,
  type LibrarySurvey,
  type LibrarySurveyQuestion,
} from '../../prisma/seed-lib/survey-library';
import { loadPolicyLibrary } from '../../prisma/seed-lib/policy-library';
import { seedSurveyLibrary } from '../../prisma/seeds/survey-library.seed';
import {
  normaliseQuestionLogic,
  normaliseQuestionSettings,
  surveyLogicProblems as apiSurveyLogicProblems,
} from './survey-question-config.util';

/* Fixtures live here (never in prisma/seed-data/survey-library). */

const POLICIES = new Set(['POL-CD-001', 'POL-GOV-001']);

const q = (over: Partial<LibrarySurveyQuestion> = {}): LibrarySurveyQuestion => ({
  text: 'Do your care workers arrive at the time agreed?',
  type: 'YES_NO',
  required: true,
  ...over,
});

const overallQuestion = (): LibrarySurveyQuestion =>
  q({
    text: 'Overall, how was your experience of our service?',
    type: 'SINGLE_SELECT',
    options: ['Very good', 'Good', 'Neither good nor poor', 'Poor', 'Very poor', "Don't know"],
    notCountedOptions: ["Don't know"],
  });
const contactMe = (): LibrarySurveyQuestion =>
  q({ text: 'Would you like someone to contact you about your answers?', type: 'YES_NO', required: false });

const survey = (over: Partial<LibrarySurvey> = {}): LibrarySurvey => ({
  reference: 'SUR-PWS-001',
  revision: 1,
  title: 'Annual satisfaction survey',
  audience: 'SERVICE_USER',
  respondents: 'People we support',
  summary: 'A yearly survey asking people we support how well their care meets their needs.',
  purpose: 'Shows whether people are happy with their care and where to improve.',
  timing: { when: 'Once a year, in the same month each year', recurrence: 'YEARLY', trigger: null },
  anonymous: false,
  channels: ['PORTAL', 'TELEPHONE', 'PAPER'],
  estimatedMinutes: 6,
  cqc: { keyQuestions: ['CARING', 'RESPONSIVE'], qualityStatements: ['Kindness, compassion and dignity'] },
  introduction:
    'Thank you for taking part. {{organisation}} wants to know what you think about the care and support you receive at home, ' +
    'so that we can keep doing what works and change what does not. It takes about five minutes. ' +
    'This survey is not for urgent concerns: if you need help now, phone the office.',
  privacyNotice:
    'We collect your answers to understand how well our care works for you. Only the managers who review feedback can see ' +
    'them. We keep the answers for two years and then delete them. Taking part is your choice and will never affect your care.',
  sections: [
    { title: 'Overall', questions: [overallQuestion()] },
    {
      title: 'Your visits',
      questions: [
        q({ evidence: 'Safe systems, pathways and transitions' }),
        q({ text: 'I am treated with dignity and respect.', type: 'LIKERT' }),
        q({ text: 'How would you rate your care overall?', type: 'RATING', config: { min: 1, max: 5 } }),
      ],
    },
    {
      title: 'Your say',
      questions: [
        q({ text: 'How do you usually contact the office?', type: 'SINGLE_SELECT', options: ['Phone', 'Email', 'Portal'] }),
        q({ text: 'Which parts of your care matter most to you?', type: 'MULTI_SELECT', options: ['Timing', 'Kindness', 'Continuity'] }),
        q({ text: 'Is there anything else you would like to tell us?', type: 'TEXTAREA', required: false }),
        // Named surveys end with it; an anonymous survey must not ask it.
        ...(over.anonymous ? [] : [contactMe()]),
      ],
    },
  ],
  managerGuidance: {
    howToRun: ['Send it through the portal and offer a phone call to anyone who prefers it.'],
    actingOnResults: ['Share a short summary of what you heard and what you will change.'],
    alerts: [{ when: 'Someone says they do not feel safe', action: 'Treat it as a safeguarding concern the same day.' }],
  },
  relatedPolicies: ['POL-CD-001'],
  regulatoryBasis: [{ source: 'Regulation 17(2)(e)', url: 'https://www.legislation.gov.uk/uksi/2014/2936/regulation/17' }],
  ...over,
});

const errorsOf = (s: unknown) => validateLibrarySurvey(s, 'x.json', { policyReferences: POLICIES }).join('\n');
const nQuestions = (n: number, extra: Partial<LibrarySurveyQuestion> = {}) =>
  Array.from({ length: n }, (_, i) =>
    i === 0 ? q({ text: 'Anything else?', type: 'TEXT', required: false }) : q({ text: `Question number ${i}?`, ...extra }),
  );
/** The fixture with one more question in "Your visits" (after the overall question, before the contact-me one). */
const withQuestion = (question: LibrarySurveyQuestion, over: Partial<LibrarySurvey> = {}) => {
  const base = survey(over);
  return {
    ...base,
    sections: base.sections.map((sec, i) => (i === 1 ? { ...sec, questions: [...sec.questions, question] } : sec)),
  };
};
const STAFF = { reference: 'SUR-STF-001', audience: 'EMPLOYEE' as const, channels: ['ONLINE' as const] };

describe('survey library validator', () => {
  it('checks a scored measure: question ids that score, asked of everyone, bands in order', () => {
    const scored = (scoring: unknown, extra: Partial<LibrarySurveyQuestion> = {}) =>
      withQuestion(q({ id: 'q-life', text: 'Do you feel well in yourself?', type: 'LIKERT', options: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'], ...extra }), {
        scoring,
      } as Partial<LibrarySurvey>);
    const good = { scales: [{ key: 'quality-of-life', label: 'Quality of life', questions: ['q-life'], bands: [{ from: 1, label: 'Low' }, { from: 4, label: 'High' }] }] };
    expect(errorsOf(scored(good))).toBe('');
    expect(surveyScoringRow(scored(good) as LibrarySurvey)).toEqual({
      scales: [{ key: 'quality-of-life', label: 'Quality of life', questionKeys: ['q-life'], reversed: [], method: 'MEAN', bands: [{ from: 1, label: 'Low' }, { from: 4, label: 'High' }] }],
    });
    const bad = { scales: [{ key: 'Bad Key', label: 'x', questions: ['q-missing', 'q-life'], reversed: ['q-other'], bands: [{ from: 4, label: 'High' }, { from: 1, label: 'Low' }] }] };
    expect(errorsOf(scored(bad))).toMatch(/key must be lower-case[\s\S]*"q-missing" is not a question id[\s\S]*reversed must list only questions on this scale[\s\S]*bands must go from the lowest/);
    expect(errorsOf(scored(good, { type: 'TEXT', options: undefined }))).toMatch(/"q-life" is TEXT; only/);
  });

  it('accepts a complete survey', () => {
    expect(validateLibrarySurvey(survey(), 'x.json', { policyReferences: POLICIES })).toEqual([]);
    expect(expectedMinutes(survey())).toBe(4);
    expect(ratedQuestions(survey())).toHaveLength(6);
  });

  it('requires the fields and a well-formed reference', () => {
    const { title: _t, purpose: _p, ...missing } = survey();
    expect(errorsOf(missing)).toMatch(/title is required[\s\S]*purpose is required/);
    expect(errorsOf(survey({ reference: 'SUR-XYZ-001' }))).toMatch(/reference must look like/);
    expect(errorsOf(survey({ reference: 'SUR-PWS-1' }))).toMatch(/reference must look like/);
    expect(errorsOf('nope')).toMatch(/not an object/);
  });

  it('checks the revision and its note', () => {
    expect(errorsOf(survey({ revision: 0 }))).toMatch(/revision must be a whole number/);
    expect(errorsOf(survey({ revision: 2 }))).toMatch(/revisionNote is required/);
    expect(errorsOf(survey({ revision: 2, revisionNote: 'Reworded the safety question' }))).toBe('');
  });

  it('checks the audience fits the group and the channels', () => {
    expect(errorsOf(survey({ audience: 'EMPLOYEE' }))).toMatch(/PWS survey's audience must be SERVICE_USER or PUBLIC/);
    expect(errorsOf(survey({ reference: 'SUR-STF-001', audience: 'EMPLOYEE' }))).toMatch(/only SERVICE_USER surveys can use the PORTAL/);
    expect(errorsOf(survey({ channels: ['FAX' as never] }))).toMatch(/unknown channel FAX/);
    expect(errorsOf(survey({ cqc: { keyQuestions: ['KIND' as never], qualityStatements: [] } }))).toMatch(/unknown CQC key question/);
  });

  it('accepts a public survey of people we support (an open form with a link or QR code), still person-facing', () => {
    const open = { audience: 'PUBLIC' as const, channels: ['ONLINE' as const, 'PAPER' as const] };
    expect(errorsOf(survey(open))).toBe('');
    expect(isPersonFacing(survey(open))).toBe(true);
    expect(errorsOf(survey({ ...open, sections: survey().sections.slice(1) }))).toMatch(/must start with a section/);
    expect(errorsOf(survey({ ...open, channels: ['ONLINE', 'PORTAL'] }))).toMatch(/only SERVICE_USER surveys can use the PORTAL/);
    expect(errorsOf(survey({ reference: 'SUR-STF-001', audience: 'PUBLIC', channels: ['ONLINE'] }))).toMatch(
      /STF survey's audience must be EMPLOYEE/,
    );
  });

  it('accepts inspection readiness surveys for any audience, with the longer question cap', () => {
    const many = (n: number) => [{ title: 'Questions', questions: nQuestions(n) }];
    const staffReview = { reference: 'SUR-CQC-002', audience: 'EMPLOYEE' as const, channels: ['ONLINE' as const] };
    // People we support answer the independent quality review: person-facing rules still apply.
    expect(errorsOf(survey({ reference: 'SUR-CQC-001' }))).toBe('');
    expect(isPersonFacing(survey({ reference: 'SUR-CQC-001' }))).toBe(true);
    expect(errorsOf(survey({ ...staffReview, sections: many(5), estimatedMinutes: 3 }))).toBe('');
    expect(errorsOf(survey({ reference: 'SUR-CQC-003', audience: 'PUBLIC', channels: ['ONLINE'] }))).toBe('');
    const sized = (over: Partial<LibrarySurvey>) => survey({ ...over, estimatedMinutes: expectedMinutes(over as LibrarySurvey) });
    expect(errorsOf(sized({ ...staffReview, sections: many(40) }))).toBe('');
    expect(errorsOf(survey({ reference: 'SUR-CQC-01' }))).toMatch(/reference must look like SUR-PWS-001 \(PWS, FAM, STF, PRO, CQC, ORG or APP\)/);
  });

  it('applies the question type rules', () => {
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: ['Only one'] })))).toMatch(/add at least two options/);
    expect(errorsOf(withQuestion(q({ type: 'YES_NO', options: ['Yes', 'No'] })))).toMatch(/options only apply to choice questions/);
    expect(errorsOf(withQuestion(q({ type: 'RATING', config: { min: 5, max: 1 } })))).toMatch(/highest score must be above/);
    expect(errorsOf(withQuestion(q({ type: 'TEXT', config: { min: 0, max: 10 } })))).toMatch(/settings only apply to rating/);
    expect(errorsOf(withQuestion(q({ type: 'SLIDER' as never })))).toMatch(/unknown question type SLIDER/);
  });

  it('needs at least one section, each with questions, and no upper limit', () => {
    expect(errorsOf(survey({ sections: [] }))).toMatch(/at least one section/);
    const twelve = Array.from({ length: 12 }, (_, i) => ({ title: `Part ${i + 1}`, questions: [q({ text: 'Anything else?', type: 'TEXT', required: false })] }));
    expect(errorsOf(survey({ sections: twelve }))).not.toMatch(/sections/);
    expect(errorsOf(survey({ sections: [{ title: 'Empty', questions: [] }] }))).toMatch(/section has no questions/);
  });

  it('sets no length limit: how many questions a survey needs is decided per survey at review', () => {
    // nQuestions(n): one optional written answer and n - 1 rated questions.
    const many = (n: number) => [{ title: 'Questions', questions: nQuestions(n) }];
    const sized = (over: Partial<LibrarySurvey>) => survey({ ...over, estimatedMinutes: expectedMinutes(over as LibrarySurvey) });
    expect(errorsOf(sized({ sections: many(40) }))).not.toMatch(/rated questions|at most/);
    expect(errorsOf(sized({ ...STAFF, sections: many(60) }))).not.toMatch(/rated questions|at most/);
    expect(errorsOf(sized({ ...STAFF, title: 'Monthly pulse', sections: many(20) }))).not.toMatch(/rated questions|at most/);
  });

  it('does not count optional written answers or the contact-me question as rated', () => {
    const rated = (n: number) => Array.from({ length: n }, (_, i) => q({ text: `Rated question ${i + 1}?`, type: 'LIKERT' }));
    const sections = (n: number) => [
      { title: 'Overall', questions: [overallQuestion()] },
      { title: 'Your care', questions: rated(n) },
      {
        title: 'Anything else',
        questions: [
          q({ text: 'What could we do better?', type: 'TEXTAREA', required: false }),
          q({ text: 'Anything else to add?', type: 'TEXT', required: false }),
          contactMe(),
        ],
      },
    ];
    const full = survey({ sections: sections(15) });
    expect(ratedQuestions(full)).toHaveLength(16);
    expect(errorsOf({ ...full, estimatedMinutes: expectedMinutes(full) })).toBe('');
    const longer = survey({ sections: sections(30) });
    expect(errorsOf({ ...longer, estimatedMinutes: expectedMinutes(longer) })).toBe('');
    // A required written answer is rated; the contact-me question only counts when it is not last.
    expect(ratedQuestions(survey({ sections: [{ title: 'A', questions: [q({ type: 'TEXT', text: 'Why?' })] }] }))).toHaveLength(1);
    expect(ratedQuestions(survey({ sections: [{ title: 'A', questions: [contactMe(), q()] }] }))).toHaveLength(2);
    // Only an optional YES_NO contact-me is left out; a required or differently typed one is rated.
    expect(ratedQuestions(survey({ sections: [{ title: 'A', questions: [q(), { ...contactMe(), required: true }] }] }))).toHaveLength(2);
    const asLikert = { ...contactMe(), type: 'LIKERT' as const };
    expect(ratedQuestions(survey({ sections: [{ title: 'A', questions: [q(), asLikert] }] }))).toHaveLength(2);
  });

  it('treats contact-me followed only by its own contact details (shown if Yes) as the closing question', () => {
    const asks = { ...contactMe(), id: 'q-contact-me' };
    const detail = (text: string, answers = ['Yes'], question = 'q-contact-me'): LibrarySurveyQuestion =>
      q({ text, type: 'TEXT', required: false, showIf: { question, answers } });
    const ending = (...after: LibrarySurveyQuestion[]) => {
      const base = survey();
      return survey({
        sections: base.sections.map((sec, i) => (i === 2 ? { ...sec, questions: [...sec.questions.slice(0, -1), asks, ...after] } : sec)),
      });
    };
    const withDetails = ending(detail('What name should we ask for?'), detail('What is the best phone number or email to reach you?'));
    expect(ratedQuestions(withDetails)).toHaveLength(6);
    expect(errorsOf(withDetails)).toBe('');
    // Anything else after it (a question always asked, one shown on "No", or one shown by another question) still counts it.
    const always = ending(q({ text: 'Anything else to add?', type: 'TEXT', required: false }));
    expect(ratedQuestions(always)).toHaveLength(7);
    expect(errorsOf(always)).toMatch(/must end with the optional YES_NO .*only its own contact-details questions/);
    expect(ratedQuestions(ending(detail('Why not?', ['No'])))).toHaveLength(7);
    expect(ratedQuestions(ending(detail('Your name?', ['Yes', 'No'])))).toHaveLength(7);
    // A required contact-details question (asked only on Yes) is itself rated; contact-me still is not.
    const requiredDetail = { ...detail('What is the best phone number or email to reach you?'), required: true };
    expect(ratedQuestions(ending(requiredDetail))).toHaveLength(7);
    expect(errorsOf(ending(requiredDetail))).toBe('');
    const other = { ...q({ text: 'Did you contact the office?', id: 'q-office' }) };
    const shownByOther = survey({
      sections: [survey().sections[0], { title: 'More', questions: [other, asks, detail('Which office?', ['Yes'], 'q-office')] }],
    });
    expect(ratedQuestions(shownByOther)).toHaveLength(3);
    // Without an id the details cannot refer to it, so it is not the closing question.
    const noId = survey({ sections: [survey().sections[0], { title: 'More', questions: [contactMe(), detail('Your name?')] }] });
    expect(ratedQuestions(noId)).toHaveLength(2);
  });

  it('accepts estimatedMinutes of at least the estimate, with no upper limit', () => {
    expect(minutesRange(survey())).toEqual([4, Number.POSITIVE_INFINITY]);
    expect(errorsOf(survey({ estimatedMinutes: 4 }))).toBe('');
    expect(errorsOf(survey({ estimatedMinutes: 30 }))).toBe('');
    expect(errorsOf(survey({ estimatedMinutes: 0 }))).toMatch(/estimatedMinutes must be a whole number of at least 1/);
    expect(errorsOf(survey({ estimatedMinutes: 3 }))).toMatch(/is less than the time 8 questions take \(estimate 4; at least 4\)/);
  });

  it('estimates minutes from 30 seconds reading, 12 a closed question, 40 a short and 75 a long answer', () => {
    const only = (...questions: LibrarySurveyQuestion[]) => ({ sections: [{ title: 'A', questions }] });
    const closed = (n: number) => Array.from({ length: n }, (_, i) => q({ text: `Closed ${i + 1}?` }));
    const text = q({ text: 'Anything else?', type: 'TEXT', required: false });
    const textarea = q({ text: 'Tell us more', type: 'TEXTAREA', required: false });
    expect(expectedMinutes(only(...closed(2)))).toBe(1); // 54 s
    expect(expectedMinutes(only(...closed(2), text))).toBe(2); // 94 s, rounded up
    // A short pulse: 6 closed and one comment is 177 s, so 3 minutes (allowed 3-7).
    expect(expectedMinutes(only(...closed(6), textarea))).toBe(3);
    expect(minutesRange(only(...closed(6), textarea))[0]).toBe(3);
    // 10 closed and one short answer: 190 s, so 4 minutes (the old 60 s / 15 s rule said 5).
    expect(expectedMinutes(only(...closed(10), text))).toBe(4);
    // No time limit: a long survey states its real length.
    expect(minutesRange(only(...closed(40), textarea, textarea))[0]).toBe(11);
    expect(minutesRange(only(...closed(90), textarea))[0]).toBe(20);
  });

  it('needs at least one optional free-text question', () => {
    const base = survey();
    const required = base.sections.map((s) => ({ ...s, questions: s.questions.map((x) => ({ ...x, required: true })) }));
    expect(errorsOf(survey({ sections: required }))).toMatch(/optional free-text question/);
  });

  it('keeps the introduction and privacy notice within the survey description limit', () => {
    const longPrivacy = Array.from({ length: 190 }, () => 'information').join(' ');
    expect(errorsOf(survey({ privacyNotice: longPrivacy }))).toMatch(/together are \d+ characters; at most 1800/);
  });

  it('checks the introduction and privacy notice', () => {
    expect(errorsOf(survey({ introduction: '{{organisation}} wants your views.' }))).toMatch(/introduction is 4 words; it must be 30–150/);
    const noOrg = survey().introduction.replace('{{organisation}}', 'We');
    expect(errorsOf(survey({ introduction: noOrg }))).toMatch(/never names the organisation/);
    expect(errorsOf(survey({ privacyNotice: 'We keep your answers safe.' }))).toMatch(/privacyNotice is 5 words; it must be 40–200/);
    expect(errorsOf(survey({ purpose: 'Ask {{name}} about care.' }))).toMatch(/unknown \{\{token\}\}/);
  });

  it('rejects placeholders, unfinished text and HTML anywhere', () => {
    expect(errorsOf(survey({ summary: 'A yearly survey asking [service users] how well their care meets their needs.' }))).toMatch(/square-bracket/);
    expect(errorsOf(survey({ purpose: 'TBC once the manager has decided.' }))).toMatch(/unfinished marker/);
    expect(errorsOf(withQuestion(q({ text: 'TODO: ask about meals?' })))).toMatch(/unfinished marker/);
    expect(errorsOf(withQuestion(q({ text: 'Insert name of the care worker here?', type: 'TEXT', required: false })))).toMatch(/placeholder text/);
    expect(errorsOf(survey({ purpose: 'Lorem ipsum dolor sit amet.' }))).toMatch(/placeholder text/);
    expect(errorsOf(withQuestion(q({ text: 'Are you <b>happy</b>?' })))).toMatch(/HTML markup/);
  });

  it('keeps the word "template" away from respondents only', () => {
    expect(errorsOf(withQuestion(q({ text: 'Was the care plan template easy to follow?' })))).toMatch(/respondents would see the word "template"/);
    const guidance = { ...survey().managerGuidance, howToRun: ['Adopt this as a template and send it in March.'] };
    expect(errorsOf(survey({ managerGuidance: guidance }))).toBe('');
  });

  it('keeps questions short and asking one thing', () => {
    const long = Array.from({ length: 26 }, () => 'word').join(' ');
    expect(errorsOf(withQuestion(q({ text: `${long}?` })))).toMatch(/question over 25 words/);
    expect(errorsOf(withQuestion(q({ text: 'Do you feel safe and/or comfortable?' })))).toMatch(/"and\/or"/);
  });

  it('stops anonymous surveys asking who the person is', () => {
    const anon = { anonymous: true };
    expect(errorsOf(withQuestion(q({ text: 'What is your name?', type: 'TEXT', required: false }), anon))).toMatch(/must not ask for a name/);
    expect(errorsOf(withQuestion(q({ text: 'What is your date of birth?', type: 'TEXT', required: false }), anon))).toMatch(/date of birth/);
    expect(errorsOf(withQuestion(q({ text: 'Your phone number', type: 'TEXT', required: false }), anon))).toMatch(/phone number/);
    expect(errorsOf(withQuestion(q({ text: 'Your home address', type: 'TEXTAREA', required: false }), anon))).toMatch(/address/);
    expect(errorsOf(withQuestion(q({ text: 'What is your email address?', type: 'TEXT', required: false }), anon))).toMatch(/email address/);
    expect(errorsOf(withQuestion(q({ text: 'What is your NHS number?', type: 'NUMBER', required: false }), anon))).toMatch(/NHS number/);
    expect(errorsOf(withQuestion(q({ text: 'What is your staff number?', type: 'NUMBER', required: false }), anon))).toMatch(/staff number/);
    // Asking about names in a closed question, or telling people not to give one, is fine.
    expect(errorsOf(withQuestion(q({ text: 'Do care workers use the name you prefer?' }), anon))).toBe('');
    expect(errorsOf(withQuestion(q({ text: 'Please do not include your name in this comment.', type: 'TEXTAREA', required: false }), anon))).toBe('');
    // Named surveys may ask for contact details.
    expect(errorsOf(withQuestion(q({ text: 'What is your phone number?', type: 'TEXT', required: false })))).toBe('');
  });

  it('checks related policies and sources', () => {
    expect(errorsOf(survey({ relatedPolicies: ['POL-XX-999'] }))).toMatch(/POL-XX-999 is not in the policy library/);
    expect(errorsOf(survey({ relatedPolicies: ['Safeguarding'] }))).toMatch(/must look like POL-XX-001/);
    expect(errorsOf(survey({ regulatoryBasis: [{ source: 'Reg 17', url: 'http://example.org' }] }))).toMatch(/https URL/);
    expect(errorsOf(survey({ regulatoryBasis: [] }))).toMatch(/at least one legislation/);
  });

  it('starts person-facing surveys with the overall question', () => {
    const noOverall = survey({ sections: survey().sections.slice(1) });
    expect(errorsOf(noOverall)).toMatch(/must start with a section whose first question is "Overall, how was your experience of our service\?"/);
    const wrongOptions = survey({
      sections: [{ title: 'Overall', questions: [{ ...overallQuestion(), options: ['Very good', 'Good', 'Poor', 'Very poor'], notCountedOptions: undefined }] }, ...survey().sections.slice(1)],
    });
    expect(errorsOf(wrongOptions)).toMatch(/must start with a section/);
    // Public surveys for families need it too; staff and professionals do not.
    expect(errorsOf(survey({ reference: 'SUR-FAM-001', audience: 'PUBLIC', channels: ['ONLINE'], sections: noOverall.sections }))).toMatch(
      /must start with a section/,
    );
    expect(isPersonFacing({ reference: 'SUR-PRO-001', audience: 'PUBLIC' })).toBe(false);
    expect(errorsOf(survey({ ...STAFF, sections: noOverall.sections }))).toBe('');
  });

  it('allows only the standard answer scales', () => {
    expect(errorsOf(withQuestion(q({ type: 'LIKERT', options: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'] })))).toBe('');
    expect(
      errorsOf(withQuestion(q({ type: 'LIKERT', options: ['Strongly agree', 'Agree', 'Neither agree nor disagree', 'Disagree', 'Strongly disagree'] }))),
    ).toBe('');
    expect(errorsOf(withQuestion(q({ type: 'LIKERT', options: ['Always', 'Often', 'Never'] })))).toMatch(/custom LIKERT labels must be one of the standard scales/);
    expect(errorsOf(withQuestion(q({ type: 'LIKERT', options: ['Never', 'Rarely', 'Sometimes', 'Usually', 'Always'] })))).toMatch(/standard scales/);
    const scale = ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'];
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: [...scale, 'Does not apply to me'], notCountedOptions: ['Does not apply to me'] })))).toBe('');
    expect(
      errorsOf(
        withQuestion(
          q({ type: 'SINGLE_SELECT', options: [...scale, 'Does not apply to me', "Don't know"], notCountedOptions: ['Does not apply to me', "Don't know"] }),
        ),
      ),
    ).toBe('');
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: [...scale, 'Not sure'] })))).toMatch(/then only "Does not apply to me" or "Don't know" at the end/);
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: ["Don't know", ...scale], notCountedOptions: ["Don't know"] })))).toMatch(/in that order/);
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: ['Always', 'Sometimes', 'Never'] })))).toMatch(/in that order/);
    // Choices that are not a scale are free.
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: ['Phone', 'Email', 'Good question'] })))).toBe('');
    expect(scaleProblem({ type: 'MULTI_SELECT', options: ['Never', 'Always', 'Rarely'] })).toBeNull();
  });

  it('tells people and staff the survey is not for urgent concerns', () => {
    const intro = survey().introduction.replace(/This survey is not for urgent concerns[^.]*\./, 'Thank you.');
    expect(errorsOf(survey({ introduction: intro }))).toMatch(/the introduction must say "This survey is not for urgent concerns"/);
    expect(errorsOf(survey({ ...STAFF, introduction: intro }))).toMatch(/not for urgent concerns/);
    const partners = { reference: 'SUR-PRO-001', audience: 'PUBLIC' as const, channels: ['ONLINE' as const], sections: survey().sections.slice(1) };
    expect(errorsOf(survey({ ...partners, introduction: intro }))).toBe('');
  });

  it('ends a named person-facing survey with the optional contact-me question', () => {
    const base = survey();
    const withoutContact = base.sections.map((sec, i) => (i === 2 ? { ...sec, questions: sec.questions.slice(0, -1) } : sec));
    expect(errorsOf(survey({ sections: withoutContact }))).toMatch(/a named survey must end with the optional YES_NO "Would you like someone to contact you/);
    const requiredContact = base.sections.map((sec, i) =>
      i === 2 ? { ...sec, questions: [...sec.questions.slice(0, -1), { ...contactMe(), required: true }] } : sec,
    );
    expect(errorsOf(survey({ sections: requiredContact }))).toMatch(/must end with the optional YES_NO/);
    // Anonymous surveys and staff surveys do not need it.
    expect(errorsOf(survey({ anonymous: true, sections: withoutContact }))).toBe('');
    expect(errorsOf(survey({ ...STAFF, sections: withoutContact }))).toBe('');
    // …and an anonymous survey must not ask it (nobody could be contacted).
    expect(errorsOf(withQuestion(contactMe(), { anonymous: true }))).toMatch(/an anonymous survey must not ask "Would you like someone to contact you/);
  });

  it('never calls a named survey anonymous', () => {
    expect(mentionsAnonymity('Your answers are anonymous.')).toBe(true);
    expect(mentionsAnonymity('You can answer anonymously.')).toBe(true);
    expect(mentionsAnonymity('This survey is not anonymous: your name is kept.')).toBe(false);
    expect(mentionsAnonymity('Telephone answers cannot be anonymous.')).toBe(false);
    const privacy = `${survey().privacyNotice} Your answers are anonymous.`;
    expect(errorsOf(survey({ privacyNotice: privacy }))).toMatch(/a named survey must not call itself anonymous/);
    expect(errorsOf(withQuestion(q({ text: 'Anything else?', type: 'TEXT', required: false, helpText: 'This is anonymous.' })))).toMatch(
      /must not call itself anonymous/,
    );
    expect(errorsOf(survey({ privacyNotice: `${survey().privacyNotice} This survey is not anonymous.` }))).toBe('');
    expect(errorsOf(survey({ anonymous: true, privacyNotice: privacy }))).toBe('');
  });

  it('builds the stored rows: sections on questions, description and metadata', () => {
    const rows = surveyQuestionRows(survey());
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(rows.map((r) => r.sectionTitle)).toEqual([
      'Overall',
      'Your visits',
      'Your visits',
      'Your visits',
      'Your say',
      'Your say',
      'Your say',
      'Your say',
    ]);
    expect(rows[3].config).toEqual({ min: 1, max: 5 });
    expect(rows[1].options).toBeNull();
    expect(surveyDescription(survey())).toMatch(/phone the office\.\n\nWe collect your answers/);
    const meta = surveyLibraryMeta(survey(), { code: 'PEOPLE_WE_SUPPORT', short: 'PWS', name: 'People we support', displayOrder: 10, researchedOn: '2026-11-05' });
    expect(meta.sections[1]).toEqual({ title: 'Your visits', questionCount: 3, evidence: ['Safe systems, pathways and transitions'] });
    expect(fillOrganisation('{{organisation}} cares.', 'Allfor Care & Co')).toBe('Allfor Care & Co cares.');
  });
});

describe('survey library: letting people answer without their name', () => {
  const offering = (over: Partial<LibrarySurvey> = {}) =>
    survey({
      allowAnonymousResponses: true,
      privacyNotice: `${survey().privacyNotice} You can answer without your name online; we then cannot reply to you.`,
      ...over,
    });

  it('is optional and defaults to off', () => {
    expect(survey().allowAnonymousResponses).toBeUndefined();
    expect(errorsOf(survey())).toBe('');
    expect(errorsOf(offering())).toBe('');
    expect(errorsOf(survey({ allowAnonymousResponses: false }))).toBe('');
  });

  it('must be true or false, on named surveys only, and the privacy notice must offer it', () => {
    expect(errorsOf(survey({ allowAnonymousResponses: 'yes' as unknown as boolean }))).toMatch(
      /allowAnonymousResponses must be true or false/,
    );
    expect(errorsOf(offering({ anonymous: true }))).toMatch(/allowAnonymousResponses is for named surveys only/);
    expect(errorsOf(survey({ allowAnonymousResponses: true }))).toMatch(
      /the privacy notice must tell people they can answer without their name/,
    );
  });

  it('is seeded onto the catalogue survey and compared on every deploy', async () => {
    const group = { code: 'PEOPLE_WE_SUPPORT', short: 'PWS' as const, name: 'People we support', displayOrder: 10, researchedOn: '2026-11-05' };
    const created: any[] = [];
    const prisma: any = {
      survey: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => created.push(args.data)),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    await seedSurveyLibrary(prisma, [{ group, surveys: [offering(), survey({ reference: 'SUR-PWS-002' })] }], {});
    expect(created.map((d) => d.allowAnonymousResponses)).toEqual([true, false]);

    // A catalogue survey that does not allow it yet is updated.
    const stored = { ...created[0], id: 'lib-1', allowAnonymousResponses: false, deletedAt: null, questions: [] };
    const update = jest.fn(async () => ({}));
    const prisma2: any = {
      survey: { findFirst: jest.fn(async () => stored), update, updateMany: jest.fn(async () => ({ count: 0 })) },
      surveyQuestion: { deleteMany: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    };
    const res = await seedSurveyLibrary(prisma2, [{ group, surveys: [offering()] }], {});
    expect(res.updated).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ allowAnonymousResponses: true }) }));
  });

  it('every deploy: refreshes (and restores) catalogue rows only — an organisation’s adopted templates are never touched', async () => {
    const group = { code: 'PEOPLE_WE_SUPPORT', short: 'PWS' as const, name: 'People we support', displayOrder: 10, researchedOn: '2026-11-05' };
    const rows: any[] = [
      { id: 'cat-1', isCatalogue: true, isTemplate: true, libraryReference: 'SUR-PWS-001', title: 'Old', deletedAt: new Date('2026-10-01'), questions: [] },
      { id: 'cat-gone', isCatalogue: true, isTemplate: true, libraryReference: 'SUR-PWS-099', title: 'Retired', deletedAt: null, questions: [] },
      // Adopted from the library (same reference), then edited, or deleted, by the organisation.
      { id: 'own-1', isCatalogue: false, isTemplate: true, libraryReference: 'SUR-PWS-001', librarySourceId: 'cat-1', title: 'Our wording', deletedAt: null, questions: [] },
      { id: 'own-2', isCatalogue: false, isTemplate: true, libraryReference: 'SUR-PWS-099', librarySourceId: 'cat-gone', title: 'Kept', deletedAt: new Date('2026-09-01'), questions: [] },
    ];
    const own = JSON.stringify(rows.filter((r) => !r.isCatalogue));
    const matches = (r: any, where: any) =>
      Object.entries(where).every(([k, v]: [string, any]) =>
        v && typeof v === 'object' && !(v instanceof Date) ? ('notIn' in v ? !v.notIn.includes(r[k]) : true) : r[k] === v,
      );
    const writes: any[] = [];
    const prisma: any = {
      survey: {
        findFirst: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
        create: jest.fn(async ({ data }: any) => rows.push({ id: 'cat-new', ...data })),
        update: jest.fn(async ({ where, data }: any) => {
          writes.push(where);
          const { questions: _q, ...rest } = data;
          Object.assign(rows.find((r) => r.id === where.id), rest);
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          writes.push(where);
          const hit = rows.filter((r) => matches(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
      },
      surveyQuestion: { deleteMany: jest.fn(async ({ where }: any) => writes.push(where)) },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    };
    const res = await seedSurveyLibrary(prisma, [{ group, surveys: [survey()] }], {});
    expect(res).toMatchObject({ created: 0, updated: 1, retired: 1 });
    // The catalogue row is refreshed and back in the library; the one no longer in it is retired.
    expect(rows.find((r) => r.id === 'cat-1')).toMatchObject({ title: 'Annual satisfaction survey', deletedAt: null });
    expect(rows.find((r) => r.id === 'cat-gone')!.deletedAt).toBeInstanceOf(Date);
    // Adopted templates: exactly as they were.
    expect(JSON.stringify(rows.filter((r) => !r.isCatalogue))).toBe(own);
    // Every read and write was aimed at catalogue rows only.
    expect(prisma.survey.findFirst.mock.calls.every((c: any) => c[0].where.isCatalogue === true)).toBe(true);
    for (const w of writes) {
      if ('id' in w) expect(w.id).toBe('cat-1');
      else if ('surveyId' in w) expect(w.surveyId).toBe('cat-1');
      else expect(w.isCatalogue).toBe(true);
    }
  });

  it('the annual survey of people we support offers it, and says so in its privacy notice', () => {
    const pws003 = loadSurveyLibrary()
      .flatMap((f) => f.surveys)
      .find((s) => s.reference === 'SUR-PWS-003');
    expect(pws003).toBeDefined();
    expect(pws003!.anonymous).toBe(false);
    expect(pws003!.allowAnonymousResponses).toBe(true);
    expect(pws003!.privacyNotice).toMatch(/To answer without your name, choose this online/);
    // Not yet released, so still revision 1 (no revision note).
    expect(pws003!.revision).toBe(1);
    expect(pws003!.revisionNote).toBeUndefined();
    expect(validateLibrarySurvey(pws003, 'SUR-PWS-003.json')).toEqual([]);
  });
});

describe('survey library question rules agree with the API', () => {
  const T = SurveyQuestionType;
  const apiAccepts = (type: SurveyQuestionType, options: unknown, config: unknown) => {
    try {
      normaliseQuestionSettings(type, options, config, 'Q');
      return true;
    } catch (err) {
      if (err instanceof BadRequestException) return false;
      throw err;
    }
  };
  it.each([
    [T.SINGLE_SELECT, ['Yes', 'No'], undefined],
    [T.SINGLE_SELECT, ['Yes'], undefined],
    [T.MULTI_SELECT, ['A', 'a'], undefined],
    [T.MULTI_SELECT, undefined, undefined],
    [T.MULTI_SELECT, ['A', '  '], undefined],
    [T.LIKERT, undefined, undefined],
    [T.LIKERT, ['Agree', 'Disagree'], undefined],
    [T.LIKERT, ['Agree'], undefined],
    [T.YES_NO, ['Yes', 'No'], undefined],
    [T.YES_NO, [], {}],
    [T.TEXT, undefined, { min: 0, max: 10 }],
    [T.RATING, undefined, undefined],
    [T.RATING, undefined, { min: 1, max: 5 }],
    [T.RATING, undefined, { min: 5, max: 5 }],
    [T.RATING, undefined, { min: 0, max: 101 }],
    [T.RATING, undefined, { min: 0.5, max: 5 }],
    [T.RATING, undefined, { min: 0, max: 5, step: 1 }],
    [T.NUMBER, undefined, undefined],
    // Answers not counted in percentages (choice and scale questions only).
    [T.SINGLE_SELECT, ['Yes', 'No', "Don't know"], { notCountedOptions: ["Don't know"] }],
    [T.SINGLE_SELECT, ['Yes', 'No', "Don't know"], { notCountedOptions: [] }],
    [T.SINGLE_SELECT, ['Yes', 'No'], { notCountedOptions: ['Maybe'] }],
    [T.SINGLE_SELECT, ['Yes', 'No'], { notCountedOptions: ['Yes', 'No'] }],
    [T.MULTI_SELECT, ['A', 'B', 'Prefer not to say'], { notCountedOptions: ['Prefer not to say'] }],
    [T.MULTI_SELECT, ['A', 'B'], { notCountedOptions: ['A'], other: 1 }],
    [T.LIKERT, undefined, { notCountedOptions: ['Disagree'] }],
    [T.LIKERT, ['Always', 'Never'], { notCountedOptions: ['Sometimes'] }],
    [T.YES_NO, undefined, { notCountedOptions: ['No'] }],
    [T.RATING, undefined, { notCountedOptions: ['1'] }],
  ])('%s with options %j and config %j', (type, options, config) => {
    expect(questionSettingsProblem(type, options, config) === null).toBe(apiAccepts(type, options, config));
  });
});

describe('survey library: answers not counted in percentages', () => {
  const scale = ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'];
  it('a standard opt-out answer must be marked not counted', () => {
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: [...scale, "Don't know"] })))).toMatch(
      /mark "Don't know" in notCountedOptions \(left out of percentages\)/,
    );
    expect(
      errorsOf(withQuestion(q({ type: 'MULTI_SELECT', options: ['Washing', 'Meals', 'Prefer not to say'], notCountedOptions: ['Prefer not to say'] }))),
    ).toBe('');
  });

  it('only answers the question has, and never all of them', () => {
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: [...scale], notCountedOptions: ['Maybe'] })))).toMatch(
      /"Maybe" is marked not counted, but it is not one of the answers/,
    );
    expect(errorsOf(withQuestion(q({ type: 'SINGLE_SELECT', options: ['Phone', 'Email'], notCountedOptions: ['Phone', 'Email'] })))).toMatch(
      /at least one answer must be counted/,
    );
  });

  it('are stored in the question config', () => {
    const rows = surveyQuestionRows(survey());
    expect(rows[0]!.config).toEqual({ notCountedOptions: ["Don't know"] });
  });

  it('SUR-PWS-003 marks every “Don’t know” and “Does not apply to me”', () => {
    const pws003 = loadSurveyLibrary()
      .flatMap((f) => f.surveys)
      .find((x) => x.reference === 'SUR-PWS-003')!;
    const marked = surveyQuestionRows(pws003).filter((r) => r.config && 'notCountedOptions' in r.config);
    expect(marked.map((r) => (r.config as { notCountedOptions: string[] }).notCountedOptions)).toEqual([
      ["Don't know"],
      ['Does not apply to me'],
      ['Does not apply to me'],
      ["Don't know"],
      ['Does not apply to me'],
      ["Don't know"],
    ]);
  });
});

describe('survey library loader', () => {
  let dir: string;
  const group = { code: 'PEOPLE_WE_SUPPORT', name: 'People we support', researchedOn: '2026-11-05', displayOrder: 10 };
  const write = (folder: string, name: string, value: unknown) => {
    mkdirSync(join(dir, folder), { recursive: true });
    writeFileSync(join(dir, folder, name), typeof value === 'string' ? value : JSON.stringify(value));
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'survey-library-'));
    write('people-we-support', 'group.json', group);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const load = (partial = false) => loadSurveyLibrary(dir, { partial, policyReferences: POLICIES });

  it('loads valid surveys by group', () => {
    write('people-we-support', 'SUR-PWS-001.json', survey());
    const files = load();
    expect(files).toHaveLength(1);
    expect(files[0].group).toMatchObject({ short: 'PWS', name: 'People we support' });
    expect(files[0].surveys.map((s) => s.reference)).toEqual(['SUR-PWS-001']);
  });

  it('rejects a file named differently, a survey in the wrong group and a reference used twice', () => {
    write('people-we-support', 'SUR-PWS-002.json', survey());
    expect(() => load()).toThrow(/file name must match the reference/);
    rmSync(join(dir, 'people-we-support', 'SUR-PWS-002.json'));
    write('people-we-support', 'SUR-FAM-001.json', survey({ reference: 'SUR-FAM-001' }));
    expect(() => load()).toThrow(/must have a SUR-PWS- reference/);
    rmSync(join(dir, 'people-we-support', 'SUR-FAM-001.json'));
    write('people-we-support', 'SUR-PWS-001.json', survey());
    write('families-and-representatives', 'group.json', { ...group, code: 'FAMILIES_AND_REPRESENTATIVES', name: 'Families', displayOrder: 20 });
    write('families-and-representatives', 'SUR-PWS-001.json', survey());
    expect(() => load()).toThrow(/SUR-PWS-001: used twice|must have a SUR-FAM- reference/);
  });

  it('rejects a missing or unknown group.json and invalid JSON', () => {
    write('mystery', 'SUR-PWS-001.json', survey());
    expect(() => load()).toThrow(/mystery: group.json is missing/);
    write('mystery', 'group.json', { ...group, code: 'MYSTERY' });
    expect(() => load()).toThrow(/mystery\/group.json: code/);
    rmSync(join(dir, 'mystery'), { recursive: true });
    write('people-we-support', 'SUR-PWS-001.json', '{ not json');
    expect(() => load()).toThrow(/not valid JSON/);
  });

  it('partial mode skips unfinished files with a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    write('people-we-support', 'SUR-PWS-001.json', survey());
    write('people-we-support', 'SUR-PWS-002.json', survey({ reference: 'SUR-PWS-002', title: '' }));
    expect(() => load()).toThrow(/title is required/);
    const files = load(true);
    expect(files[0].surveys.map((s) => s.reference)).toEqual(['SUR-PWS-001']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped people-we-support/SUR-PWS-002.json'));
    warn.mockRestore();
  });

  it('partial mode reports the skipped references, and the seed keeps them instead of retiring them', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    write('people-we-support', 'SUR-PWS-001.json', survey());
    write('people-we-support', 'SUR-PWS-002.json', survey({ reference: 'SUR-PWS-002', title: '' }));
    write('people-we-support', 'SUR-PWS-003.json', '{ not json');
    const skipped: string[] = [];
    const files = loadSurveyLibrary(dir, { partial: true, policyReferences: POLICIES, skipped });
    expect(skipped).toEqual(['SUR-PWS-002', 'SUR-PWS-003']);
    warn.mockRestore();

    const updateMany = jest.fn(async (_args: any) => ({ count: 0 }));
    const prisma: any = {
      survey: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), updateMany },
    };
    await seedSurveyLibrary(prisma, files, {}, { keep: skipped });
    expect(updateMany.mock.calls[0]![0].where.libraryReference.notIn).toEqual(['SUR-PWS-001', 'SUR-PWS-002', 'SUR-PWS-003']);
    // A full run (nothing kept) still retires what is no longer in the library.
    updateMany.mockClear();
    await seedSurveyLibrary(prisma, files, {});
    expect(updateMany.mock.calls[0]![0].where.libraryReference.notIn).toEqual(['SUR-PWS-001']);
  });

  it('a full load never fills skipped', () => {
    write('people-we-support', 'SUR-PWS-001.json', survey());
    const skipped: string[] = [];
    loadSurveyLibrary(dir, { policyReferences: POLICIES, skipped });
    expect(skipped).toEqual([]);
  });

  it('checks related policies against the policy library by default', () => {
    const [first] = loadPolicyLibrary(undefined, { partial: true })[0].documents;
    write('people-we-support', 'SUR-PWS-001.json', survey({ relatedPolicies: [first.reference] }));
    expect(loadSurveyLibrary(dir)[0].surveys).toHaveLength(1);
    write('people-we-support', 'SUR-PWS-001.json', survey({ relatedPolicies: ['POL-ZZ-999'] }));
    expect(() => loadSurveyLibrary(dir)).toThrow(/POL-ZZ-999 is not in the policy library/);
  });

  it('loads the inspection readiness group and keeps its surveys in it', () => {
    write('inspection-readiness', 'group.json', {
      code: 'INSPECTION_READINESS',
      name: 'Inspection readiness',
      researchedOn: '2026-11-05',
      displayOrder: 45,
    });
    write('inspection-readiness', 'SUR-CQC-001.json', survey({ reference: 'SUR-CQC-001' }));
    const files = load();
    expect(files.map((f) => f.group.short)).toEqual(['PWS', 'CQC']);
    expect(files[1].surveys.map((s) => s.reference)).toEqual(['SUR-CQC-001']);
    write('inspection-readiness', 'SUR-PWS-002.json', survey({ reference: 'SUR-PWS-002' }));
    expect(() => load()).toThrow(/a survey in Inspection readiness must have a SUR-CQC- reference/);
  });

  it('ships a library with the seven groups that loads', () => {
    const files = loadSurveyLibrary(undefined, { partial: true });
    expect(files.map((f) => [f.group.short, f.group.name, f.group.displayOrder])).toEqual([
      ['PWS', 'People we support', 10],
      ['FAM', 'Families and representatives', 20],
      ['STF', 'Staff', 30],
      ['PRO', 'Professionals and partners', 40],
      ['CQC', 'Inspection readiness', 45],
      ['ORG', 'Organisation-wide', 50],
      ['APP', 'Job applicants', 60],
    ]);
    const refs = files.flatMap((f) => f.surveys.map((s) => s.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe('survey library: Other, comment boxes, clearing answers and show-if', () => {
  const office = (): LibrarySurveyQuestion =>
    q({
      id: 'q-office-contact',
      text: 'Have you contacted the office in the last three months?',
      type: 'YES_NO',
    });
  const officeHelpful = (over: Partial<LibrarySurveyQuestion> = {}): LibrarySurveyQuestion =>
    q({
      text: 'How often did the office sort things out?',
      type: 'SINGLE_SELECT',
      options: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'],
      comment: { prompt: 'Please tell us why', showWhen: ['Rarely', 'Never'] },
      showIf: { question: 'q-office-contact', answers: ['Yes'] },
      ...over,
    });
  const help = (over: Partial<LibrarySurveyQuestion> = {}): LibrarySurveyQuestion =>
    q({
      text: 'Which help do you get from us?',
      type: 'MULTI_SELECT',
      options: ['Washing', 'Meals', 'None of these'],
      otherOption: { label: 'Other (please tell us)', textPrompt: 'Please tell us' },
      exclusiveOptions: ['None of these'],
      ...over,
    });
  const withQuestions = (...questions: LibrarySurveyQuestion[]) => {
    const base = survey();
    return {
      ...base,
      sections: base.sections.map((sec, i) => (i === 1 ? { ...sec, questions: [...sec.questions, ...questions] } : sec)),
    };
  };

  it('accepts them and maps them into the stored question rows', () => {
    const s = withQuestions(office(), officeHelpful(), help());
    expect(errorsOf(s)).toBe('');
    const rows = surveyQuestionRows(s);
    const byText = (t: string) => rows.find((r) => r.questionText.startsWith(t))!;
    expect(rows[0].key).toBe('q1');
    expect(byText('Have you contacted').key).toBe('q-office-contact');
    expect(byText('How often did the office')).toMatchObject({
      commentConfig: { prompt: 'Please tell us why', showWhen: ['Rarely', 'Never'] },
      showIf: { questionKey: 'q-office-contact', answers: ['Yes'] },
      otherOption: null,
    });
    expect(byText('Which help')).toMatchObject({
      otherOption: { label: 'Other (please tell us)', textPrompt: 'Please tell us', textRequired: true },
      exclusiveOptions: ['None of these'],
      commentConfig: null,
      showIf: null,
    });
  });

  it.each([
    ['a show-if on an unknown id', [officeHelpful()], /refers to a question that is not in this survey/],
    ['a show-if on a later question', [officeHelpful(), office()], /must refer to an earlier question/],
    ['a show-if answer the question cannot have', [office(), officeHelpful({ showIf: { question: 'q-office-contact', answers: ['Maybe'] } })], /"Maybe" is not one of the answers/],
    ['a comment after an answer that does not exist', [help({ comment: { showWhen: ['Often'] } })], /not one of this question's answers/],
    ['a comment on a written answer', [q({ text: 'Tell us more?', type: 'TEXT', required: false, comment: { prompt: 'More' } })], /does not apply to written-answer/],
    ['Other on a yes / no', [q({ otherOption: { label: 'Other', textPrompt: 'Say' } })], /only applies to single and multiple choice/],
    ['an empty Other', [help({ otherOption: {} as any })], /otherOption must give a label and a textPrompt/],
    ['a clearing answer that is not an option', [help({ exclusiveOptions: ['Nothing'] })], /not one of the options/],
    ['a clearing answer on single choice', [q({ type: 'SINGLE_SELECT', options: ['A', 'B'], exclusiveOptions: ['A'] })], /only multiple choice/],
    ['an id that looks generated', [q({ id: 'q3' })], /kept for questions without an id/],
    ['an id with spaces', [q({ id: 'office contact' })], /id must be letters/],
    ['two questions with one id', [office(), office()], /share the id "q-office-contact"/],
    ['a show-if without answers', [office(), officeHelpful({ showIf: { question: 'q-office-contact' } as any })], /needs an earlier question/],
  ])('rejects %s', (_label, questions, message) => {
    expect(errorsOf(withQuestions(...questions))).toMatch(message);
  });

  it('checks Other labels and prompts like other respondent text', () => {
    expect(errorsOf(withQuestions(help({ otherOption: { label: 'Other [specify]', textPrompt: 'Say' } })))).toMatch(
      /square-bracket placeholder/,
    );
  });

  it('the loader keeps the settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'survey-library-logic-'));
    try {
      mkdirSync(join(dir, 'people-we-support'), { recursive: true });
      writeFileSync(
        join(dir, 'people-we-support', 'group.json'),
        JSON.stringify({ code: 'PEOPLE_WE_SUPPORT', name: 'People we support', researchedOn: '2026-11-05', displayOrder: 10 }),
      );
      writeFileSync(join(dir, 'people-we-support', 'SUR-PWS-001.json'), JSON.stringify(withQuestions(office(), officeHelpful(), help())));
      const [file] = loadSurveyLibrary(dir, { policyReferences: POLICIES });
      const rows = surveyQuestionRows(file.surveys[0]);
      expect(rows.filter((r) => r.showIf).map((r) => r.showIf)).toEqual([{ questionKey: 'q-office-contact', answers: ['Yes'] }]);
      expect(rows.filter((r) => r.exclusiveOptions).map((r) => r.exclusiveOptions)).toEqual([['None of these']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('survey library logic rules agree with the API', () => {
  const T = SurveyQuestionType;
  const apiAccepts = (type: SurveyQuestionType, options: unknown, config: unknown, logic: Record<string, unknown>) => {
    try {
      normaliseQuestionLogic(type, options, config, logic, 'Q');
      return true;
    } catch (err) {
      if (err instanceof BadRequestException) return false;
      throw err;
    }
  };
  const choice = ['Always', 'Rarely', 'Never'];
  it.each([
    [T.SINGLE_SELECT, choice, null, { otherOption: { label: 'Other', textPrompt: 'Say' } }],
    [T.SINGLE_SELECT, choice, null, { otherOption: {} }],
    [T.SINGLE_SELECT, choice, null, { otherOption: { label: 'never' } }],
    [T.SINGLE_SELECT, choice, null, { otherOption: { label: '' } }],
    [T.SINGLE_SELECT, choice, null, { otherOption: { textRequired: 'yes' } }],
    [T.SINGLE_SELECT, choice, null, { otherOption: { extra: 1 } }],
    [T.SINGLE_SELECT, choice, null, { otherOption: 'Other' }],
    [T.LIKERT, null, null, { otherOption: {} }],
    [T.MULTI_SELECT, choice, null, { exclusiveOptions: ['Never'] }],
    [T.MULTI_SELECT, choice, null, { exclusiveOptions: ['Nope'] }],
    [T.MULTI_SELECT, choice, null, { exclusiveOptions: [] }],
    [T.MULTI_SELECT, choice, null, { exclusiveOptions: 'Never' }],
    [T.SINGLE_SELECT, choice, null, { exclusiveOptions: ['Never'] }],
    [T.YES_NO, null, null, { commentConfig: { prompt: 'Why?', showWhen: ['No'] } }],
    [T.YES_NO, null, null, { commentConfig: { showWhen: ['Maybe'] } }],
    [T.YES_NO, null, null, { commentConfig: { prompt: 'x'.repeat(201) } }],
    [T.YES_NO, null, null, { commentConfig: { other: 1 } }],
    [T.TEXT, null, null, { commentConfig: { prompt: 'Why?' } }],
    [T.NUMBER, null, null, { commentConfig: { prompt: 'Why?' } }],
    [T.NUMBER, null, null, { commentConfig: { showWhen: ['3'] } }],
    [T.RATING, null, { min: 1, max: 5 }, { commentConfig: { showWhen: ['1'] } }],
    [T.RATING, null, { min: 1, max: 5 }, { commentConfig: { showWhen: ['0'] } }],
    [T.LIKERT, null, null, { commentConfig: { showWhen: ['Disagree'] } }],
    [T.SINGLE_SELECT, choice, null, { otherOption: { label: 'Else' }, commentConfig: { showWhen: ['Else'] } }],
    [T.YES_NO, null, null, { showIf: { questionKey: 'q-a', answers: ['Yes'] } }],
    [T.YES_NO, null, null, { showIf: { questionKey: 'q a', answers: ['Yes'] } }],
    [T.YES_NO, null, null, { showIf: { questionKey: 'q-a', answers: [] } }],
    [T.YES_NO, null, null, { showIf: { questionKey: 'q-a', answers: ['Yes'], extra: 1 } }],
  ])('%s with options %j, config %j and %j', (type, options, config, logic) => {
    expect(questionLogicProblem(type, options, config, logic) === null).toBe(apiAccepts(type, options, config, logic));
  });

  it('survey-wide show-if checks give the same answers', () => {
    const qs = (refType: string, answers: string[], refFirst = true) => {
      const ref = { key: 'a', questionText: 'A', questionType: refType, options: ['X', 'Y'], config: null, otherOption: null, showIf: null };
      const dep = { key: 'b', questionText: 'B', questionType: 'YES_NO', options: null, config: null, otherOption: null, showIf: { questionKey: 'a', answers } };
      return refFirst ? [ref, dep] : [dep, ref];
    };
    for (const input of [qs('SINGLE_SELECT', ['X']), qs('SINGLE_SELECT', ['Z']), qs('TEXT', ['X']), qs('SINGLE_SELECT', ['X'], false)]) {
      expect(libSurveyLogicProblems(input)).toEqual(apiSurveyLogicProblems(input as any));
    }
  });
});

describe('survey library: structured alert rules', () => {
  const withAlert = (rule: unknown, over: Partial<LibrarySurvey> = {}) => {
    const base = survey(over);
    return { ...base, managerGuidance: { ...base.managerGuidance, alerts: [{ when: 'A low answer', action: 'Act on it the same day.', rule }] } };
  };
  const ok = { task: 'Dignity concern', if: [{ question: 'I am treated with dignity and respect.', answers: ['Disagree', 'Strongly disagree'] }], owner: 'REGISTERED_MANAGER', dueWorkingDays: 0 };

  it('accepts a rule naming a question by its exact text with real answers', () => {
    expect(errorsOf(withAlert(ok))).toBe('');
  });
  it('accepts a contact-me rule on the contact-me question answered Yes', () => {
    const rule = { task: 'Asked to be contacted', if: [{ question: 'Would you like someone to contact you about your answers?', answers: ['Yes'] }], owner: 'CARE_COORDINATOR', dueWorkingDays: 5, contactRequest: true };
    expect(errorsOf(withAlert(rule))).toBe('');
  });
  it.each([
    [{ ...ok, if: [{ question: 'Not a question', answers: ['Yes'] }] }, /must be one question's id or exact text/],
    [{ ...ok, if: [{ question: 'I am treated with dignity and respect.', answers: ['Maybe'] }] }, /is not an answer/],
    [{ ...ok, if: [{ question: 'Is there anything else you would like to tell us?', answers: ['x'] }] }, /written answer/],
    [{ ...ok, owner: 'CLEANER' }, /rule.owner must be one of/],
    [{ ...ok, dueWorkingDays: -1 }, /dueWorkingDays/],
    [{ ...ok, record: 'LETTER' }, /rule.record must be one of/],
    [{ ...ok, task: '' }, /rule.task/],
    [{ ...ok, if: [] }, /rule.if needs at least one/],
    [{ ...ok, contactRequest: true }, /contactRequest rule must check only the contact-me question/],
    [{ ...ok, extra: 1 }, /unknown field "extra"/],
    [{ ...ok, dueCalendarDays: 7 }, /exactly one of dueWorkingDays/],
    [{ task: 'x', if: ok.if, owner: 'REGISTERED_MANAGER' }, /exactly one of dueWorkingDays/],
    [{ task: 'x', if: ok.if, owner: 'REGISTERED_MANAGER', dueCalendarDays: 0 }, /dueCalendarDays must be a whole number from 1/],
    [{ ...ok, if: [{ all: [{ question: 'I am treated with dignity and respect.', answers: ['Disagree'] }] }] }, /"all" entry needs a list of at least two/],
    [{ ...ok, if: [{ question: 'I am treated with dignity and respect.', answers: ['Disagree'], not: 'yes' }] }, /"not" must be true or false/],
    [{ ...ok, minimumAnswers: 3 }, /minimumAnswers must be a whole number from 5/],
  ])('refuses a broken rule (%#)', (rule, message) => {
    expect(errorsOf(withAlert(rule))).toMatch(message);
  });
  it('accepts calendar days, "all" entries, "not" conditions and a minimum', () => {
    const rule = {
      task: 'Low dignity and wants a call',
      if: [
        {
          all: [
            { question: 'I am treated with dignity and respect.', answers: ['Disagree', 'Strongly disagree'] },
            { question: 'Which parts of your care matter most to you?', answers: ['Kindness'], not: true },
          ],
        },
      ],
      owner: 'REGISTERED_MANAGER',
      dueCalendarDays: 7,
      minimumAnswers: 10,
    };
    expect(errorsOf(withAlert(rule))).toBe('');
  });
  it('refuses an owner the survey rates (alertsNeverTo)', () => {
    expect(errorsOf({ ...withAlert(ok), alertsNeverTo: ['REGISTERED_MANAGER'] })).toMatch(/one of the roles this survey rates/);
    expect(errorsOf({ ...withAlert(ok), alertsNeverTo: ['NOBODY'] })).toMatch(/alertsNeverTo must be a list/);
  });
  it('refuses a rule owner outside restricted results access', () => {
    const base = withAlert(ok); // owner REGISTERED_MANAGER
    expect(errorsOf({ ...base, access: { responses: ['HR_MANAGER'], results: ['HR_MANAGER'] } })).toMatch(/rule.owner REGISTERED_MANAGER cannot see this survey's results/);
    expect(errorsOf({ ...base, access: { responses: ['HR_MANAGER'], results: ['HR_MANAGER', 'REGISTERED_MANAGER'] } })).toBe('');
  });
  it('validates default access', () => {
    expect(errorsOf({ ...survey(), access: { responses: ['HR_MANAGER'], results: ['HR_MANAGER', 'REGISTERED_MANAGER'], reportingThreshold: 5 } })).toBe('');
    expect(errorsOf({ ...survey(), access: { responses: ['HR_MANAGER'], results: ['REGISTERED_MANAGER'] } })).toMatch(/results must include every role/);
    expect(errorsOf({ ...survey({ anonymous: true }), access: { reportingThreshold: 3 } })).toMatch(/reportingThreshold must be a whole number from 5/);
    expect(errorsOf({ ...survey(), access: { who: [] } })).toMatch(/unknown field "who"/);
  });
  it('refuses a contact-me rule on an anonymous survey', () => {
    const rule = { task: 'Asked', if: [{ question: 'Do your care workers arrive at the time agreed?', answers: ['Yes'] }], owner: 'CARE_COORDINATOR', dueWorkingDays: 5, contactRequest: true };
    expect(errorsOf(withAlert(rule, { anonymous: true }))).toMatch(/anonymous survey cannot have a contact-me rule/);
  });
  it('every rule in the real library is valid (the loader checks it)', () => {
    const files = loadSurveyLibrary(undefined, { partial: true });
    const rules = files.flatMap((f) => f.surveys.flatMap((s) => s.managerGuidance.alerts.filter((a) => a.rule)));
    expect(rules.length).toBeGreaterThan(50);
  });
});

describe('survey library: options from a CareFlow list', () => {
  const eth = (over: Partial<LibrarySurveyQuestion> = {}) =>
    q({ text: 'What is your ethnic group?', type: 'SINGLE_SELECT', required: false, optionsFrom: 'ethnicity', ...over });
  it('accepts a choice question taking its options from a CareFlow list', () => {
    expect(errorsOf(withQuestion(eth()))).toBe('');
  });
  it.each([
    [{ optionsFrom: 'religion' }, /optionsFrom must be one of ethnicity/],
    [{ type: 'TEXT' as const }, /optionsFrom is for SINGLE_SELECT or MULTI_SELECT/],
    [{ options: ['A', 'B'] }, /has no options of its own/],
    [{ otherOption: {} }, /cannot have otherOption/],
  ])('refuses a broken one (%#)', (over, message) => {
    expect(errorsOf(withQuestion(eth(over)))).toMatch(message);
  });
  it('stores it in upper case and lets no library rule name its entries', () => {
    const s = withQuestion(eth({ id: 'q-eth' }));
    expect(surveyQuestionRows(s as LibrarySurvey).find((r) => r.key === 'q-eth')?.optionsFrom).toBe('ETHNICITY');
    const withRule = { ...s, managerGuidance: { ...s.managerGuidance, alerts: [{ when: 'x', action: 'y', rule: { task: 'Gujarati', if: [{ question: 'q-eth', answers: ['Asian - Gujarati'] }], owner: 'REGISTERED_MANAGER', dueWorkingDays: 1 } }] } };
    expect(errorsOf(withRule)).toMatch(/takes its answers from a CareFlow list/);
  });
});

describe("survey library: who it's for", () => {
  it('takes a valid group, and fills one in from the library group when not given', () => {
    expect(errorsOf({ ...survey(), audienceGroup: 'NEW_CLIENTS' })).toBe('');
    expect(errorsOf({ ...survey(), audienceGroup: 'CARE_WORKERS' })).toMatch(/audienceGroup must be one of ALL_PEOPLE/);
    expect(errorsOf({ ...survey(), audienceGroup: 'OTHER' })).toMatch(/audienceGroup must be one of/);
    const group = { code: 'PWS', name: 'People we support', researchedOn: '2026-11-01', displayOrder: 1, short: 'PWS' as const };
    expect(surveyLibraryMeta(survey(), group).audienceGroup).toBe('ALL_PEOPLE');
    expect(surveyLibraryMeta({ ...survey(), audienceGroup: 'NEW_CLIENTS' }, group).audienceGroup).toBe('NEW_CLIENTS');
  });
  it('needs the standard "Who are you?" question for Several groups', () => {
    expect(errorsOf({ ...survey(), audienceGroup: 'SEVERAL' })).toMatch(/needs the standard "Who are you\?" question/);
    const options = ['People new to our care', 'People due a care review', 'Prefer not to say'];
    const who = q({ id: 'who-are-you', text: 'Who are you?', type: 'SINGLE_SELECT', options, notCountedOptions: ['Prefer not to say'] });
    expect(errorsOf({ ...withQuestion(who), audienceGroup: 'SEVERAL' })).toBe('');
  });
  it('"Who are you?" answers are the groups of the audience and end with an uncounted "Prefer not to say"', () => {
    const who = (over: Record<string, unknown>) =>
      q({ id: 'who-are-you', text: 'Who are you?', type: 'SINGLE_SELECT', options: ['People new to our care', 'People due a care review', 'Prefer not to say'], notCountedOptions: ['Prefer not to say'], ...over });
    expect(errorsOf(withQuestion(who({ options: ['Someone we support', 'A relative', 'Prefer not to say'] })))).toMatch(/must be the audience's groups/);
    expect(errorsOf(withQuestion(who({ options: ['People new to our care', 'People due a care review'], notCountedOptions: [] })))).toMatch(/must end with "Prefer not to say"/);
    expect(errorsOf(withQuestion(who({ notCountedOptions: [] })))).toMatch(/must not count "Prefer not to say"/);
    expect(errorsOf(withQuestion(who({ options: ['People new to our care', 'Prefer not to say'] })))).toMatch(/at least two groups/);
  });
});

describe('survey library: section introductions', () => {
  it('are optional, one or two sentences, at most 300 characters, and go into the library details', () => {
    const ok = survey();
    ok.sections[0] = { ...ok.sections[0], introduction: 'These questions are about your visits. Take your time.' };
    expect(errorsOf(ok)).toBe('');
    const three = survey();
    three.sections[0] = { ...three.sections[0], introduction: 'One. Two. Three.' };
    expect(errorsOf(three)).toMatch(/one or two sentences/);
    const long = survey();
    long.sections[0] = { ...long.sections[0], introduction: 'x'.repeat(301) };
    expect(errorsOf(long)).toMatch(/at most 300 characters/);
    const group = { code: 'PWS', name: 'People we support', researchedOn: '2026-11-01', displayOrder: 1, short: 'PWS' as const };
    expect(surveyLibraryMeta(ok, group).sections[0]).toMatchObject({ introduction: 'These questions are about your visits. Take your time.' });
  });
});

describe('anonymous version of a named ready-made survey', () => {
  const VARIANT_INTRO =
    'Thank you for taking part. {{organisation}} wants to know what you think about the care and support you receive at home. ' +
    'This survey is anonymous: we never know who answered. It takes about five minutes. ' +
    'This survey is not for urgent concerns: if you need help now, phone the office.';
  const VARIANT_PRIVACY =
    'Your answers are not linked to your name, your visits or anything else about you, and results are only shown once enough people ' +
    'have answered. We keep the answers for two years and then delete them. Taking part is your choice and will never affect your care.';
  const contactRule = { task: 'Contact the person', if: [{ question: 'q-contact', answers: ['Yes'] }], owner: 'REGISTERED_MANAGER', dueWorkingDays: 2, contactRequest: true };
  const named = (variant: Record<string, unknown> = {}) => {
    const s = survey();
    const visits = s.sections[1].questions;
    visits.splice(1, 0, q({ id: 'q-worker', text: 'What is your full name?', type: 'TEXT', required: false }));
    const last = s.sections[2].questions;
    last[last.length - 1] = { ...contactMe(), id: 'q-contact' };
    last.push(q({ id: 'q-number', text: 'What is your phone number?', type: 'TEXT', required: false, showIf: { question: 'q-contact', answers: ['Yes'] } }));
    s.managerGuidance.alerts = [
      { when: 'Someone says they do not feel safe', action: 'Treat it as a safeguarding concern the same day.' },
      { when: 'Someone asks to be contacted', action: 'Phone them within 2 working days.', rule: contactRule as never },
      { when: 'Someone names a care worker in a complaint', action: 'Speak to the care worker.' },
    ];
    s.anonymousVariant = { introduction: VARIANT_INTRO, privacyNotice: VARIANT_PRIVACY, leaveOut: ['q-worker'], leaveOutAlerts: [3], ...variant } as never;
    return s;
  };

  it('leaves out contact-me, its contact details, the listed questions and their alerts, keeping every other key', () => {
    const s = named();
    expect(errorsOf(s)).toBe('');
    const v = anonymousVariantOf(s)!;
    expect(v.leaveOut.sort()).toEqual(['q-contact', 'q-number', 'q-worker']);
    expect(v.leaveOutAlerts).toEqual([1, 2]);
    expect(v.survey.anonymous).toBe(true);
    expect(v.survey.managerGuidance.alerts.map((a) => a.retired === true)).toEqual([false, true, true]);
    const keysBefore = new Map(surveyQuestionRows(s).map((r) => [r.questionText, r.key]));
    for (const row of surveyQuestionRows(v.survey)) expect(row.key).toBe(keysBefore.get(row.questionText));
    const group = { code: 'PWS', name: 'People we support', researchedOn: '2026-11-01', displayOrder: 1, short: 'PWS' as const };
    expect(surveyLibraryMeta(s, group).anonymousVariant).toEqual({
      introduction: VARIANT_INTRO,
      privacyNotice: VARIANT_PRIVACY,
      leaveOut: expect.arrayContaining(['q-contact', 'q-number', 'q-worker']),
      leaveOutAlerts: [1, 2],
    });
  });

  it('checks the anonymous version like any anonymous survey', () => {
    // A question asking for a name that is not left out.
    expect(errorsOf(named({ leaveOut: [] }))).toMatch(/\(anonymous version\).*must not ask for a name/);
    expect(errorsOf(named({ leaveOut: ['q-nope'] }))).toMatch(/leaveOut must list ids of this survey's questions/);
    expect(errorsOf(named({ leaveOutAlerts: [9] }))).toMatch(/leaveOutAlerts must list alert numbers from 1 to 3/);
    expect(errorsOf(named({ access: { reportingThreshold: 3 } }))).toMatch(/\(anonymous version\).*reportingThreshold must be a whole number from 5/);
    expect(errorsOf(named({ introduction: 'Too short.' }))).toMatch(/\(anonymous version\).*introduction is 2 words/);
    expect(errorsOf(named({ extra: true }))).toMatch(/unknown field "extra"/);
    const anonymous = survey({ anonymous: true });
    anonymous.anonymousVariant = { introduction: VARIANT_INTRO, privacyNotice: VARIANT_PRIVACY };
    expect(errorsOf(anonymous)).toMatch(/anonymousVariant is for named surveys/);
  });
});

describe('closing-screen message', () => {
  it('is optional, at most 600 characters, and checked like everything respondents read', () => {
    expect(errorsOf(survey({ closingMessage: 'Thank you. The right answers are in your staff handbook.' }))).toBe('');
    expect(errorsOf(survey({ closingMessage: 'x'.repeat(601) }))).toMatch(/closingMessage must be text of at most 600 characters/);
    expect(errorsOf(survey({ closingMessage: '   ' }))).toMatch(/closingMessage must be text/);
    expect(errorsOf(survey({ closingMessage: 'Thank you for using this template.' }))).toMatch(/respondents would see the word "template"/);
    expect(errorsOf(survey({ closingMessage: 'Your answers were anonymous.' }))).toMatch(/a named survey must not call itself anonymous/);
  });

  it('is seeded on the ready-made survey', async () => {
    const created: any[] = [];
    const prisma: any = {
      survey: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => created.push(args.data)),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const group = { code: 'PEOPLE_WE_SUPPORT', short: 'PWS' as const, name: 'People we support', displayOrder: 10, researchedOn: '2026-11-01' };
    await seedSurveyLibrary(prisma, [{ group, surveys: [survey({ closingMessage: ' Thank you for your time. ' })] }], {});
    expect(created[0].closingMessage).toBe('Thank you for your time.');
  });
});

describe('surveys about each manager ({{manager}})', () => {
  const staffSurvey = (over: Partial<LibrarySurvey> = {}) => {
    const s = survey({ reference: 'SUR-STF-018', audience: 'EMPLOYEE', anonymous: true, channels: ['ONLINE', 'PAPER'], ...over });
    s.introduction = s.introduction.replace('Thank you for taking part.', 'Thank you for your feedback on {{manager}}.');
    s.sections[1].questions[0] = q({ text: 'Does {{manager}} arrive on time?' });
    return s;
  };

  it('{{manager}} is allowed only on a staff survey that says perManager, and never in an answer', () => {
    expect(errorsOf(staffSurvey())).toMatch(/an unknown \{\{token\}\}/);
    expect(errorsOf(staffSurvey({ perManager: true }))).not.toMatch(/token|perManager|manager/);
    const inAnswer = staffSurvey({ perManager: true });
    inAnswer.sections[2].questions[0] = q({ text: 'Who do you go to first?', type: 'SINGLE_SELECT', options: ['{{manager}}', 'Someone else'] });
    expect(errorsOf(inAnswer)).toMatch(/\{\{manager\}\} cannot be in an answer/);
    expect(errorsOf(survey({ perManager: true }))).toMatch(/perManager is for staff surveys/);
    const silent = survey({ reference: 'SUR-STF-018', audience: 'EMPLOYEE', anonymous: true, channels: ['ONLINE'], perManager: true });
    expect(errorsOf(silent)).toMatch(/never says \{\{manager\}\}/);
    const group = { code: 'STAFF', name: 'Staff', researchedOn: '2026-11-01', displayOrder: 30, short: 'STF' as const };
    expect(surveyLibraryMeta(staffSurvey({ perManager: true }), group).perManager).toBe(true);
    // Roles whose own staff are never asked.
    const ok = staffSurvey({ perManager: true, perManagerExclude: ['REGISTERED_MANAGER'] });
    expect(errorsOf(ok)).not.toMatch(/perManagerExclude/);
    expect(surveyLibraryMeta(ok, group).perManagerExclude).toEqual(['REGISTERED_MANAGER']);
    expect(errorsOf(staffSurvey({ perManager: true, perManagerExclude: ['BOSS' as never] }))).toMatch(/perManagerExclude must be a list of/);
    expect(errorsOf(staffSurvey({ perManagerExclude: ['REGISTERED_MANAGER'] }))).toMatch(/perManagerExclude needs perManager/);
    // The fewest staff a manager's own copy goes to: 5 to 50, with perManager only, kept in the meta.
    const ten = staffSurvey({ perManager: true, perManagerMinTeam: 10 });
    expect(errorsOf(ten)).not.toMatch(/perManagerMinTeam/);
    expect(surveyLibraryMeta(ten, group).perManagerMinTeam).toBe(10);
    expect(surveyLibraryMeta(staffSurvey({ perManager: true }), group)).not.toHaveProperty('perManagerMinTeam');
    for (const bad of [4, 51, 7.5, '10' as never]) {
      expect(errorsOf(staffSurvey({ perManager: true, perManagerMinTeam: bad }))).toMatch(/perManagerMinTeam must be a whole number from 5 to 50/);
    }
    expect(errorsOf(staffSurvey({ perManager: true, perManagerMinTeam: 5 }))).not.toMatch(/perManagerMinTeam/);
    expect(errorsOf(staffSurvey({ perManager: true, perManagerMinTeam: 50 }))).not.toMatch(/perManagerMinTeam/);
    expect(errorsOf(staffSurvey({ perManagerMinTeam: 10 }))).toMatch(/perManagerMinTeam needs perManager/);
  });
});
