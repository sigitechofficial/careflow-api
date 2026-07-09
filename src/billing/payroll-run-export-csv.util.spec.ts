import {
  buildPayrollRunVisitLogCsv,
  formatTimeHhMmSs,
  formatVisitDateMmDdYy,
  resolveCareTypeExportCode,
  resolveEmonitored,
} from './payroll-run-export-csv.util';

describe('payroll-run-export-csv.util', () => {
  it('builds carer visit-log CSV in ECM column layout', () => {
    const csv = buildPayrollRunVisitLogCsv([
      {
        emonitored: 'LOGGED',
        carerId: 'E-1042',
        carerFirstName: 'Sarah',
        carerSecondName: 'Mitchell',
        carerAddress: '12 Oak Street',
        carerPostCode: 'UB5 6HJ',
        visitDate: '04-27-26',
        careType: 'PC',
        plannedArrival: '08:05:00',
        plannedDeparture: '09:05:00',
        actualArrival: '08:02:00',
        actualDeparture: '09:04:00',
        visitHours: '1.00',
        visitPay: '12.50',
        totalHoursWorked: '5.00',
        grossPay: '62.50',
      },
      {
        emonitored: 'NOT LOG',
        carerId: 'E-1042',
        carerFirstName: 'Sarah',
        carerSecondName: 'Mitchell',
        carerAddress: '12 Oak Street',
        carerPostCode: 'UB5 6HJ',
        visitDate: '04-28-26',
        careType: 'PC',
        plannedArrival: '20:35:00',
        plannedDeparture: '21:35:00',
        actualArrival: '00:00:00',
        actualDeparture: '00:00:00',
        visitHours: '1.00',
        visitPay: '12.50',
        totalHoursWorked: '5.00',
        grossPay: '62.50',
      },
    ]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(
      'EMONITORED,Carer ID,Carer First Name,Carer Second Name,Carer Address,Carer Post Code,Visit Date,Care Type,Planned Arrival,Planned Departure,Actual Arrival,Actual Departure,Hours,Pay (£),Total Hours Worked,Gross Pay (£)',
    );
    expect(csv).toContain(
      'LOGGED,E-1042,Sarah,Mitchell,12 Oak Street,UB5 6HJ,04-27-26,PC,08:05:00,09:05:00,08:02:00,09:04:00,1.00,12.50,5.00,62.50',
    );
    expect(csv).toContain(
      'NOT LOG,E-1042,Sarah,Mitchell,12 Oak Street,UB5 6HJ,04-28-26,PC,20:35:00,21:35:00,00:00:00,00:00:00',
    );
  });

  it('formats visit date and ECM monitoring flags', () => {
    expect(formatVisitDateMmDdYy(new Date('2026-04-27T08:05:00.000Z'))).toBe('04-27-26');
    expect(formatTimeHhMmSs(new Date('2026-04-27T08:05:00.000Z'))).toBe('08:05:00');
    expect(resolveCareTypeExportCode('DOMICILIARY')).toBe('PC');
    expect(resolveEmonitored(new Date(), new Date())).toBe('LOGGED');
    expect(resolveEmonitored(new Date(), null)).toBe('NOT LOG');
  });
});
