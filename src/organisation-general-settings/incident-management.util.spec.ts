import {
  DEFAULT_INCIDENT_SEVERITY_SETTINGS,
  DEFAULT_INCIDENT_WHO_INFORMED_SETTINGS,
  incidentCatalogForApp,
  parseIncidentSeveritySettings,
  parseIncidentWhoInformedSettings,
} from './incident-management.util';

describe('parseIncidentSeveritySettings', () => {
  it('keeps the fixed low/medium/high/critical scale', () => {
    const parsed = parseIncidentSeveritySettings([
      { key: 'high', required: false },
      { key: 'custom', label: 'Catastrophic', required: true },
    ]);
    expect(parsed.map((s) => s.key)).toEqual(['low', 'medium', 'high', 'critical']);
    expect(parsed.find((s) => s.key === 'high')?.required).toBe(false);
  });
});

describe('parseIncidentWhoInformedSettings', () => {
  it('merges defaults and keeps org extras', () => {
    const parsed = parseIncidentWhoInformedSettings([
      { key: 'office', required: false },
      { key: 'cqc', label: 'CQC', required: true },
    ]);
    expect(parsed.find((s) => s.key === 'office')?.required).toBe(false);
    expect(parsed.some((s) => s.key === 'cqc' && s.label === 'CQC')).toBe(true);
    expect(parsed.some((s) => s.key === 'gp')).toBe(true);
  });
});

describe('incidentCatalogForApp', () => {
  it('sends only required rows, or defaults when all are off', () => {
    const hidden = DEFAULT_INCIDENT_WHO_INFORMED_SETTINGS.map((s) => ({
      ...s,
      required: false,
    }));
    expect(incidentCatalogForApp(hidden, DEFAULT_INCIDENT_WHO_INFORMED_SETTINGS)).toEqual(
      DEFAULT_INCIDENT_WHO_INFORMED_SETTINGS.map((s) => ({ key: s.key, label: s.label })),
    );

    const mixed = DEFAULT_INCIDENT_SEVERITY_SETTINGS.map((s) => ({
      ...s,
      required: s.key === 'high' || s.key === 'critical',
    }));
    expect(incidentCatalogForApp(mixed, DEFAULT_INCIDENT_SEVERITY_SETTINGS)).toEqual([
      { key: 'high', label: 'High' },
      { key: 'critical', label: 'Critical' },
    ]);
  });
});
