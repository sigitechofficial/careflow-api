/**
 * Structured ECM reason codes (BE1.13).
 * Seeded via API; keep codes stable for reports / KPI exclusions.
 */
export type EcmReasonCodeCategory =
  | 'LATE'
  | 'SHORT'
  | 'LONG'
  | 'MISSED'
  | 'CANCEL'
  | 'AMEND'
  | 'SCHEDULE'
  | 'OTHER';

export type EcmReasonCodeDef = {
  code: string;
  category: EcmReasonCodeCategory;
  label: string;
};

export const ECM_REASON_CODES: EcmReasonCodeDef[] = [
  { code: 'LATE_PREVIOUS_OVERRUN', category: 'LATE', label: 'Previous visit overran' },
  { code: 'LATE_TRAFFIC', category: 'LATE', label: 'Traffic' },
  { code: 'LATE_INSUFFICIENT_TRAVEL', category: 'LATE', label: 'Insufficient travel time' },
  { code: 'LATE_VEHICLE', category: 'LATE', label: 'Vehicle breakdown' },
  { code: 'LATE_CARER_STARTED_LATE', category: 'LATE', label: 'Carer started late' },
  { code: 'LATE_CARER_SICKNESS', category: 'LATE', label: 'Carer sickness' },
  { code: 'LATE_EMERGENCY_REASSIGN', category: 'LATE', label: 'Emergency reassignment' },
  { code: 'LATE_INCORRECT_ROTA', category: 'LATE', label: 'Incorrect rota' },
  { code: 'LATE_ACCESS', category: 'LATE', label: 'Address / access problem' },
  { code: 'LATE_WEATHER', category: 'LATE', label: 'Weather' },
  { code: 'LATE_APP_ISSUE', category: 'LATE', label: 'Application issue' },
  { code: 'LATE_DEVICE_ISSUE', category: 'LATE', label: 'Device issue' },
  { code: 'LATE_OTHER', category: 'LATE', label: 'Other authorised reason' },

  { code: 'SHORT_SU_REQUESTED', category: 'SHORT', label: 'Service user requested early departure' },
  { code: 'SHORT_SU_REFUSED', category: 'SHORT', label: 'Service user refused visit' },
  { code: 'SHORT_SU_UNAVAILABLE', category: 'SHORT', label: 'Service user unavailable' },
  { code: 'SHORT_NO_ACCESS', category: 'SHORT', label: 'No access after initial attendance' },
  { code: 'SHORT_EXCESSIVE_PLANNED', category: 'SHORT', label: 'Visit scheduled for excessive duration' },
  { code: 'SHORT_EMERGENCY', category: 'SHORT', label: 'Emergency interrupted the visit' },
  { code: 'SHORT_LEFT_UNAUTHORISED', category: 'SHORT', label: 'Carer left without authorisation' },
  { code: 'SHORT_INCORRECT_PUNCH', category: 'SHORT', label: 'Incorrect check-in/check-out' },
  { code: 'SHORT_TECHNICAL', category: 'SHORT', label: 'Technical error' },
  { code: 'SHORT_OTHER', category: 'SHORT', label: 'Other authorised reason' },

  { code: 'LONG_ADDITIONAL_ASSISTANCE', category: 'LONG', label: 'Service user required additional assistance' },
  { code: 'LONG_EMERGENCY', category: 'LONG', label: 'Emergency' },
  { code: 'LONG_AWAITING_CLINICIAN', category: 'LONG', label: 'Ambulance or clinician awaited' },
  { code: 'LONG_ACCESS', category: 'LONG', label: 'Access issue' },
  { code: 'LONG_AWAITING_REPLACEMENT', category: 'LONG', label: 'Replacement carer awaited' },
  { code: 'LONG_PLANNED_INSUFFICIENT', category: 'LONG', label: 'Planned duration insufficient' },
  { code: 'LONG_FORGOT_CHECKOUT', category: 'LONG', label: 'Carer forgot to check out' },
  { code: 'LONG_DEVICE', category: 'LONG', label: 'Device / application issue' },
  { code: 'LONG_OTHER', category: 'LONG', label: 'Other authorised reason' },

  { code: 'MISSED_NO_ATTEND', category: 'MISSED', label: 'Carer did not attend' },
  { code: 'MISSED_ROTA_ERROR', category: 'MISSED', label: 'Rota error' },
  { code: 'MISSED_UNASSIGNED', category: 'MISSED', label: 'Unassigned visit' },
  { code: 'MISSED_SICKNESS', category: 'MISSED', label: 'Carer sickness' },
  { code: 'MISSED_PROVIDER_CANCEL', category: 'MISSED', label: 'Provider cancellation' },
  { code: 'MISSED_SU_CANCEL_UNRECORDED', category: 'MISSED', label: 'Service-user cancellation not recorded' },
  { code: 'MISSED_HOSPITAL_UNRECORDED', category: 'MISSED', label: 'Hospital admission not recorded' },
  { code: 'MISSED_DUPLICATE', category: 'MISSED', label: 'Duplicate visit' },
  { code: 'MISSED_NO_ACCESS', category: 'MISSED', label: 'No access' },
  { code: 'MISSED_TECHNICAL_EVIDENCE', category: 'MISSED', label: 'Technical attendance evidence missing' },
  { code: 'MISSED_DISPUTED', category: 'MISSED', label: 'Attendance disputed' },
  { code: 'MISSED_OTHER', category: 'MISSED', label: 'Other authorised reason' },

  { code: 'SCHEDULE_PLANNED_CHANGE', category: 'SCHEDULE', label: 'Planned schedule change' },
  { code: 'SCHEDULE_SU_REQUESTED', category: 'SCHEDULE', label: 'Service-user-requested change' },
  { code: 'SCHEDULE_PROVIDER_REQUESTED', category: 'SCHEDULE', label: 'Provider-requested change' },
  { code: 'SCHEDULE_EMERGENCY', category: 'SCHEDULE', label: 'Emergency change' },
  { code: 'SCHEDULE_SAME_DAY', category: 'SCHEDULE', label: 'Same-day change' },
  { code: 'SCHEDULE_LATE_NOTICE', category: 'SCHEDULE', label: 'Late-notice change' },
  { code: 'SCHEDULE_RETROSPECTIVE', category: 'SCHEDULE', label: 'Retrospective change' },
  { code: 'SCHEDULE_UNAUTHORISED', category: 'SCHEDULE', label: 'Unauthorised change' },

  { code: 'AMEND_CORRECTION', category: 'AMEND', label: 'Attendance correction' },
  { code: 'AMEND_FORGOTTEN_PUNCH', category: 'AMEND', label: 'Forgotten check-in/out' },
  { code: 'OTHER_AUTHORISED', category: 'OTHER', label: 'Other authorised reason' },
];

export function reasonCodesForExceptionKind(kind: string): EcmReasonCodeDef[] {
  const k = kind.toUpperCase();
  if (k.includes('LATE') || k.includes('EARLY_ARRIVAL')) {
    return ECM_REASON_CODES.filter((c) => c.category === 'LATE');
  }
  if (k.includes('SHORT') || k.includes('EARLY_DEPARTURE')) {
    return ECM_REASON_CODES.filter((c) => c.category === 'SHORT');
  }
  if (k.includes('LONG') || k.includes('OVERRUN')) {
    return ECM_REASON_CODES.filter((c) => c.category === 'LONG');
  }
  if (k.includes('MISSED')) {
    return ECM_REASON_CODES.filter((c) => c.category === 'MISSED');
  }
  if (k.includes('GEOFENCE') || k.includes('MANUAL') || k.includes('MOCK')) {
    return ECM_REASON_CODES.filter((c) => c.category === 'AMEND' || c.category === 'OTHER');
  }
  return ECM_REASON_CODES.filter((c) => c.category === 'OTHER' || c.category === 'AMEND');
}
