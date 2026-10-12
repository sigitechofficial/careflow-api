import {
  evaluatePrnLimits,
  prnClockLabel,
  prnLimitLabels,
  prnLimitsFromMedication,
  prnOverLimitDetail,
  prnSummaryLine,
  prnWarningLine,
} from './medication-prn-limits.util';

const TZ = 'Europe/London';
// 12 Oct 2026 is in BST (UTC+1): 08:00Z is 09:00 in London.
const t = (iso: string) => new Date(`2026-10-12T${iso}:00.000Z`);
const limits = { minGapHours: 4, maxDosesIn24Hours: 4, maxDosePerTime: '2 tablets' };
const noLimits = { minGapHours: null, maxDosesIn24Hours: null, maxDosePerTime: null };

describe('evaluatePrnLimits', () => {
  it('is ok with no earlier dose', () => {
    expect(evaluatePrnLimits({ limits, givenAt: [], at: t('09:00') })).toMatchObject({
      countIn24h: 0,
      lastGivenAt: null,
      status: 'ok',
      nextAllowedAt: null,
    });
  });

  it('is too soon inside the minimum gap and ok once it has passed', () => {
    const early = evaluatePrnLimits({ limits, givenAt: [t('07:00')], at: t('08:00') });
    expect(early).toMatchObject({ status: 'too_soon', tooSoon: true, countIn24h: 1 });
    expect(early.nextAllowedAt).toEqual(t('11:00'));
    expect(evaluatePrnLimits({ limits, givenAt: [t('07:00')], at: t('11:00') }).status).toBe('ok');
  });

  it('reaches the maximum and reopens 24 hours after the oldest counted dose', () => {
    const givenAt = [t('01:00'), t('05:00'), t('09:00'), t('13:00')];
    const res = evaluatePrnLimits({ limits, givenAt, at: t('18:00') });
    expect(res).toMatchObject({ status: 'max_reached', maxReached: true, tooSoon: false });
    expect(res.nextAllowedAt).toEqual(new Date('2026-10-13T01:00:00.000Z'));
  });

  it('uses a rolling 24 hours, not the calendar day', () => {
    const lastNight = new Date('2026-10-11T22:00:00.000Z');
    const res = evaluatePrnLimits({ limits, givenAt: [lastNight], at: t('00:30') });
    expect(res).toMatchObject({ countIn24h: 1, status: 'too_soon' });
  });

  it('ignores doses older than 24 hours and doses after the moment evaluated', () => {
    const res = evaluatePrnLimits({
      limits,
      givenAt: [new Date('2026-10-11T07:00:00.000Z'), t('20:00')],
      at: t('09:00'),
    });
    expect(res).toMatchObject({ countIn24h: 0, status: 'ok' });
  });

  it('never warns when no limit is set but still counts doses', () => {
    const res = evaluatePrnLimits({
      limits: noLimits,
      givenAt: [t('08:00'), t('08:30')],
      at: t('09:00'),
    });
    expect(res).toMatchObject({ countIn24h: 2, status: 'ok', nextAllowedAt: null });
  });
});

describe('PRN lines for the carer', () => {
  it('summarises the last dose and the count', () => {
    const evaluation = evaluatePrnLimits({ limits, givenAt: [t('07:00')], at: t('08:00') });
    expect(prnSummaryLine({ limits, evaluation, now: t('08:00'), timeZone: TZ })).toBe(
      'Last given 08:00 · 1 of 4 in 24h',
    );
    expect(prnWarningLine({ limits, evaluation, now: t('08:00'), timeZone: TZ })).toBe(
      'Too soon: minimum gap is 4h. Next dose after 12:00.',
    );
  });

  it('says so when nothing was given', () => {
    const evaluation = evaluatePrnLimits({ limits, givenAt: [], at: t('08:00') });
    expect(prnSummaryLine({ limits, evaluation, now: t('08:00'), timeZone: TZ })).toBe(
      'No dose in the last 24 hours',
    );
    expect(prnWarningLine({ limits, evaluation, now: t('08:00'), timeZone: TZ })).toBeNull();
  });

  it('labels yesterday and tomorrow', () => {
    expect(prnClockLabel(new Date('2026-10-11T22:00:00.000Z'), t('08:00'), TZ)).toBe(
      'yesterday 23:00',
    );
    expect(prnClockLabel(new Date('2026-10-13T01:00:00.000Z'), t('18:00'), TZ)).toBe(
      'tomorrow 02:00',
    );
  });

  it('warns when the maximum is reached', () => {
    const givenAt = [t('01:00'), t('05:00'), t('09:00'), t('13:00')];
    const evaluation = evaluatePrnLimits({ limits, givenAt, at: t('18:00') });
    expect(prnWarningLine({ limits, evaluation, now: t('18:00'), timeZone: TZ })).toBe(
      'Maximum reached: 4 of 4 in 24 hours. Next dose after tomorrow 02:00.',
    );
  });
});

describe('prnOverLimitDetail', () => {
  it('is null for a dose within the limits', () => {
    const evaluation = evaluatePrnLimits({ limits, givenAt: [t('02:00')], at: t('08:00') });
    expect(prnOverLimitDetail({ limits, evaluation, at: t('08:00') })).toBeNull();
  });

  it('explains a dose given too soon and over the maximum', () => {
    const givenAt = [t('01:00'), t('03:00'), t('05:00'), t('07:00')];
    const evaluation = evaluatePrnLimits({ limits, givenAt, at: t('08:00') });
    expect(prnOverLimitDetail({ limits, evaluation, at: t('08:00') })).toBe(
      'Given 1h after the previous dose (minimum gap 4h); Dose 5 in 24 hours (maximum 4)',
    );
  });
});

describe('prnLimitsFromMedication', () => {
  it('treats missing and blank values as not set', () => {
    expect(prnLimitsFromMedication({ prnMaxDosePerTime: '  ' })).toEqual(noLimits);
  });
});

describe('prnLimitLabels', () => {
  it('writes each limit that is set', () => {
    expect(prnLimitLabels({ minGapHours: 4.5, maxDosesIn24Hours: 1, maxDosePerTime: '2 tablets' })).toEqual({
      minIntervalLabel: 'Min 4h 30m between doses',
      maxDoseLabel: 'Max 1 dose in 24 hours',
      maxPerTimeLabel: 'Max 2 tablets at one time',
    });
  });

  it('gives null for limits that are not set', () => {
    expect(prnLimitLabels(noLimits)).toEqual({
      minIntervalLabel: null,
      maxDoseLabel: null,
      maxPerTimeLabel: null,
    });
  });
});
