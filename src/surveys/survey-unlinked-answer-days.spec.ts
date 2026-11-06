import {
  auditUnlinkedAnswerDays,
  countUnlinkedAnswer,
  countUnlinkedAnswerSafely,
  unlinkedDayDescription,
} from './survey-unlinked-answer-days';

const sqlOf = (call: any[]) => [...call[0]].join('?');

describe('answers linked to no one: counted per day, audited once the day is over', () => {
  it('counts an answer on the operational day, recorded and reviewer answers apart, nothing else', async () => {
    const db: any = { $executeRaw: jest.fn().mockResolvedValue(1) };
    // 23:30 UTC on 5 Nov is 23:30 in London (GMT): still the 5th; in Sydney it is the 6th.
    const now = new Date('2026-11-05T23:30:00Z');
    await countUnlinkedAnswer(db, 's1', 'answered', { now, timeZone: 'Europe/London' });
    await countUnlinkedAnswer(db, 's1', 'recorded', { now, timeZone: 'Australia/Sydney' });
    await countUnlinkedAnswer(db, 's1', 'reviewer', { now, timeZone: 'Europe/London' });
    const calls = db.$executeRaw.mock.calls;
    expect(sqlOf(calls[0])).toContain('"SurveyUnlinkedAnswerDay"');
    expect(sqlOf(calls[0])).toContain('ON CONFLICT');
    expect(calls.map((c: any[]) => c.slice(1))).toEqual([
      ['s1', '2026-11-05', 0, 0],
      ['s1', '2026-11-06', 1, 0],
      ['s1', '2026-11-05', 1, 1],
    ]);
    // Only the survey, the day and the counts: no time, person, answer or device.
    expect(JSON.stringify(calls)).not.toMatch(/T\d\d:\d\d/);
  });

  it('never fails the answer: tried twice, then logged', async () => {
    const db: any = { $executeRaw: jest.fn().mockRejectedValue(new Error('down')) };
    await expect(countUnlinkedAnswerSafely(db, 's1', 'answered', { now: new Date(), timeZone: 'Europe/London' })).resolves.toBeUndefined();
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('describes a day in words', () => {
    expect(unlinkedDayDescription('2026-11-05', 1, 0, 0)).toBe('1 answer not linked to anyone on 5 Nov 2026');
    expect(unlinkedDayDescription('2026-11-05', 3, 2, 1)).toBe(
      '3 answers not linked to anyone on 5 Nov 2026 (2 recorded by staff, 1 of them by an independent reviewer)',
    );
  });

  it('writes each finished day once, with the date only, marked audited in the same transaction', async () => {
    const tx: any = { $executeRaw: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) };
    const db: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        { surveyId: 's1', day: '2026-11-04', answers: 3, recorded: 1, reviewerRecorded: 0 },
        { surveyId: 's2', day: '2026-11-04', answers: 2, recorded: 0, reviewerRecorded: 0 },
      ]),
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    };
    const audit = { logAudit: jest.fn() };
    const now = new Date('2026-11-05T09:00:00Z');
    const written = await auditUnlinkedAnswerDays(db, audit as any, { now, timeZone: 'Europe/London' });
    // Only days before today in the organisation's time zone.
    expect(sqlOf(db.$queryRaw.mock.calls[0])).toContain('"day" < ?::date');
    expect(db.$queryRaw.mock.calls[0][1]).toBe('2026-11-05');
    // s2 was written by another server first: no second row.
    expect(written).toBe(1);
    expect(audit.logAudit).toHaveBeenCalledTimes(1);
    const row = audit.logAudit.mock.calls[0][0];
    expect(row).toMatchObject({
      tx,
      userId: undefined,
      module: 'SURVEY',
      action: 'survey_unlinked_answers_counted',
      recordType: 'Survey',
      recordId: 's1',
      newValues: { day: '2026-11-04', answers: 3, recorded: 1, reviewerRecorded: 0 },
      metadata: { surveyId: 's1', day: '2026-11-04' },
    });
    expect(row).not.toHaveProperty('ipAddress');
  });
});
