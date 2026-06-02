import { wrapApiEnvelope } from './api-envelope.example';

const SU_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const MED_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const EVENT_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const SCHEDULE_ID = 'd4e5f6a7-b8c9-0123-def0-234567890123';
const PACK_ID = 'e5f6a7b8-c9d0-1234-ef01-345678901234';
const MEMBER_ID = 'f6a7b8c9-d0e1-2345-f012-456789012345';
const SNAPSHOT_ID = 'a7b8c9d0-e1f2-3456-0123-567890123456';

/** GET /service-users/:id/medication-chart/regular?month=2026-05 */
export const MEDICATION_REGULAR_CHART_ENVELOPE_EXAMPLE = wrapApiEnvelope({
  month: '2026-05',
  lastDay: 31,
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  periodLabel: 'May 2026',
  dayDates: ['2026-05-01', '2026-05-02'],
  medicationCount: 1,
  scheduleRowCount: 1,
  legend: [
    {
      code: 'G',
      label: 'Given',
      color: '#2E7D32',
      textColor: '#FFFFFF',
      requiresReview: false,
    },
  ],
  summary: {
    date: '2026-05-28',
    due: 1,
    recorded: 2,
    missed: 0,
    reviewToday: 0,
  },
  monthStats: {
    completionThroughDate: '2026-05-28',
    scheduledToDate: 28,
    documented: 22,
    stillOpen: 6,
    given: 20,
    notGiven: 2,
    marCompletionPercent: 78.6,
    prnAdministered: 1,
    due: 6,
    recorded: 22,
    compliancePercent: 78.6,
  },
  medications: [
    {
      medicationId: MED_ID,
      scheduleId: SCHEDULE_ID,
      medicationName: 'Atorvastatin 20mg',
      packName: 'Morning pack',
      dose: '1 tab',
      strength: '20mg',
      routeName: 'Oral',
      type: 'Tablet',
      frequency: 'Once daily',
      scheduleType: 'daily',
      timeSlot: 'Morning',
      dueTime: '08:00',
      roundWindowStart: '07:00',
      roundWindowEnd: '10:00',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: null,
      days: [
        {
          day: 1,
          date: '2026-05-01',
          cellState: 'recorded',
          recordId: EVENT_ID,
          statusCode: 'G',
          statusLabel: 'Given',
          color: '#2E7D32',
          textColor: '#FFFFFF',
          requiresReview: false,
        },
        {
          day: 2,
          date: '2026-05-02',
          cellState: 'due',
          recordId: null,
          statusCode: 'Due',
          statusLabel: 'Due',
          color: '#FEF3C7',
          textColor: '#92400E',
          requiresReview: false,
        },
      ],
    },
  ],
});

/** GET /service-users/:id/medication-supply */
export const MEDICATION_SUPPLY_BUNDLE_ENVELOPE_EXAMPLE = wrapApiEnvelope({
  medications: [
    {
      medicationId: MED_ID,
      relatedMedicationIds: [MED_ID],
      medicationName: 'Atorvastatin 20mg',
      packName: 'Morning pack',
      dose: '1 tab',
      strength: '20mg',
      isControlledMedication: false,
      supplyModel: 'BLISTER_CYCLE',
      supplySummary: {
        supplyModel: 'BLISTER_CYCLE',
        quantityRemaining: 18,
        quantityTotal: 28,
        qtyUnit: 'tablets',
        daysRemaining: 12,
        deliveredAt: '2026-05-15T10:30:00.000Z',
        cycleEndDate: '2026-05-30',
        runsOutDate: '2026-05-30',
        expiresAt: null,
        openedAt: '2026-05-15',
        pharmacyName: 'Boots Pharmacy',
        packName: 'Morning pack',
      },
      recentDeliveries: [
        {
          id: 'e5f6a7b8-c9d0-1234-ef01-345678901234',
          deliveredAt: '2026-05-15T10:30:00.000Z',
          cycleEndDate: '2026-05-30',
          quantity: 28,
          pharmacyName: 'Boots Pharmacy',
          notes: '28-day blister tray',
          receivedBy: { id: 'f6a7b8c9-d0e1-2345-f012-456789012345', name: 'Jane Smith' },
          witnessBy: null,
        },
      ],
    },
  ],
});

