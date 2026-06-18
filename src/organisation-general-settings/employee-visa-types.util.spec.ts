import { ENTERPRISE_EMPLOYEE_VISA_TYPES } from '../../prisma/seed-data/employee-visa-catalog';
import {
  assertEmploymentHoursWithinVisaLimit,
  effectiveWeeklyHoursCap,
  isWeeklyHoursCapOverrideActive,
  parseEmployeeVisaTypes,
  serializeEmployeeVisaTypes,
  visaTypeAutoFillsContractedHours,
  weeklyHoursForVisaTypeId,
} from './employee-visa-types.util';

describe('employee visa types', () => {
  it('enterprise catalog has unique stable ids and plain labels (no hours in names)', () => {
    const ids = new Set<string>();
    for (const row of ENTERPRISE_EMPLOYEE_VISA_TYPES) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.label).not.toMatch(/\d+\s*h/i);
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
    }
    expect(ENTERPRISE_EMPLOYEE_VISA_TYPES.length).toBeGreaterThanOrEqual(10);
  });

  it('standard statuses allow 40h; student routes are lower', () => {
    const byId = Object.fromEntries(ENTERPRISE_EMPLOYEE_VISA_TYPES.map((t) => [t.id, t]));
    expect(byId.british_citizen?.maxWeeklyHours).toBe(40);
    expect(byId.student_visa?.maxWeeklyHours).toBe(20);
    expect(byId.student_visa_sub_degree?.maxWeeklyHours).toBe(10);
  });

  it('parseEmployeeVisaTypes falls back to enterprise catalog when JSON invalid', () => {
    const parsed = parseEmployeeVisaTypes(null);
    expect(parsed[0]?.id).toBe('british_citizen');
    expect(parsed.some((t) => t.id === 'student_visa')).toBe(true);
  });

  it('student types auto-fill contracted hours; unrestricted statuses do not', () => {
    const types = parseEmployeeVisaTypes(ENTERPRISE_EMPLOYEE_VISA_TYPES);
    expect(visaTypeAutoFillsContractedHours(types, 'student_visa')).toBe(true);
    expect(visaTypeAutoFillsContractedHours(types, 'student_visa_sub_degree')).toBe(true);
    expect(visaTypeAutoFillsContractedHours(types, 'british_citizen')).toBe(false);
  });

  it('weeklyHoursForVisaTypeId resolves max hour caps', () => {
    const types = parseEmployeeVisaTypes(ENTERPRISE_EMPLOYEE_VISA_TYPES);
    expect(weeklyHoursForVisaTypeId(types, 'student_visa')).toBe(20);
    expect(weeklyHoursForVisaTypeId(types, 'student_visa_sub_degree')).toBe(10);
    expect(weeklyHoursForVisaTypeId(types, 'skilled_worker')).toBe(40);
  });

  it('assertEmploymentHoursWithinVisaLimit rejects hours above cap', () => {
    const types = parseEmployeeVisaTypes(ENTERPRISE_EMPLOYEE_VISA_TYPES);
    expect(
      assertEmploymentHoursWithinVisaLimit(types, 'student_visa', {
        contractedWeeklyHours: 25,
      }),
    ).toMatch(/exceeds/);
    expect(
      assertEmploymentHoursWithinVisaLimit(types, 'british_citizen', {
        contractedWeeklyHours: 37.5,
      }),
    ).toBeNull();
  });

  it('effectiveWeeklyHoursCap uses per-employee override when active', () => {
    const types = parseEmployeeVisaTypes(ENTERPRISE_EMPLOYEE_VISA_TYPES);
    expect(
      effectiveWeeklyHoursCap(types, 'student_visa', {
        weeklyHoursCapOverride: 30,
        weeklyHoursCapOverrideReason: 'Approved vacation cover',
        weeklyHoursCapOverrideExpiresAt: null,
      }),
    ).toBe(30);
    expect(
      assertEmploymentHoursWithinVisaLimit(
        types,
        'student_visa',
        { contractedWeeklyHours: 28 },
        {
          weeklyHoursCapOverride: 30,
          weeklyHoursCapOverrideReason: 'Approved vacation cover',
        },
      ),
    ).toBeNull();
  });

  it('expired weekly hours cap override falls back to status cap', () => {
    const types = parseEmployeeVisaTypes(ENTERPRISE_EMPLOYEE_VISA_TYPES);
    const expired = new Date('2020-01-01');
    expect(
      isWeeklyHoursCapOverrideActive(
        {
          weeklyHoursCapOverride: 30,
          weeklyHoursCapOverrideReason: 'Old approval',
          weeklyHoursCapOverrideExpiresAt: expired,
        },
        new Date('2026-06-01'),
      ),
    ).toBe(false);
    expect(
      effectiveWeeklyHoursCap(
        types,
        'student_visa',
        {
          weeklyHoursCapOverride: 30,
          weeklyHoursCapOverrideReason: 'Old approval',
          weeklyHoursCapOverrideExpiresAt: expired,
        },
        new Date('2026-06-01'),
      ),
    ).toBe(20);
  });

  it('serializeEmployeeVisaTypes preserves sort order', () => {
    const out = serializeEmployeeVisaTypes(ENTERPRISE_EMPLOYEE_VISA_TYPES.slice(0, 2)) as unknown[];
    expect(out).toHaveLength(2);
    expect((out[0] as { sortOrder: number }).sortOrder).toBe(0);
  });
});
