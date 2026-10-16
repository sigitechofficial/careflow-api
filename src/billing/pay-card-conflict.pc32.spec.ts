/**
 * PC-32: when two cards match a carer at the same level, none is chosen.
 * The most recently edited card used to win.
 */
import {
  describePayCardConflict,
  effectiveEmployeeFunderPayAssignments,
  firstOverlapDay,
  matchPayCards,
  PayCardConflictException,
  payCardConflictCard,
  payCardTargetsEqual,
} from './pay-card-assignment.util';
import { assignmentsCoveringDay } from './employee-pay-card-assignment.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const card = (code: string, over: Record<string, unknown> = {}) =>
  ({
    id: code.toLowerCase(),
    code,
    name: `Card ${code}`,
    version: 1,
    assignmentLevel: 'ORGANISATION_DEFAULT',
    assignmentTargetId: null,
    assignmentTargetKey: null,
    assignmentLabel: null,
    status: 'ACTIVE',
    effectiveFrom: d('2026-01-01'),
    effectiveTo: null,
    updatedAt: d('2026-01-01'),
    ...over,
  }) as never;
const carer = {
  employeeId: 'emp-1',
  roleId: 'role-1',
  locationId: 'branch-a',
  baseLocationId: 'branch-b',
  contractTypeId: 'contract-1',
  isAgencyStaff: false,
  isBankStaff: false,
};
const at = { at: d('2026-11-03') };
const codes = (cards: Array<{ code: string }>) => cards.map((c) => c.code);

describe('PC-32: matching pay cards', () => {
  it('one card at the winning level is the card', () => {
    const result = matchPayCards(carer, [card('ORG'), card('ROLE', { assignmentLevel: 'ROLE', assignmentTargetId: 'role-1' })], at);
    expect(result.card).toMatchObject({ code: 'ROLE' });
    expect(result.conflicting).toEqual([]);
  });

  it('two cards at the winning level: none is chosen, whichever was edited last', () => {
    const older = card('ORG-A', { updatedAt: d('2026-02-01') });
    const newer = card('ORG-B', { updatedAt: d('2026-09-01') });
    for (const cards of [[older, newer], [newer, older]]) {
      const result = matchPayCards(carer, cards, at);
      expect(result.card).toBeNull();
      expect(codes(result.conflicting)).toEqual(['ORG-A', 'ORG-B']);
    }
  });

  it('a conflict at a lower level does not matter when a more specific card applies', () => {
    const result = matchPayCards(
      carer,
      [card('ORG-A'), card('ORG-B'), card('IND', { assignmentLevel: 'INDIVIDUAL', assignmentTargetId: 'emp-1' })],
      at,
    );
    expect(result.card).toMatchObject({ code: 'IND' });
    expect(result.conflicting).toEqual([]);
  });

  it('cards that are not in force, not active, or for someone else do not conflict', () => {
    const result = matchPayCards(
      carer,
      [
        card('ORG'),
        card('FUTURE', { effectiveFrom: d('2026-12-01') }),
        card('ENDED', { effectiveTo: d('2026-11-02') }),
        card('DRAFT', { status: 'DRAFT' }),
        card('OTHER-ROLE', { assignmentLevel: 'ROLE', assignmentTargetId: 'role-2' }),
      ],
      at,
    );
    expect(result.card).toMatchObject({ code: 'ORG' });
    // On the day the future card starts, the two do conflict.
    expect(codes(matchPayCards(carer, [card('ORG'), card('FUTURE', { effectiveFrom: d('2026-12-01') })], { at: d('2026-12-01') }).conflicting)).toEqual(['FUTURE', 'ORG']);
  });

  it('working branch and base branch each with a card: a conflict, not a guess', () => {
    const result = matchPayCards(
      carer,
      [
        card('BR-A', { assignmentLevel: 'BRANCH', assignmentTargetId: 'branch-a' }),
        card('BR-B', { assignmentLevel: 'BRANCH', assignmentTargetId: 'branch-b' }),
      ],
      at,
    );
    expect(result.card).toBeNull();
    expect(codes(result.conflicting)).toEqual(['BR-A', 'BR-B']);
  });

  it('no matching card at all is not a conflict', () => {
    expect(matchPayCards(carer, [card('OTHER', { assignmentLevel: 'ROLE', assignmentTargetId: 'role-2' })], at)).toEqual({ card: null, conflicting: [] });
  });
});

