/**
 * ECM settings resolver (BE1.6).
 * Precedence (most specific wins):
 *   Individual visit → Visit template → Service user → Commissioner contract
 *   → Branch → Organisation → Platform default
 *
 * Every evaluation must expose which level supplied the applied rule.
 */

import {
  ECM_PLATFORM_DEFAULTS,
  type EcmTimingThresholds,
} from './ecm-timing.util';

export type EcmSettingsLevelCode =
  | 'PLATFORM'
  | 'ORGANISATION'
  | 'BRANCH'
  | 'CONTRACT'
  | 'SERVICE_USER'
  | 'VISIT_TEMPLATE'
  | 'VISIT';

export type EcmCriticalityCode = 'STANDARD' | 'PRIORITY' | 'TIME_CRITICAL';

export type EcmSettingsLayer = Partial<EcmTimingThresholds> & {
  geofenceRadiusMeters?: number | null;
  thresholdRuleVersion?: string | null;
  criticality?: EcmCriticalityCode | null;
  allowEarlyCheckIn?: boolean | null;
  earlyCheckInRequiresApproval?: boolean | null;
};

export type EcmSettingsResolverInput = {
  platform?: EcmSettingsLayer | null;
  organisation?: EcmSettingsLayer | null;
  branch?: EcmSettingsLayer | null;
  contract?: EcmSettingsLayer | null;
  serviceUser?: EcmSettingsLayer | null;
  visitTemplate?: EcmSettingsLayer | null;
  visit?: EcmSettingsLayer | null;
  /** Slot time-critical maps to TIME_CRITICAL criticality + slot tolerance. */
  slotTimeCritical?: boolean | null;
  slotTimeToleranceMinutes?: number | null;
};

export type EcmResolvedSettings = EcmTimingThresholds & {
  geofenceRadiusMeters: number;
  thresholdRuleVersion: string;
  criticality: EcmCriticalityCode;
  allowEarlyCheckIn: boolean;
  earlyCheckInRequiresApproval: boolean;
  appliedSettingsLevel: EcmSettingsLevelCode;
  /** Per-field: which level last wrote a non-null value. */
  fieldSources: Partial<Record<keyof EcmTimingThresholds | 'geofenceRadiusMeters' | 'criticality', EcmSettingsLevelCode>>;
};

const LEVEL_ORDER: { key: keyof EcmSettingsResolverInput; level: EcmSettingsLevelCode }[] = [
  { key: 'platform', level: 'PLATFORM' },
  { key: 'organisation', level: 'ORGANISATION' },
  { key: 'branch', level: 'BRANCH' },
  { key: 'contract', level: 'CONTRACT' },
  { key: 'serviceUser', level: 'SERVICE_USER' },
  { key: 'visitTemplate', level: 'VISIT_TEMPLATE' },
  { key: 'visit', level: 'VISIT' },
];

const THRESHOLD_KEYS: (keyof EcmTimingThresholds)[] = [
  'lateArrivalToleranceMinutes',
  'veryLateThresholdMinutes',
  'earlyArrivalToleranceMinutes',
  'shortVisitToleranceMinutes',
  'shortVisitTolerancePercent',
  'longVisitToleranceMinutes',
  'excessiveOverrunMinutes',
  'missedVisitThresholdMinutes',
];

function isPresentNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Map org Dom Care settings into an ECM organisation layer.
 */
