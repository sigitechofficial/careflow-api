export enum ScheduleReportType {
  ADJUSTMENT = 'ADJUSTMENT',
  CALL_OFF_VISIT = 'CALL_OFF_VISIT',
  DAILY_CARER_ALLOCATION = 'DAILY_CARER_ALLOCATION',
  GEO_FENCE = 'GEO_FENCE',
  HOUSEPACK = 'HOUSEPACK',
  MEDS_ADMINISTRATION = 'MEDS_ADMINISTRATION',
  SERVICE_USER_TEMPLATE_VISIT_SCHEDULE = 'SERVICE_USER_TEMPLATE_VISIT_SCHEDULE',
  SERVICE_USER_TIME_ANALYSIS = 'SERVICE_USER_TIME_ANALYSIS',
  SERVICE_USER_VISIT = 'SERVICE_USER_VISIT',
  SPOOF = 'SPOOF',
  VISIT_DETAIL = 'VISIT_DETAIL',
  EMPLOYEE_CAPACITY = 'EMPLOYEE_CAPACITY',
  SCHEDULED_JOBS_STATUS = 'SCHEDULED_JOBS_STATUS',
}

export const SCHEDULE_REPORT_TYPE_CATALOG: {
  type: ScheduleReportType;
  name: string;
  supported: boolean;
  endpoint?: string;
  message?: string;
}[] = [
  {
    type: ScheduleReportType.ADJUSTMENT,
    name: 'Adjustment Report',
    supported: false,
    message: 'This report requires future module integration.',
  },
  {
    type: ScheduleReportType.CALL_OFF_VISIT,
    name: 'Call off Visit Report',
    supported: true,
    endpoint: '/schedule-reports/call-off-visits',
  },
  {
    type: ScheduleReportType.DAILY_CARER_ALLOCATION,
    name: 'Daily Carer Allocation Report',
    supported: true,
    endpoint: '/schedule-reports/daily-carer-allocation',
  },
  {
    type: ScheduleReportType.GEO_FENCE,
    name: 'GeoFence Report',
    supported: false,
    message: 'This report requires future module integration.',
  },
  {
    type: ScheduleReportType.HOUSEPACK,
    name: 'Housepack Report',
    supported: false,
    message: 'This report requires future module integration.',
  },
  {
    type: ScheduleReportType.MEDS_ADMINISTRATION,
    name: 'Meds Administration Report',
    supported: false,
    message: 'Use medication-reports APIs for medication administration data.',
  },
  {
    type: ScheduleReportType.SERVICE_USER_TEMPLATE_VISIT_SCHEDULE,
    name: 'Service User Template Visit Schedule Report',
    supported: false,
    message: 'This report requires future module integration.',
  },
  {
    type: ScheduleReportType.SERVICE_USER_TIME_ANALYSIS,
    name: 'Service User Time Analysis',
    supported: true,
    endpoint: '/schedule-reports/service-user-time-analysis',
  },
  {
    type: ScheduleReportType.SERVICE_USER_VISIT,
    name: 'Service User Visit Report',
    supported: true,
    endpoint: '/schedule-reports/service-user-visits',
  },
  {
    type: ScheduleReportType.SPOOF,
    name: 'Spoof Report',
    supported: false,
    message: 'This report requires future module integration.',
  },
  {
    type: ScheduleReportType.VISIT_DETAIL,
    name: 'Visit Detail Report',
    supported: true,
    endpoint: '/schedule-reports/visit-detail',
  },
  {
    type: ScheduleReportType.EMPLOYEE_CAPACITY,
    name: 'Employee Capacity Report',
    supported: true,
    endpoint: '/schedule-reports/employee-capacity',
  },
  {
    type: ScheduleReportType.SCHEDULED_JOBS_STATUS,
    name: 'Scheduled Jobs Status Report',
    supported: true,
    endpoint: '/schedule-reports/scheduled-jobs-status',
  },
];
