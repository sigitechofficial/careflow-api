import {
  orgSettingsToEcmLayer,
  resolveEcmSettings,
} from './ecm-settings-resolver.util';
import { ECM_PLATFORM_DEFAULTS } from './ecm-timing.util';

describe('ecm-settings-resolver.util', () => {
  it('defaults to platform when nothing else is set', () => {
    const resolved = resolveEcmSettings({});
    expect(resolved.lateArrivalToleranceMinutes).toBe(
      ECM_PLATFORM_DEFAULTS.lateArrivalToleranceMinutes,
    );
    expect(resolved.appliedSettingsLevel).toBe('PLATFORM');
    expect(resolved.fieldSources.lateArrivalToleranceMinutes).toBe('PLATFORM');
  });

  it('organisation overrides platform', () => {
    const resolved = resolveEcmSettings({
      organisation: orgSettingsToEcmLayer({
        domLateVisitAlertMinutes: 20,
        domGeofenceDistanceMeters: 150,
      }),
    });
    expect(resolved.lateArrivalToleranceMinutes).toBe(20);
    expect(resolved.geofenceRadiusMeters).toBe(150);
    expect(resolved.appliedSettingsLevel).toBe('ORGANISATION');
    expect(resolved.thresholdRuleVersion).toBe('org-late-20');
  });

  it('visit override wins over organisation and slot', () => {
    const resolved = resolveEcmSettings({
      organisation: { lateArrivalToleranceMinutes: 20 },
      slotTimeCritical: true,
      slotTimeToleranceMinutes: 10,
      visit: { lateArrivalToleranceMinutes: 5, criticality: 'PRIORITY' },
    });
    expect(resolved.lateArrivalToleranceMinutes).toBe(5);
    expect(resolved.criticality).toBe('PRIORITY');
    expect(resolved.appliedSettingsLevel).toBe('VISIT');
    expect(resolved.fieldSources.lateArrivalToleranceMinutes).toBe('VISIT');
  });

  it('time-critical slot raises criticality when no visit override', () => {
    const resolved = resolveEcmSettings({
      organisation: { lateArrivalToleranceMinutes: 20 },
      slotTimeCritical: true,
      slotTimeToleranceMinutes: 8,
    });
    expect(resolved.criticality).toBe('TIME_CRITICAL');
    expect(resolved.lateArrivalToleranceMinutes).toBe(8);
    expect(resolved.appliedSettingsLevel).toBe('VISIT_TEMPLATE');
  });

  it('keeps veryLate strictly after late tolerance', () => {
    const resolved = resolveEcmSettings({
      visit: {
        lateArrivalToleranceMinutes: 20,
        veryLateThresholdMinutes: 10,
      },
    });
    expect(resolved.veryLateThresholdMinutes).toBeGreaterThan(
      resolved.lateArrivalToleranceMinutes,
    );
  });

  it('precedence: contract over branch over org', () => {
    const resolved = resolveEcmSettings({
      organisation: { lateArrivalToleranceMinutes: 30 },
      branch: { lateArrivalToleranceMinutes: 25 },
      contract: { lateArrivalToleranceMinutes: 12 },
    });
    expect(resolved.lateArrivalToleranceMinutes).toBe(12);
    expect(resolved.appliedSettingsLevel).toBe('CONTRACT');
  });
});
