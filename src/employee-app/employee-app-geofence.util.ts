/** Used when the organisation has no geofence distance saved. */
export const DEFAULT_GEOFENCE_DISTANCE_METERS = 100;

function positiveOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * How far from the visit address a carer may be and still count as "inside the visit
 * area": the organisation's geofence distance plus its tolerance (both set under
 * General settings → Dom Care).
 */
export function resolveCarerGeofenceRadiusMeters(
  settings:
    | {
        domGeofenceDistanceMeters?: number | null;
        domGeofenceToleranceMeters?: number | null;
      }
    | null
    | undefined,
): number {
  return (
    positiveOr(settings?.domGeofenceDistanceMeters, DEFAULT_GEOFENCE_DISTANCE_METERS) +
    positiveOr(settings?.domGeofenceToleranceMeters, 0)
  );
}
