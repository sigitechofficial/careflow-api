/** Spec §5 — default administration time slots */
export type MedicationRoundSeedRow = {
  name: string;
  code: string;
  time: string;
  windowStart: string;
  windowEnd: string;
  sortOrder: number;
};

export const DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS: MedicationRoundSeedRow[] = [
  { name: 'Morning', code: 'MORNING', time: '08:00', windowStart: '07:00', windowEnd: '11:00', sortOrder: 1 },
  { name: 'Midday', code: 'MIDDAY', time: '12:00', windowStart: '11:00', windowEnd: '14:00', sortOrder: 2 },
  { name: 'Afternoon', code: 'AFTERNOON', time: '15:00', windowStart: '14:00', windowEnd: '17:00', sortOrder: 3 },
  { name: 'Evening', code: 'EVENING', time: '18:00', windowStart: '17:00', windowEnd: '20:00', sortOrder: 4 },
  { name: 'Night', code: 'NIGHT', time: '22:00', windowStart: '20:00', windowEnd: '07:00', sortOrder: 5 },
];
