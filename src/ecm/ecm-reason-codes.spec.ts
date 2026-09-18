import {
  parseSosClosePayload,
  reasonCodesForExceptionKind,
  SOS_ACTION_CODES,
  SOS_OUTCOME_CODES,
} from './ecm-reason-codes';

describe('SOS close codes', () => {
  it('returns SOS outcomes for a carer SOS exception', () => {
    expect(reasonCodesForExceptionKind('CARER_SOS')).toEqual(SOS_OUTCOME_CODES);
  });

  it('requires both action and outcome, and a note for each', () => {
    // Both notes are now always required, even for non-Other codes.
    expect(parseSosClosePayload('SOS_ACTION_CALLED_CARER', 'SOS_FALSE_ALARM').ok).toBe(false);
    expect(
      parseSosClosePayload('SOS_ACTION_CALLED_CARER', 'SOS_FALSE_ALARM', 'all safe', 'called carer'),
    ).toEqual({
      ok: true,
      actionCode: 'SOS_ACTION_CALLED_CARER',
      outcomeCode: 'SOS_FALSE_ALARM',
      actionNote: 'called carer',
      note: 'all safe',
    });
    expect(parseSosClosePayload('', 'SOS_FALSE_ALARM', 'n', 'n').ok).toBe(false);
    expect(parseSosClosePayload('SOS_ACTION_CALLED_CARER', '', 'n', 'n').ok).toBe(false);
    // Missing action note → blocked.
    expect(
      parseSosClosePayload('SOS_ACTION_CALLED_CARER', 'SOS_FALSE_ALARM', 'all safe', '  ').ok,
    ).toBe(false);
    // Missing outcome note → blocked.
    expect(
      parseSosClosePayload('SOS_ACTION_CALLED_CARER', 'SOS_FALSE_ALARM', '', 'called carer').ok,
    ).toBe(false);
    expect(
      parseSosClosePayload('SOS_ACTION_OTHER', 'SOS_OTHER', 'result', '  called neighbour  '),
    ).toEqual({
      ok: true,
      actionCode: 'SOS_ACTION_OTHER',
      outcomeCode: 'SOS_OTHER',
      actionNote: 'called neighbour',
      note: 'result',
    });
  });

  it('rejects visit-timing reason codes on SOS close', () => {
    expect(parseSosClosePayload('LATE_TRAFFIC', 'SOS_FALSE_ALARM').ok).toBe(false);
    expect(SOS_ACTION_CODES.some((row) => row.code === 'SOS_ACTION_CALLED_CARER')).toBe(true);
  });
});
