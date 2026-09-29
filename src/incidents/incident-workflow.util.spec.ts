import { IncidentStatus } from '@prisma/client';
import {
  canTransitionIncidentStatus,
  formatIncidentReference,
  INCIDENT_PRIVACY_RANK,
  isReinvestigateTransition,
  OPEN_INCIDENT_STATUSES,
} from './incident-workflow.util';

describe('incident workflow util', () => {
  describe('canTransitionIncidentStatus', () => {
    it('allows Raise → Investigate as the primary path', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.REPORTED,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(true);
    });

    it('allows Investigate → Awaiting Closure', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.UNDER_INVESTIGATION,
          IncidentStatus.AWAITING_CLOSURE,
        ),
      ).toBe(true);
    });

    it('allows Awaiting Closure → Closed', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.AWAITING_CLOSURE,
          IncidentStatus.CLOSED,
        ),
      ).toBe(true);
    });

    it('allows Closed → Under Investigation for re-investigate', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.CLOSED,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(true);
    });

    it('allows Awaiting Closure → Under Investigation for re-investigate', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.AWAITING_CLOSURE,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(true);
    });

    it('rejects skipping straight from reported to closed', () => {
      expect(
        canTransitionIncidentStatus(
          IncidentStatus.REPORTED,
          IncidentStatus.CLOSED,
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

  describe('isReinvestigateTransition', () => {
    it('detects re-investigate from closed / awaiting closure / reopened', () => {
      expect(
        isReinvestigateTransition(
          IncidentStatus.CLOSED,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(true);
      expect(
        isReinvestigateTransition(
          IncidentStatus.AWAITING_CLOSURE,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(true);
      expect(
        isReinvestigateTransition(
          IncidentStatus.REOPENED,
          IncidentStatus.UNDER_INVESTIGATION,
        ),
      ).toBe(true);
    });

    it('does not treat Raise → Investigate as re-investigate', () => {
      expect(
        isReinvestigateTransition(
          IncidentStatus.REPORTED,
          IncidentStatus.UNDER_INVESTIGATION,
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
