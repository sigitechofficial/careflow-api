import { planSupportAutoClose, readSupportAutoClosed } from './support-auto-close.util';

const at = (iso: string) => new Date(iso);
const row = (
  id: string,
  employeeId: string,
  extra: Partial<{
    isLeadCarer: boolean;
    allocatedAt: Date;
    actualStartDateTime: Date | null;
    actualEndDateTime: Date | null;
    status: string;
  }> = {},
) => ({
  id,
  employeeId,
  status: extra.status ?? 'CONFIRMED',
  isLeadCarer: extra.isLeadCarer ?? false,
  allocatedAt: extra.allocatedAt ?? at('2026-10-01T08:00:00Z'),
  actualStartDateTime: extra.actualStartDateTime ?? null,
  actualEndDateTime: extra.actualEndDateTime ?? null,
});

describe('planSupportAutoClose', () => {
  const leadOut = at('2026-10-01T10:00:00Z');

  it('closes support still clocked in at the lead clock-out time', () => {
    const plan = planSupportAutoClose({
      requiredCarers: 2,
      leadClockOut: leadOut,
      allocations: [
        row('a1', 'lead', { isLeadCarer: true, actualStartDateTime: at('2026-10-01T09:00:00Z') }),
        row('a2', 'sup', { actualStartDateTime: at('2026-10-01T09:05:00Z') }),
      ],
    });
    expect(plan.leadEmployeeId).toBe('lead');
    expect(plan.rows).toEqual([{ allocationId: 'a2', employeeId: 'sup', end: leadOut }]);
  });

  it('leaves support who already clocked out, never clocked in, or was removed', () => {
    const plan = planSupportAutoClose({
      requiredCarers: 3,
      leadClockOut: leadOut,
      allocations: [
        row('a1', 'lead', { isLeadCarer: true, actualStartDateTime: at('2026-10-01T09:00:00Z') }),
        row('a2', 'out', {
          actualStartDateTime: at('2026-10-01T09:00:00Z'),
          actualEndDateTime: at('2026-10-01T09:30:00Z'),
        }),
        row('a3', 'absent'),
        row('a4', 'gone', { status: 'UNALLOCATED', actualStartDateTime: at('2026-10-01T09:00:00Z') }),
      ],
    });
    expect(plan.rows).toEqual([]);
  });

  it('uses the fallback lead (earliest assigned) when none is flagged', () => {
    const plan = planSupportAutoClose({
      requiredCarers: 2,
      leadClockOut: leadOut,
      allocations: [
        row('a2', 'second', {
          allocatedAt: at('2026-10-01T08:05:00Z'),
          actualStartDateTime: at('2026-10-01T09:00:00Z'),
        }),
        row('a1', 'first', {
          allocatedAt: at('2026-10-01T08:00:00Z'),
          actualStartDateTime: at('2026-10-01T09:00:00Z'),
        }),
      ],
    });
    expect(plan.leadEmployeeId).toBe('first');
    expect(plan.rows.map((r) => r.employeeId)).toEqual(['second']);
  });

  it('never ends before the support clock-in', () => {
    const start = at('2026-10-01T10:30:00Z');
    const plan = planSupportAutoClose({
      requiredCarers: 2,
      leadClockOut: leadOut,
      allocations: [
        row('a1', 'lead', { isLeadCarer: true }),
        row('a2', 'sup', { actualStartDateTime: start }),
      ],
    });
    expect(plan.rows[0]!.end).toEqual(start);
  });

  it('single-carer visit: nothing to close', () => {
    const plan = planSupportAutoClose({
      requiredCarers: 1,
      leadClockOut: leadOut,
      allocations: [row('a1', 'only', { actualStartDateTime: at('2026-10-01T09:00:00Z') })],
    });
    expect(plan).toEqual({ leadEmployeeId: null, rows: [] });
  });
});

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
