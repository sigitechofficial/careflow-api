import { matchComplianceTypeForCertificate } from './evidence-match.util';

describe('matchComplianceTypeForCertificate', () => {
  const types = [
    { id: 'dl', name: 'Driving Licence' },
    { id: 'cc', name: 'Care Certificate' },
    { id: 'mh', name: 'Manual Handling' },
    { id: 'dbs', name: 'DBS' },
    { id: 'tr', name: 'TRAINING' },
  ];
  it('matches on whole words, ignoring case and spelling of licence', () => {
    expect(matchComplianceTypeForCertificate('Full UK driving license', types)?.id).toBe('dl');
    expect(matchComplianceTypeForCertificate('Care Certificate awarded', types)?.id).toBe('cc');
  });
  it('leaves unrelated certificates alone', () => {
    expect(matchComplianceTypeForCertificate('Hoist operator certificate', types)).toBeNull();
    expect(matchComplianceTypeForCertificate('Moving & handling competency certificate', types)).toBeNull();
    expect(matchComplianceTypeForCertificate('', types)).toBeNull();
  });
  it('does not match part of a word', () => {
    expect(matchComplianceTypeForCertificate('Retraining record', types)).toBeNull();
  });
});
