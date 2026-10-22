/**
 * Travel between two service users' homes.
 *
 * Driving distance and time come from the Google Routes API. Without a key, or when Google does
 * not answer, they are estimated from the coordinates the way the rota does
 * (careflow-admin schedule-job-travel-distance.util).
 */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;
/** Straight-line distance underestimates driving distance in urban areas. */
export const ROAD_DISTANCE_FACTOR = 1.35;
/** Typical local driving speed for care visits (km/h), including lights and parking. */
export const AVERAGE_DRIVING_SPEED_KMH = 28;
const KM_PER_MILE = 1.609344;

export function latLngOf(
  latitude: { toString(): string } | number | null | undefined,
  longitude: { toString(): string } | number | null | undefined,
): LatLng | null {
  if (latitude == null || longitude == null) return null;
  const lat = Number(latitude.toString());
  const lng = Number(longitude.toString());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function haversineKm(from: LatLng, to: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type TravelBetween = { miles: number; minutes: number; source: 'GOOGLE' | 'ESTIMATE' };

function travelOf(roadKm: number, minutes: number, source: TravelBetween['source']): TravelBetween {
  return { miles: Math.round((roadKm / KM_PER_MILE) * 10) / 10, minutes: Math.max(1, Math.round(minutes)), source };
}

/** Road miles (1 decimal) and driving minutes from one home to another; null when they are the same place. */
export function estimateTravelBetween(from: LatLng, to: LatLng): TravelBetween | null {
  const roadKm = haversineKm(from, to) * ROAD_DISTANCE_FACTOR;
  if (!(roadKm > 0)) return null;
  return travelOf(roadKm, (roadKm / AVERAGE_DRIVING_SPEED_KMH) * 60, 'ESTIMATE');
}

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Driving distance and time from Google; null when Google gives no route. Throws when the call fails. */
export async function googleDrivingTravel(
  from: LatLng,
  to: LatLng,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TravelBetween | null> {
  const point = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const res = await fetchImpl(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
    },
    body: JSON.stringify({ origin: point(from), destination: point(to), travelMode: 'DRIVE' }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Google Routes API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { routes?: Array<{ distanceMeters?: number; duration?: string }> };
  const route = body.routes?.[0];
  const meters = route?.distanceMeters ?? 0;
  const seconds = Number.parseFloat(route?.duration ?? '');
  if (!(meters > 0) || !Number.isFinite(seconds)) return null;
  return travelOf(meters / 1000, seconds / 60, 'GOOGLE');
}

/** Google's driving distance and time when a key is set; otherwise, or when Google fails, the estimate. */
export async function travelBetween(
  from: LatLng,
  to: LatLng,
  options: { apiKey?: string | null; fetchImpl?: typeof fetch; onGoogleError?: (err: unknown) => void } = {},
): Promise<TravelBetween | null> {
  if (options.apiKey) {
    try {
      const google = await googleDrivingTravel(from, to, options.apiKey, options.fetchImpl);
      if (google) return google;
    } catch (err) {
      options.onGoogleError?.(err);
    }
  }
  return estimateTravelBetween(from, to);
}
