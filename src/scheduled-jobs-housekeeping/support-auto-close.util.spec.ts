import { readSupportAutoClosed } from './support-auto-close.util';

describe('readSupportAutoClosed', () => {
  it('reads valid records only', () => {
    expect(
      readSupportAutoClosed({
        supportAutoClosed: {
          e1: { autoClosedAt: '2026-10-01T10:00:00.000Z', leadEmployeeId: 'l' },
          e2: { nope: true },
        },
      }),
    ).toEqual({
      e1: {
        autoClosedAt: '2026-10-01T10:00:00.000Z',
        leadEmployeeId: 'l',
        reason: 'lead_clock_out',
        recordedAt: '2026-10-01T10:00:00.000Z',
      },
    });
    expect(readSupportAutoClosed(null)).toEqual({});
  });
});
