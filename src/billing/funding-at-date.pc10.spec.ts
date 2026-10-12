/**
 * PC-10: the funder used for a carer's pay is the funder on the day of the visit.
 */
import { FundingLineForPay, payFunderOn } from './funding-at-date.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dayOf = (instant: Date) => instant.toISOString().slice(0, 10);
let n = 0;
const line = (funderId: string | null, over: Partial<FundingLineForPay> = {}): FundingLineForPay => ({
  id: `line-${(n += 1)}`,
  funderId,
  startDate: null,
  endDate: null,
  isPrimary: false,
  isActive: true,
  splitPriority: 1,
  createdAt: d('2026-01-01'),
  ...over,
});
const on = (lines: FundingLineForPay[], day: string, current: string | null = null) => payFunderOn(lines, current, day, dayOf);

describe('PC-10: funder on the day of the visit', () => {
  it('a change of funder: each visit has the funder of its own date', () => {
    const council = line('council', { startDate: d('2026-01-01'), endDate: d('2026-06-30'), isActive: false });
    const nhs = line('nhs', { startDate: d('2026-07-01') });
    const lines = [council, nhs];
    expect(on(lines, '2026-06-30', nhs.id)).toMatchObject({ funderId: 'council', basis: 'DATED' });
    expect(on(lines, '2026-07-01', nhs.id)).toMatchObject({ funderId: 'nhs', basis: 'DATED' });
    expect(on(lines, '2026-03-10', nhs.id)).toMatchObject({ funderId: 'council' });
  });

  it('an undated line that was already there on the day still applies (what happens today)', () => {
    const only = line('council', { createdAt: d('2026-01-01') });
    expect(on([only], '2026-11-03', only.id)).toEqual({ funderId: 'council', basis: 'IN_PLACE', uncertainFunderIds: [] });
  });

  it('an undated line entered after the visit: the records cannot say who was funding then', () => {
    const late = line('nhs', { createdAt: d('2026-09-01') });
    expect(on([late], '2026-06-15', late.id)).toEqual({ funderId: null, basis: 'UNCLEAR', uncertainFunderIds: ['nhs'] });
    // From the day it was entered it is in place.
    expect(on([late], '2026-09-01', late.id)).toMatchObject({ funderId: 'nhs', basis: 'IN_PLACE' });
  });

  it('a line that was stopped without an end date: unclear for days it may have covered', () => {
    const stopped = line('council', { isActive: false, createdAt: d('2026-01-01') });
    expect(on([stopped], '2026-03-01')).toMatchObject({ funderId: null, basis: 'UNCLEAR', uncertainFunderIds: ['council'] });
    const stoppedDated = line('council', { isActive: false, startDate: d('2026-01-01') });
    expect(on([stoppedDated], '2026-03-01')).toMatchObject({ basis: 'UNCLEAR' });
    // With an end date the same line is certain, both inside and outside its period.
    const ended = line('council', { isActive: false, startDate: d('2026-01-01'), endDate: d('2026-06-30') });
    expect(on([ended], '2026-03-01')).toMatchObject({ funderId: 'council', basis: 'DATED' });
    expect(on([ended], '2026-07-01')).toEqual({ funderId: null, basis: 'NONE', uncertainFunderIds: [] });
  });

  it('a dated line answers the question even when an undated one was entered later', () => {
    const council = line('council', { startDate: d('2026-01-01'), endDate: d('2026-06-30') });
    const late = line('nhs', { createdAt: d('2026-09-01') });
    expect(on([council, late], '2026-06-15', late.id)).toMatchObject({ funderId: 'council', basis: 'DATED' });
    // After the dated line ended and before the undated one was entered: unclear.
    expect(on([council, late], '2026-08-01', late.id)).toMatchObject({ basis: 'UNCLEAR', uncertainFunderIds: ['nhs'] });
  });

  it('no funding with a funder on the day: no funder, and that is certain', () => {
    expect(on([], '2026-11-03')).toEqual({ funderId: null, basis: 'NONE', uncertainFunderIds: [] });
    expect(on([line(null)], '2026-11-03')).toMatchObject({ funderId: null, basis: 'NONE' });
    const future = line('nhs', { startDate: d('2026-12-01') });
    expect(on([future], '2026-11-03', future.id)).toMatchObject({ funderId: null, basis: 'NONE' });
  });

  it('split funding on the day: the current line, then the primary line, then the split order', () => {
    const a = line('council', { startDate: d('2026-01-01'), splitPriority: 2 });
    const b = line('nhs', { startDate: d('2026-01-01'), splitPriority: 1 });
    expect(on([a, b], '2026-11-03')).toMatchObject({ funderId: 'nhs' });
    expect(on([{ ...a, isPrimary: true }, b], '2026-11-03')).toMatchObject({ funderId: 'council' });
    expect(on([a, { ...b, isPrimary: true }], '2026-11-03', a.id)).toMatchObject({ funderId: 'council' });
  });

  it('start and end days are inclusive, in the local day given', () => {
    const one = line('council', { startDate: d('2026-06-01'), endDate: d('2026-06-30') });
    expect(on([one], '2026-05-31')).toMatchObject({ funderId: null });
    expect(on([one], '2026-06-01')).toMatchObject({ funderId: 'council' });
    expect(on([one], '2026-06-30')).toMatchObject({ funderId: 'council' });
    expect(on([one], '2026-07-01')).toMatchObject({ funderId: null });
    // A start stored as local midnight in summer time (23:00 UTC the day before) is that local day.
    const london = (instant: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(instant);
    const local = line('council', { startDate: new Date('2026-05-31T23:00:00Z') });
    expect(payFunderOn([local], null, '2026-06-01', london)).toMatchObject({ funderId: 'council' });
    expect(payFunderOn([local], null, '2026-05-31', london)).toMatchObject({ funderId: null });
  });
});
