import { IncidentActionStatus } from '@prisma/client';
import {
  canNeedNewRecord,
  effectiveActionStatus,
  isActionOutstanding,
  isActionOverdue,
  missingMeasureFields,
} from './incident-action.util';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const PAST = new Date('2026-08-20T09:00:00.000Z');
const FUTURE = new Date('2026-09-10T09:00:00.000Z');

describe('incident action util', () => {
  describe('isActionOverdue', () => {
    it('is overdue when open and past due', () => {
      expect(
        isActionOverdue(
          { status: IncidentActionStatus.NOT_STARTED, dueDate: PAST },
          NOW,
        ),
      ).toBe(true);
      expect(
        isActionOverdue(
          { status: IncidentActionStatus.IN_PROGRESS, dueDate: PAST },
          NOW,
        ),
      ).toBe(true);
    });

    it('is not overdue when due in the future', () => {
      expect(
        isActionOverdue(
          { status: IncidentActionStatus.NOT_STARTED, dueDate: FUTURE },
          NOW,
        ),
      ).toBe(false);
    });

    it('is never overdue once completed or cancelled', () => {
      expect(
        isActionOverdue(
          { status: IncidentActionStatus.COMPLETED, dueDate: PAST },
          NOW,
        ),
      ).toBe(false);
      expect(
        isActionOverdue(
          { status: IncidentActionStatus.CANCELLED, dueDate: PAST },
          NOW,
        ),
      ).toBe(false);
    });

    it('is not overdue without a due date', () => {
      expect(
        isActionOverdue(
          { status: IncidentActionStatus.NOT_STARTED, dueDate: null },
          NOW,
        ),
      ).toBe(false);
    });
  });

  describe('effectiveActionStatus', () => {
    it('folds OVERDUE over the stored status', () => {
      expect(
        effectiveActionStatus(
          { status: IncidentActionStatus.NOT_STARTED, dueDate: PAST },
          NOW,
        ),
      ).toBe('OVERDUE');
      expect(
        effectiveActionStatus(
          { status: IncidentActionStatus.IN_PROGRESS, dueDate: FUTURE },
          NOW,
        ),
      ).toBe(IncidentActionStatus.IN_PROGRESS);
    });
  });

  describe('isActionOutstanding', () => {
    it('counts open actions as outstanding', () => {
      expect(
        isActionOutstanding({ status: IncidentActionStatus.NOT_STARTED }),
      ).toBe(true);
      expect(
        isActionOutstanding({ status: IncidentActionStatus.COMPLETED }),
      ).toBe(false);
      expect(
        isActionOutstanding({ status: IncidentActionStatus.CANCELLED }),
      ).toBe(false);
    });
  });
});

describe('missingMeasureFields', () => {
  const base = {
    measureType: 'RISK_ASSESSMENT_UPDATE',
    assignedEmployeeId: 'e1',
    dueDate: '2026-10-20',
    linkedRecords: [{ id: 'ra1', label: 'Falls risk' }],
    newRecordNeeded: false,
    description: null,
  };

  it('accepts a complete measure', () => {
    expect(missingMeasureFields(base)).toEqual([]);
  });

  it('needs who, by when and the record (or a new one)', () => {
    expect(
      missingMeasureFields({ ...base, assignedEmployeeId: null, dueDate: null, linkedRecords: [] }),
    ).toEqual([
      'responsible person',
      'due date',
      'the record to update (or say a new one is needed)',
    ]);
    expect(missingMeasureFields({ ...base, linkedRecords: [], newRecordNeeded: true })).toEqual([]);
  });

  it('needs staff for supervision and a description for other', () => {
    expect(missingMeasureFields({ ...base, measureType: 'SUPERVISION', linkedRecords: [] })).toEqual([
      'the staff member',
    ]);
    expect(missingMeasureFields({ ...base, measureType: 'OTHER', description: ' ' })).toEqual([
      'a description of what will change',
    ]);
  });

  it('does not check measures added before types existed', () => {
    expect(missingMeasureFields({ ...base, measureType: null, assignedEmployeeId: null })).toEqual([]);
  });

  it('only allows "new record needed" for record-changing measures', () => {
    expect(canNeedNewRecord('CARE_PLAN_UPDATE')).toBe(true);
    expect(canNeedNewRecord('SUPERVISION')).toBe(false);
  });
});
