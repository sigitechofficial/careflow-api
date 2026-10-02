import {
  InitialAssessmentRiskLevel,
  InitialAssessmentRiskType,
} from '@prisma/client';
import {
  compareAlertsByTier,
  countCriticalAlerts,
  mapAllergiesToAlert,
  mapDnacprToAlert,
  mapFlashMessageToAlert,
  mapIaRiskToAlert,
  mapMedicalConditionToAlert,
  mapReasonableAdjustmentToAlert,
  type ServiceUserAlertItem,
} from './service-user-alert-mapping.util';
import { resolveCprStatus } from './employee-app-cpr-status.util';

describe('service-user-alert-mapping', () => {
  describe('mapAllergiesToAlert', () => {
    it('aggregates allergy names into one critical alert', () => {
      const alert = mapAllergiesToAlert(['Penicillin', ' Latex ']);
      expect(alert).not.toBeNull();
      expect(alert!.tier).toBe('CRITICAL');
      expect(alert!.source).toBe('ADMIN');
      expect(alert!.detail).toBe('Penicillin, Latex');
    });

    it('returns null when there are no allergies', () => {
      expect(mapAllergiesToAlert([])).toBeNull();
      expect(mapAllergiesToAlert(['   '])).toBeNull();
    });
  });

  describe('mapDnacprToAlert', () => {
    it('returns a critical alert only for an office-verified DNACPR', () => {
      const alert = mapDnacprToAlert(
        resolveCprStatus(
          { dnacprInPlace: true, dnacprStatusConfirmation: 'IN_PLACE', dnacprPhysicalLocation: 'Kitchen drawer' },
          null,
        ),
      );
      expect(alert!.tier).toBe('CRITICAL');
      expect(alert!.detail).toContain('Kitchen drawer');
    });

    it('raises an important check-with-office alert when the status is not recorded', () => {
      const alert = mapDnacprToAlert(resolveCprStatus(null, null));
      expect(alert!.tier).toBe('IMPORTANT');
      expect(alert!.actionLine).toContain('confirm with the office');
    });

    it('returns null when the office confirmed there is no DNACPR', () => {
      expect(
        mapDnacprToAlert(
          resolveCprStatus({ dnacprInPlace: false, dnacprStatusConfirmation: 'NOT_IN_PLACE' }, null),
        ),
      ).toBeNull();
    });
  });

  describe('mapIaRiskToAlert', () => {
    it('maps LONE_WORKER to a critical alert with IA source', () => {
      const alert = mapIaRiskToAlert({
        id: 'r1',
        riskType: InitialAssessmentRiskType.LONE_WORKER,
        riskLevel: InitialAssessmentRiskLevel.HIGH,
      });
      expect(alert!.tier).toBe('CRITICAL');
      expect(alert!.source).toBe('IA');
      expect(alert!.category).toBe('IA_LONE_WORKER');
    });

    it('maps FALLS to an important alert', () => {
      const alert = mapIaRiskToAlert({
        id: 'r2',
        riskType: InitialAssessmentRiskType.FALLS,
        riskLevel: InitialAssessmentRiskLevel.MEDIUM,
      });
      expect(alert!.tier).toBe('IMPORTANT');
    });

    it('returns null for unmapped OTHER risk type', () => {
      const alert = mapIaRiskToAlert({
        id: 'r3',
        riskType: InitialAssessmentRiskType.OTHER,
        riskLevel: InitialAssessmentRiskLevel.LOW,
      });
      expect(alert).toBeNull();
    });
  });

  describe('mapMedicalConditionToAlert', () => {
    it('maps a known critical condition (epilepsy)', () => {
      const alert = mapMedicalConditionToAlert({ id: 'c1', code: 'EPILEPSY', name: 'Epilepsy' });
      expect(alert.tier).toBe('CRITICAL');
      expect(alert.source).toBe('ADMIN');
    });

    it('maps diabetes as important', () => {
      const alert = mapMedicalConditionToAlert({ id: 'c2', code: 'DIABETES', name: 'Diabetes' });
      expect(alert.tier).toBe('IMPORTANT');
    });

    it('defaults an unknown condition to info with a generic action line', () => {
      const alert = mapMedicalConditionToAlert({ id: 'c3', code: 'UNKNOWN_XYZ', name: 'Something' });
      expect(alert.tier).toBe('INFO');
      expect(alert.title).toBe('Something');
      expect(alert.actionLine).toBe('Be aware of this condition.');
    });
  });

  describe('mapReasonableAdjustmentToAlert / mapFlashMessageToAlert', () => {
    it('maps a reasonable adjustment to an info alert', () => {
      const alert = mapReasonableAdjustmentToAlert({ id: 'a1', description: 'Large print' });
      expect(alert!.tier).toBe('INFO');
    });

    it('returns null for an empty adjustment description', () => {
      expect(mapReasonableAdjustmentToAlert({ id: 'a2', description: '  ' })).toBeNull();
    });

    it('maps a flash message to an important alert carrying the message', () => {
      const alert = mapFlashMessageToAlert({ id: 'f1', message: 'Family visiting today' });
      expect(alert!.tier).toBe('IMPORTANT');
      expect(alert!.actionLine).toBe('Family visiting today');
    });
  });

  describe('sorting helpers', () => {
    it('orders critical before important before info', () => {
      const items: ServiceUserAlertItem[] = [
        mapMedicalConditionToAlert({ id: '1', code: 'DIABETES', name: 'Diabetes' }),
        mapMedicalConditionToAlert({ id: '2', code: 'EPILEPSY', name: 'Epilepsy' }),
        mapReasonableAdjustmentToAlert({ id: '3', description: 'Large print' })!,
      ];
      const sorted = [...items].sort(compareAlertsByTier);
      expect(sorted.map((a) => a.tier)).toEqual(['CRITICAL', 'IMPORTANT', 'INFO']);
      expect(countCriticalAlerts(items)).toBe(1);
    });
  });
});
