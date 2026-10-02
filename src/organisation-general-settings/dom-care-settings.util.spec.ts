import {
  defaultDomLateVisitZoneAlerts,
  domLateVisitBranchLabel,
  parseDomLateVisitZoneAlerts,
} from './dom-care-settings.util';

const HOUNSLOW = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Allfor Care Hounslow',
  location: { name: 'Allfor Care Hounslow' },
  zone: { name: 'London' },
};
const HARROW = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Allfor Care Harrow',
  location: null,
  zone: { name: 'London' },
};
const EMP = '55555555-5555-4555-8555-555555555555';

describe('dom care late-visit zone alerts', () => {
  it('labels branches like the admin (Location name, else "Zone - Branch")', () => {
    expect(domLateVisitBranchLabel(HOUNSLOW)).toBe('Allfor Care Hounslow');
    expect(domLateVisitBranchLabel(HARROW)).toBe('London - Allfor Care Harrow');
    expect(domLateVisitBranchLabel({ id: 'x', name: 'Solo' })).toBe('Solo');
  });

  it('defaults come from the real branches, never hard-coded sample names', () => {
    const defaults = defaultDomLateVisitZoneAlerts([HOUNSLOW, HARROW]);
    expect(defaults.map((d) => d.label)).toEqual([
      'Allfor Care Hounslow',
      'London - Allfor Care Harrow',
    ]);
    expect(defaults.map((d) => d.scheduleAreaId)).toEqual([
      HOUNSLOW.id,
      HARROW.id,
    ]);
    expect(defaultDomLateVisitZoneAlerts()).toEqual([]);
    expect(
      JSON.stringify(parseDomLateVisitZoneAlerts(null, [HOUNSLOW])),
    ).not.toContain('Croydon');
  });

  it('keeps saved recipients by scheduleAreaId (even after a rename) and drops missing branches', () => {
    const saved = [
      {
        zoneKey: 'old-hounslow-label',
        label: 'Old Hounslow label',
        scheduleAreaId: HOUNSLOW.id,
        emailEmployeeIds: [EMP],
        notificationEmployeeIds: [],
      },
      {
        zoneKey: 'croydon-croydon-2',
        label: 'Croydon - Croydon 2',
        scheduleAreaId: null,
        emailEmployeeIds: [EMP],
        notificationEmployeeIds: [EMP],
      },
      {
        zoneKey: 'deleted',
        label: 'Deleted branch',
        scheduleAreaId: '99999999-9999-4999-8999-999999999999',
        emailEmployeeIds: [EMP],
        notificationEmployeeIds: [],
      },
    ];
    const out = parseDomLateVisitZoneAlerts(saved, [HOUNSLOW, HARROW]);
    expect(out).toEqual([
      {
        zoneKey: 'allfor-care-hounslow',
        label: 'Allfor Care Hounslow',
        scheduleAreaId: HOUNSLOW.id,
        emailEmployeeIds: [EMP],
        notificationEmployeeIds: [],
      },
      {
        zoneKey: 'london-allfor-care-harrow',
        label: 'London - Allfor Care Harrow',
        scheduleAreaId: HARROW.id,
        emailEmployeeIds: [],
        notificationEmployeeIds: [],
      },
    ]);
  });

  it('adopts legacy label-keyed entries that match a live branch', () => {
    const out = parseDomLateVisitZoneAlerts(
      [
        {
          zoneKey: 'allfor-care-hounslow',
          label: 'Allfor Care Hounslow',
          scheduleAreaId: null,
          emailEmployeeIds: [],
          notificationEmployeeIds: [EMP],
        },
      ],
      [HOUNSLOW],
    );
    expect(out).toHaveLength(1);
    expect(out[0].scheduleAreaId).toBe(HOUNSLOW.id);
    expect(out[0].notificationEmployeeIds).toEqual([EMP]);
  });

  it('without branch context returns the saved entries only', () => {
    expect(parseDomLateVisitZoneAlerts(null)).toEqual([]);
    expect(
      parseDomLateVisitZoneAlerts([
        {
          zoneKey: 'k',
          label: 'K',
          scheduleAreaId: null,
          emailEmployeeIds: [],
          notificationEmployeeIds: [],
        },
      ]),
    ).toHaveLength(1);
  });
});