describe('PC-32: describing a conflict', () => {
  const cards = [payCardConflictCard(card('STD-A')), payCardConflictCard(card('STD-B'))];

  it('names the cards, the day and the level, and says what to do', () => {
    const message = describePayCardConflict({ kind: 'MATCHED_LEVEL', level: 'ROLE', day: '2026-11-03', cards });
    expect(message).toBe(
      'Two pay cards apply to this carer on 2026-11-03 at the same level (role): STD-A "Card STD-A" and STD-B "Card STD-B". No card is chosen until one of them is ended before that date or the carer is given their own pay card.',
    );
    const three = describePayCardConflict({ kind: 'MATCHED_LEVEL', level: 'BRANCH', day: '2026-11-03', cards: [...cards, payCardConflictCard(card('STD-C'))] });
    expect(three).toContain('3 pay cards apply');
    expect(three).toContain('STD-A "Card STD-A", STD-B "Card STD-B" and STD-C "Card STD-C"');
  });

  it('has its own wording for funder overrides and for the carer\'s own history', () => {
    expect(describePayCardConflict({ kind: 'FUNDER_OVERRIDE', level: null, day: '2026-11-03', cards })).toContain('Two funder pay card overrides for this carer and funder cover 2026-11-03');
    expect(describePayCardConflict({ kind: 'OWN_CARD', level: null, day: '2026-11-03', cards })).toContain("The carer's own pay card history has overlapping entries covering 2026-11-03");
  });

  it('the exception is a 409 that carries the cards and reads as the description', () => {
    const conflict = { kind: 'MATCHED_LEVEL' as const, level: 'ROLE' as const, day: '2026-11-03', cards };
    const error = new PayCardConflictException(conflict);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe(describePayCardConflict(conflict));
    expect(error.getResponse()).toMatchObject({ code: 'PAY_CARD_CONFLICT', conflict });
  });
});

describe('PC-32: overlapping windows and rows', () => {
  it('same level and target are the same audience; windows overlap from the later start', () => {
    const role = (target: string) => ({ assignmentLevel: 'ROLE' as const, assignmentTargetId: target, assignmentTargetKey: null });
    expect(payCardTargetsEqual(role('r1'), role('r1'))).toBe(true);
    expect(payCardTargetsEqual(role('r1'), role('r2'))).toBe(false);
    expect(payCardTargetsEqual(role('r1'), { assignmentLevel: 'BRANCH', assignmentTargetId: 'r1', assignmentTargetKey: null })).toBe(false);

    const open = { effectiveFrom: d('2026-01-01'), effectiveTo: null };
    expect(firstOverlapDay(open, { effectiveFrom: d('2026-12-01'), effectiveTo: null })).toEqual(d('2026-12-01'));
    expect(firstOverlapDay({ effectiveFrom: d('2026-01-01'), effectiveTo: d('2026-11-30') }, { effectiveFrom: d('2026-12-01'), effectiveTo: null })).toBeNull();
    expect(firstOverlapDay({ effectiveFrom: d('2026-01-01'), effectiveTo: d('2026-12-01') }, { effectiveFrom: d('2026-12-01'), effectiveTo: null })).toEqual(d('2026-12-01'));
  });

  it('every funder override in force on the day is returned, so two can be seen', () => {
    const row = (id: string, payCardId: string, from: string, to: string | null = null) => ({
      id,
      employeeId: 'emp-1',
      funderId: 'f-1',
      payCardId,
      effectiveFrom: d(from),
      effectiveTo: to ? d(to) : null,
    });
    const rows = [row('a', 'card-1', '2026-01-01'), row('b', 'card-2', '2026-06-01'), row('c', 'card-3', '2026-01-01', '2026-03-31')];
    expect(effectiveEmployeeFunderPayAssignments(rows, d('2026-11-03')).map((r) => r.id)).toEqual(['b', 'a']);
    expect(effectiveEmployeeFunderPayAssignments(rows, d('2026-05-01')).map((r) => r.id)).toEqual(['a']);
  });

  it('every own-card entry covering the day is returned; a correct history has one', () => {
    const created = d('2026-10-09');
    const correct = [
      { payCardId: 'standard', effectiveFrom: null, effectiveTo: d('2026-10-31'), createdAt: created },
      { payCardId: 'senior', effectiveFrom: d('2026-11-01'), effectiveTo: null, createdAt: created },
    ];
    expect(assignmentsCoveringDay(correct, '2026-11-03').map((r) => r.payCardId)).toEqual(['senior']);
    const raced = [...correct, { payCardId: 'other', effectiveFrom: d('2026-11-01'), effectiveTo: null, createdAt: created }];
    expect(assignmentsCoveringDay(raced, '2026-11-03')).toHaveLength(2);
  });
});
