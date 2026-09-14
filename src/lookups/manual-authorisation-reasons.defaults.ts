export const OTHER_MANUAL_AUTHORISATION_REASON_CODE = 'OTHER';

export const DEFAULT_MANUAL_AUTHORISATION_REASONS = [
  {
    code: 'GPS_NOT_WORKING',
    label: 'GPS not working',
    requiresNotes: false,
    sortOrder: 10,
  },
  {
    code: 'GEO_PIN_INCORRECT',
    label: 'Visit address or geofence is incorrect',
    requiresNotes: false,
    sortOrder: 20,
  },
  {
    code: 'AT_PROPERTY_OUTSIDE_RADIUS',
    label: 'Carer is at the property',
    requiresNotes: false,
    sortOrder: 30,
  },
  {
    code: 'PARKING_OR_ACCESS',
    label: 'Parking or access delay',
    requiresNotes: false,
    sortOrder: 40,
  },
  {
    code: 'SERVICE_USER_ELSEWHERE',
    label: 'Service user not at usual address',
    requiresNotes: false,
    sortOrder: 50,
  },
  {
    code: 'DEVICE_LOCATION_ISSUE',
    label: 'Device or app location issue',
    requiresNotes: false,
    sortOrder: 60,
  },
  {
    code: OTHER_MANUAL_AUTHORISATION_REASON_CODE,
    label: 'Other reason',
    requiresNotes: true,
    sortOrder: 99,
  },
] as const;