const EVENT_BODY = {
  id: EVENT_ID,
  serviceUserId: SU_ID,
  serviceUserMedicationId: MED_ID,
  status: 'GIVEN',
  statusCode: 'G',
  scheduledDateTime: '2026-05-28T08:00:00.000Z',
  actualDateTime: '2026-05-28T08:12:00.000Z',
  doseGiven: '1 tab',
  reason: null,
  notes: null,
  isPrn: false,
  prnReason: null,
  managerReviewedAt: null,
  createdAt: '2026-05-28T08:12:05.000Z',
  medication: {
    id: MED_ID,
    medicationName: 'Atorvastatin 20mg',
    dose: '1 tab',
    strength: '20mg',
  },
  schedule: {
    id: SCHEDULE_ID,
    dueTime: '08:00',
    round: { id: 'f6a7b8c9-d0e1-2345-f012-456789012345', name: 'Morning', time: '08:00' },
  },
  administeredBy: {
    id: 'f6a7b8c9-d0e1-2345-f012-456789012345',
    name: 'Jane Smith',
  },
  enteredBy: null,
};

/** POST /service-users/:id/medication-events (201 — interceptor still wraps as success envelope) */
export const MEDICATION_EVENT_CREATED_ENVELOPE_EXAMPLE = wrapApiEnvelope(EVENT_BODY);

/** GET /service-users/:id/medication-events */
export const MEDICATION_EVENTS_LIST_ENVELOPE_EXAMPLE = wrapApiEnvelope(
  [EVENT_BODY],
  {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
);

/** GET /medication-reports/administered */
export const MEDICATION_ADMINISTERED_REPORT_ENVELOPE_EXAMPLE = wrapApiEnvelope(
  [
    {
      id: EVENT_ID,
      serviceUserId: SU_ID,
      serviceUserMedicationId: MED_ID,
      status: 'GIVEN',
      statusCode: 'G',
      actualDateTime: '2026-05-28T08:12:00.000Z',
      medication: { id: MED_ID, medicationName: 'Atorvastatin 20mg', category: { name: 'Cardiovascular' } },
      serviceUser: {
        id: SU_ID,
        firstName: 'Alex',
        lastName: 'Taylor',
        serviceUserNumber: 'SU-00142',
      },
      administeredBy: {
        id: 'f6a7b8c9-d0e1-2345-f012-456789012345',
        personalDetail: { firstName: 'Jane', lastName: 'Smith' },
      },
    },
  ],
  {
    page: 1,
    limit: 50,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
);

/** GET /service-users/:id/medication-packs/:packId/members */
export const MEDICATION_PACK_MEMBERS_LIST_ENVELOPE_EXAMPLE = wrapApiEnvelope([
  {
    id: MEMBER_ID,
    medicationPackId: PACK_ID,
    serviceUserMedicationId: MED_ID,
    status: 'ACTIVE',
    linkedAt: '2026-05-01T09:00:00.000Z',
    linkedById: 'f6a7b8c9-d0e1-2345-f012-456789012345',
    endedAt: null,
    endedById: null,
    serviceUserMedication: {
      id: MED_ID,
      medicationName: 'Amlodipine',
      strength: '5mg',
      dose: '1 tablet',
      routeName: 'Oral',
    },
  },
]);

/** POST /service-users/:id/medication-packs/:packId/publish (201) */
export const MEDICATION_PACK_PUBLISH_ENVELOPE_EXAMPLE = wrapApiEnvelope({
  id: SNAPSHOT_ID,
  medicationPackId: PACK_ID,
  cycleNumber: 1,
  packName: 'Morning & Evening blister pack',
  packType: 'BLISTER',
  pharmacyName: 'Boots Pharmacy',
  pharmacyPhone: '01234 567890',
  gpName: 'Dr Patel',
  gpSurgery: 'Riverside Medical Centre',
  nhsNumber: '9434765919',
  startDate: '2026-05-01T00:00:00.000Z',
  endDate: '2026-05-28T00:00:00.000Z',
  publishedAt: '2026-05-01T10:00:00.000Z',
  publishedById: 'f6a7b8c9-d0e1-2345-f012-456789012345',
  lines: [
    {
      compartmentLabel: 'Morning',
      medicationName: 'Amlodipine',
      strength: '5mg',
      dose: '1 tablet',
      routeName: 'Oral',
      frequency: 'Once daily',
      dueTime: '08:00',
      instructions: null,
    },
  ],
});