export function orgSettingsToEcmLayer(org: {
  domLateVisitAlertMinutes?: number | null;
  domGlobalToleranceMinutes?: number | null;
  domGeofenceDistanceMeters?: number | null;
  domGeofenceToleranceMeters?: number | null;
} | null | undefined): EcmSettingsLayer {
  if (!org) return {};
  const late =
    isPresentNumber(org.domLateVisitAlertMinutes) && org.domLateVisitAlertMinutes > 0
      ? Math.floor(org.domLateVisitAlertMinutes)
      : isPresentNumber(org.domGlobalToleranceMinutes) && org.domGlobalToleranceMinutes > 0
        ? Math.floor(org.domGlobalToleranceMinutes)
        : undefined;

  const geofence =
    isPresentNumber(org.domGeofenceDistanceMeters) && org.domGeofenceDistanceMeters > 0
      ? Math.floor(org.domGeofenceDistanceMeters)
      : isPresentNumber(org.domGeofenceToleranceMeters) && org.domGeofenceToleranceMeters > 0
        ? Math.floor(org.domGeofenceToleranceMeters)
        : undefined;

  return {
    ...(late != null
      ? {
          lateArrivalToleranceMinutes: late,
          earlyArrivalToleranceMinutes: late,
          veryLateThresholdMinutes: Math.max(late * 2, late + 15),
          missedVisitThresholdMinutes: Math.max(late * 3, 60),
        }
      : {}),
    ...(geofence != null ? { geofenceRadiusMeters: geofence } : {}),
    thresholdRuleVersion: late != null ? `org-late-${late}` : undefined,
  };
}

