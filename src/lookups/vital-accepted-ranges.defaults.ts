export const VITAL_ACCEPTED_RANGE_DEFAULTS = [
  { fieldKey: 'temperature', label: 'Temperature', unit: '°C', min: 30, max: 45, sortOrder: 1, column: 'left' },
  { fieldKey: 'respirations', label: 'Respirations', unit: '/min', min: 5, max: 60, sortOrder: 2, column: 'left' },
  { fieldKey: 'bpDiastolic', label: 'Diastolic BP', unit: 'mmHg', min: 30, max: 150, sortOrder: 3, column: 'left' },
  { fieldKey: 'bloodGlucose', label: 'Blood glucose', unit: 'mmol/L', min: 1, max: 40, sortOrder: 4, column: 'left' },
  { fieldKey: 'pulse', label: 'Pulse', unit: 'bpm', min: 30, max: 250, sortOrder: 5, column: 'right' },
  { fieldKey: 'bpSystolic', label: 'Systolic BP', unit: 'mmHg', min: 50, max: 250, sortOrder: 6, column: 'right' },
  { fieldKey: 'spo2', label: 'SpO₂', unit: '%', min: 50, max: 100, sortOrder: 7, column: 'right' },
] as const;
