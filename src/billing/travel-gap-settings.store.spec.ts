import { BadRequestException } from '@nestjs/common';
import { detectInterVisitTravel } from './pay-inter-visit-travel.util';
import { assertValidTravelGapSettings, DEFAULT_TRAVEL_GAP_SETTINGS } from './travel-gap-settings.store';
import { estimateTravelBetween } from './visit-travel-distance.util';

const at = (hhmm: string) => new Date(`2026-10-23T${hhmm}:00.000Z`);
const twoVisits = (gapEnd: string) => [
  { reconciliationId: 'a', employeeId: 'e', visitRef: 'A', payStart: at('07:00'), payEnd: at('09:00'), serviceUserId: 'su1' },
  { reconciliationId: 'b', employeeId: 'e', visitRef: 'B', payStart: at(gapEnd), payEnd: at('12:00'), serviceUserId: 'su2' },
];

describe('travel gap settings', () => {
  it('accepts the defaults', () => {
    expect(() => assertValidTravelGapSettings(DEFAULT_TRAVEL_GAP_SETTINGS)).not.toThrow();
  });

  it('rejects limits out of order or out of range', () => {
    const bad = [
      { waitingGapMinutes: 60, breakGapMinutes: 60, wentHomeGapMinutes: 90 },
      { waitingGapMinutes: 15, breakGapMinutes: 120, wentHomeGapMinutes: 90 },
      { waitingGapMinutes: 0, breakGapMinutes: 60, wentHomeGapMinutes: 90 },
      { waitingGapMinutes: 15, breakGapMinutes: 60, wentHomeGapMinutes: 721 },
    ];
    for (const s of bad) expect(() => assertValidTravelGapSettings(s)).toThrow(BadRequestException);
  });

  it('a 120-minute gap is unpaid with the defaults and paid travel with a 180-minute went-home limit', () => {
    const [byDefault] = detectInterVisitTravel(twoVisits('11:00'));
    expect(byDefault.payableTravelMinutes).toBe(0);

    const [raised] = detectInterVisitTravel(twoVisits('11:00'), {
      shortGapMinutes: 15,
      longBreakMinutes: 60,
      maxAutoTravelGapMinutes: 180,
    });
    expect(raised.payableTravelMinutes).toBe(120);
  });

  describe('DISTANCE basis', () => {
    // Enid (Chingford) and Margaret (Bromley): about 6.2 miles apart in a straight line.
    const enid = { latitude: 51.632, longitude: 0.001 }
    const margaret = { latitude: 51.5421, longitude: 0.001 }
    const opts = { basis: 'DISTANCE' as const, timeZone: 'Europe/London' }
    const located = (start: string, b = margaret) => {
      const [first, second] = twoVisits(start)
      return [{ ...first, ...enid }, { ...second, ...b }]
    }

    it('pays the drive, not the gap, however long the gap, with the same estimate as the visit fill', () => {
      const estimate = estimateTravelBetween({ lat: enid.latitude, lng: enid.longitude }, { lat: margaret.latitude, lng: margaret.longitude })
      for (const start of ['09:30', '11:00', '15:00']) {
        const [j] = detectInterVisitTravel(located(start), opts)
        expect(j.classification).toBe('PAID_TRAVEL')
        expect(j.travelMiles).toBe(estimate?.miles)
        expect(j.travelMiles).toBe(8.4)
        expect(j.payableTravelMinutes).toBe(estimate?.minutes)
        expect(j.payableWaitingMinutes).toBe(0)
      }
    })

    it('pays nothing once the date changes, or between visits to the same person', () => {
      const [first, second] = located('11:00')
      const nextDay = { ...second, payStart: new Date('2026-10-24T08:00:00.000Z'), payEnd: new Date('2026-10-24T09:00:00.000Z') }
      expect(detectInterVisitTravel([first, nextDay], opts)).toEqual([])
      expect(detectInterVisitTravel([first, { ...second, serviceUserId: 'su1' }], opts)).toEqual([])
    })

    it('flags a missing map location or an implausible journey for review, unpaid', () => {
      const [first, second] = twoVisits('11:00')
      const [missing] = detectInterVisitTravel([{ ...first, ...enid }, second], opts)
      expect(missing.requiresManagerReview).toBe(true)
      expect(missing.payableTravelMinutes).toBe(0)
      const [far] = detectInterVisitTravel(located('11:00', { latitude: 31.4639, longitude: 74.2425 }), opts)
      expect(far.requiresManagerReview).toBe(true)
      expect(far.payableTravelMinutes).toBe(0)
    })
  })

  it('switched off: no automatic journeys, travel entered by hand is kept', () => {
    expect(detectInterVisitTravel(twoVisits('09:30'), { autoPayGaps: false })).toEqual([]);
    const [manual] = detectInterVisitTravel(
      [twoVisits('09:30')[0], { ...twoVisits('09:30')[1], manualTravelMinutes: 20 }],
      { autoPayGaps: false },
    );
    expect(manual.classification).toBe('PAID_TRAVEL');
  });
});
