/** Guidance-only accepted ranges for §4 vital signs (RESTORE2 / NEWS2 score 0). */
export type VitalAcceptedRangeLookupRow = {
  fieldKey: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  sortOrder: number;
  column: 'left' | 'right';
};

export const VITAL_ACCEPTED_RANGE_LOOKUP: VitalAcceptedRangeLookupRow[] = [
  { fieldKey: 'temperature', label: 'Temperature', unit: '°C', min: 36.1, max: 38.0, sortOrder: 1, column: 'left' },
  { fieldKey: 'respirations', label: 'Respirations', unit: '/min', min: 12, max: 20, sortOrder: 2, column: 'left' },
  { fieldKey: 'bpDiastolic', label: 'Diastolic BP', unit: 'mmHg', min: 60, max: 90, sortOrder: 3, column: 'left' },
  { fieldKey: 'bloodGlucose', label: 'Blood glucose', unit: 'mmol/L', min: 4.0, max: 11.0, sortOrder: 4, column: 'left' },
  { fieldKey: 'pulse', label: 'Pulse', unit: 'bpm', min: 51, max: 90, sortOrder: 5, column: 'right' },
  { fieldKey: 'bpSystolic', label: 'Systolic BP', unit: 'mmHg', min: 111, max: 219, sortOrder: 6, column: 'right' },
  { fieldKey: 'spo2', label: 'SpO₂', unit: '%', min: 96, max: 100, sortOrder: 7, column: 'right' },
];
