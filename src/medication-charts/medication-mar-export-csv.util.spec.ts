import { buildMarExportCsv } from './medication-mar-export-csv.util';
import type { MarExportContext } from './medication-mar-export-shared.util';

const baseCtx: MarExportContext = {
  organisationName: 'CareFlow Demo',
  serviceUserId: 'su-1',
  serviceUserLabel: 'Margaret "Meg" Hughes',
  preferredName: 'Meg',
  dateOfBirth: '28/12/1932',
  nhsNumber: '3772451980',
  locationName: 'Croydon',
  allergySummary: 'Penicillin',
  reportMonth: '2026-05',
  reportMonthLabel: 'May 2026',
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  generatedAt: '26 May 2026, 10:00',
  generatedBy: 'Admin User',
  medicationCount: 1,
  administrationRowCount: 1,
  monthStats: {
    completionThroughDate: '2026-05-31',
    scheduledToDate: 10,
    documented: 8,
    stillOpen: 2,
    given: 7,
    notGiven: 1,
    marCompletionPercent: 80,
    prnAdministered: 3,
    due: 2,
    recorded: 8,
    compliancePercent: 80,
  },
};

describe('buildMarExportCsv', () => {
  it('produces enterprise sections with BOM and escaped fields', () => {
    const csv = buildMarExportCsv(baseCtx, {
      month: '2026-05',
      lastDay: 2,
      legend: [{ code: 'G', label: 'Given' }],
      medications: [
        {
          medicationId: '1',
          medicationName: 'Aspirin, 75mg',
          packName: 'Morning pack',
          dose: '1 tab',
          strength: '75mg',
          routeName: 'Oral',
          type: 'Tablet',
          frequency: 'Once daily',
          scheduleType: 'daily',
          timeSlot: 'Morning',
          dueTime: '08:00',
          roundWindowStart: '07:00',
          roundWindowEnd: '10:00',
          days: [
            {
              day: 1,
              date: '2026-05-01',
              cellState: 'recorded',
              recordId: 'e1',
              statusCode: 'G',
              statusLabel: 'Given',
              color: null,
              textColor: null,
              requiresReview: false,
            },
            {
              day: 2,
              date: '2026-05-02',
              cellState: 'na',
              recordId: null,
              statusCode: null,
              statusLabel: null,
              color: null,
              textColor: null,
              requiresReview: false,
            },
          ],
        },
      ],
    });

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('=== REPORT HEADER ===');
    expect(csv).toContain('=== MAR COMPLETION (TO DATE) ===');
    expect(csv).toContain('MAR completion,80%');
    expect(csv).toContain('=== STATUS LEGEND ===');
    expect(csv).toContain('=== DAILY ADMINISTRATION MATRIX ===');
    expect(csv).toContain('=== ADMINISTRATION DETAIL (LONG FORMAT) ===');
    expect(csv).toContain('"Aspirin, 75mg"');
    expect(csv).toContain('"Margaret ""Meg"" Hughes"');
    expect(csv).toContain('2026-05-01');
    expect(csv).toContain(',G,N/A');
    expect(csv).toContain('07:00–10:00');
    expect(csv).toContain('Not scheduled');
  });
});
