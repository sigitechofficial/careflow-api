import { IncidentStatus } from '@prisma/client';
import {
  canTransitionIncidentStatus,
  formatIncidentReference,
  INCIDENT_PRIVACY_RANK,
  OPEN_INCIDENT_STATUSES,
} from './incident-workflow.util';

describe('incident workflow util', () => {
  describe('canTransitionIncidentStatus', () => {
    it('allows the standard reporting → review path', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.REPORTED,
          IncidentStatus.AWAITING_REVIEW,
        ),
      ).toBe(true);
    });

    it('allows the short-circuit review → awaiting closure path for simple incidents', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.AWAITING_REVIEW,
          IncidentStatus.AWAITING_CLOSURE,
        ),
      ).toBe(true);
    });

    it('rejects skipping straight from awaiting review to closed', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.AWAITING_REVIEW,
          IncidentStatus.CLOSED,
        ),
      ).toBe(false);
    });

    it('only permits closed → reopened', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.CLOSED,
          IncidentStatus.REOPENED,
        ),
      ).toBe(true);
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.CLOSED,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(false);
    });

    it('never allows a no-op transition to the same status', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.REPORTED,
          IncidentStatus.REPORTED,
        ),
      ).toBe(false);
    });
  });

  describe('formatIncidentReference', () => {
    it('zero-pads the sequence to six digits', () => {
      expect(formatIncidentReference(2026, 128)).toBe('INC-2026-000128');
      expect(formatIncidentReference(2026, 1)).toBe('INC-2026-000001');
    });
  });

  describe('privacy ranks', () => {
    it('orders normal < restricted < highly confidential', () => {
      expect(INCIDENT_PRIVACY_RANK.NORMAL).toBeLessThan(
        INCIDENT_PRIVACY_RANK.RESTRICTED,
      );
      expect(INCIDENT_PRIVACY_RANK.RESTRICTED).toBeLessThan(
        INCIDENT_PRIVACY_RANK.HIGHLY_CONFIDENTIAL,
      );
    });
  });

  describe('open statuses', () => {
    it('treats closed as not open', () => {
      expect(OPEN_INCIDENT_STATUSES).not.toContain(IncidentStatus.CLOSED);
      expect(OPEN_INCIDENT_STATUSES).toContain(
        IncidentStatus.UNDER_INVESTIGATION,
      );
    });
  });
});