export function resolveEcmSettings(input: EcmSettingsResolverInput): EcmResolvedSettings {
  const platform: EcmSettingsLayer = {
    ...ECM_PLATFORM_DEFAULTS,
    ...(input.platform ?? {}),
  };

  let lateArrivalToleranceMinutes = platform.lateArrivalToleranceMinutes!;
  let veryLateThresholdMinutes = platform.veryLateThresholdMinutes!;
  let earlyArrivalToleranceMinutes = platform.earlyArrivalToleranceMinutes!;
  let shortVisitToleranceMinutes = platform.shortVisitToleranceMinutes!;
  let shortVisitTolerancePercent = platform.shortVisitTolerancePercent!;
  let longVisitToleranceMinutes = platform.longVisitToleranceMinutes!;
  let excessiveOverrunMinutes = platform.excessiveOverrunMinutes!;
  let missedVisitThresholdMinutes = platform.missedVisitThresholdMinutes!;
  let geofenceRadiusMeters = platform.geofenceRadiusMeters ?? ECM_PLATFORM_DEFAULTS.geofenceRadiusMeters;
  let thresholdRuleVersion =
    platform.thresholdRuleVersion ?? ECM_PLATFORM_DEFAULTS.thresholdRuleVersion;
  let criticality: EcmCriticalityCode = 'STANDARD';
  let allowEarlyCheckIn = true;
  let earlyCheckInRequiresApproval = false;
  let appliedSettingsLevel: EcmSettingsLevelCode = 'PLATFORM';

  const fieldSources: EcmResolvedSettings['fieldSources'] = {};
  for (const key of THRESHOLD_KEYS) {
    fieldSources[key] = 'PLATFORM';
  }
  fieldSources.geofenceRadiusMeters = 'PLATFORM';
  fieldSources.criticality = 'PLATFORM';

  const layers: { layer: EcmSettingsLayer; level: EcmSettingsLevelCode }[] = [
    { layer: platform, level: 'PLATFORM' },
  ];

  for (const { key, level } of LEVEL_ORDER) {
    if (key === 'platform') continue;
    // Inject time-critical slot as VISIT_TEMPLATE immediately before VISIT.
    if (key === 'visit' && input.slotTimeCritical) {
      const slotTol = input.slotTimeToleranceMinutes;
      layers.push({
        level: 'VISIT_TEMPLATE',
        layer: {
          criticality: 'TIME_CRITICAL',
          ...(isPresentNumber(slotTol)
            ? {
                lateArrivalToleranceMinutes: Math.floor(slotTol),
                earlyArrivalToleranceMinutes: Math.floor(slotTol),
                veryLateThresholdMinutes: Math.max(
                  Math.floor(slotTol) * 2,
                  Math.floor(slotTol) + 10,
                ),
              }
            : {}),
        },
      });
    }
    const layer = input[key] as EcmSettingsLayer | null | undefined;
    if (layer && Object.keys(layer).length > 0) {
      layers.push({ layer, level });
    }
  }

  // If there is no visit layer but slot is time-critical, still apply slot.
  if (input.slotTimeCritical && !input.visit) {
    const already = layers.some((l) => l.level === 'VISIT_TEMPLATE');
    if (!already) {
      const slotTol = input.slotTimeToleranceMinutes;
      layers.push({
        level: 'VISIT_TEMPLATE',
        layer: {
          criticality: 'TIME_CRITICAL',
          ...(isPresentNumber(slotTol)
            ? {
                lateArrivalToleranceMinutes: Math.floor(slotTol),
                earlyArrivalToleranceMinutes: Math.floor(slotTol),
                veryLateThresholdMinutes: Math.max(
                  Math.floor(slotTol) * 2,
                  Math.floor(slotTol) + 10,
                ),
              }
            : {}),
        },
      });
    }
  }

  for (const { layer, level } of layers) {
    let touched = false;
    for (const key of THRESHOLD_KEYS) {
      const v = layer[key];
      if (isPresentNumber(v)) {
        switch (key) {
          case 'lateArrivalToleranceMinutes':
            lateArrivalToleranceMinutes = Math.floor(v);
            break;
          case 'veryLateThresholdMinutes':
            veryLateThresholdMinutes = Math.floor(v);
            break;
          case 'earlyArrivalToleranceMinutes':
            earlyArrivalToleranceMinutes = Math.floor(v);
            break;
          case 'shortVisitToleranceMinutes':
            shortVisitToleranceMinutes = Math.floor(v);
            break;
          case 'shortVisitTolerancePercent':
            shortVisitTolerancePercent = Math.floor(v);
            break;
          case 'longVisitToleranceMinutes':
            longVisitToleranceMinutes = Math.floor(v);
            break;
          case 'excessiveOverrunMinutes':
            excessiveOverrunMinutes = Math.floor(v);
            break;
          case 'missedVisitThresholdMinutes':
            missedVisitThresholdMinutes = Math.floor(v);
            break;
        }
        fieldSources[key] = level;
        touched = true;
      }
    }
    if (isPresentNumber(layer.geofenceRadiusMeters)) {
      geofenceRadiusMeters = Math.floor(layer.geofenceRadiusMeters);
      fieldSources.geofenceRadiusMeters = level;
      touched = true;
    }
    if (layer.thresholdRuleVersion?.trim()) {
      thresholdRuleVersion = layer.thresholdRuleVersion.trim();
      touched = true;
    }
    if (layer.criticality) {
      criticality = layer.criticality;
      fieldSources.criticality = level;
      touched = true;
    }
    if (typeof layer.allowEarlyCheckIn === 'boolean') {
      allowEarlyCheckIn = layer.allowEarlyCheckIn;
      touched = true;
    }
    if (typeof layer.earlyCheckInRequiresApproval === 'boolean') {
      earlyCheckInRequiresApproval = layer.earlyCheckInRequiresApproval;
      touched = true;
    }
    if (touched && level !== 'PLATFORM') {
      appliedSettingsLevel = level;
    }
  }

  // Ensure very-late is always strictly after late.
  if (veryLateThresholdMinutes <= lateArrivalToleranceMinutes) {
    veryLateThresholdMinutes = lateArrivalToleranceMinutes + 15;
  }

  return {
    lateArrivalToleranceMinutes,
    veryLateThresholdMinutes,
    earlyArrivalToleranceMinutes,
    shortVisitToleranceMinutes,
    shortVisitTolerancePercent,
    longVisitToleranceMinutes,
    excessiveOverrunMinutes,
    missedVisitThresholdMinutes,
    geofenceRadiusMeters,
    thresholdRuleVersion,
    criticality,
    allowEarlyCheckIn,
    earlyCheckInRequiresApproval,
    appliedSettingsLevel,
    fieldSources,
  };
}
