export const OTHER_LEFT_AREA_ALLOW_REASON_CODE = 'OTHER';

export const DEFAULT_LEFT_AREA_ALLOW_REASONS = [
  {
    code: 'ACCOMPANY_GP',
    label: 'Accompanying to GP / appointment',
    requiresNotes: false,
    sortOrder: 10,
  },
  {
    code: 'PHARMACY',
    label: 'Pharmacy / collecting medication',
    requiresNotes: false,
    sortOrder: 20,
  },
  {
    code: 'OUTING_WITH_PERSON',
    label: 'Shopping or outing with the person',
    requiresNotes: false,
    sortOrder: 30,
  },
  {
    code: 'WAITING_IN_CAR',
    label: 'Waiting in the car / parking',
    requiresNotes: false,
    sortOrder: 40,
  },
  {
    code: 'HOSPITAL_ESCORT',
    label: 'Hospital or emergency escort',
    requiresNotes: false,
    sortOrder: 50,
  },
  {
    code: 'GPS_INACCURATE',
    label: 'Still with the person, GPS inaccurate',
    requiresNotes: false,
    sortOrder: 60,
  },
  {
    code: OTHER_LEFT_AREA_ALLOW_REASON_CODE,
    label: 'Other reason',
    requiresNotes: true,
    sortOrder: 99,
  },
] as const;
