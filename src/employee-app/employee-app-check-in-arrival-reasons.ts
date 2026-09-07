/**
 * Maps admin Settings clock-in arrival reason rows onto the employee-app
 * `clockInSettings.earlyArrivalReasons` / `lateArrivalReasons` shape.
 * Reasons are label-only — no catalog codes.
 */

export type EmployeeAppArrivalReasonOption = {
  label: string;
  requiresNotes?: boolean;
  enabled?: boolean;
  sortOrder?: number;
};

export function mapClockInArrivalReasonRow(row: {
  label: string;
  requiresNotes: boolean;
  sortOrder: number;
  isActive: boolean;
}): EmployeeAppArrivalReasonOption {
  return {
    label: row.label,
    requiresNotes: row.requiresNotes,
    enabled: row.isActive,
    sortOrder: row.sortOrder,
  };
}
