import {
  buildMarAdminEchoFields,
  parseLegacyMarNotes,
  echoMarOutcomeCode,
} from './employee-app-mar-echo.util';
import { MedicationAdministrationStatus } from '@prisma/client';

describe('employee-app-mar-echo.util', () => {
  it('prefers letter outcome codes over Prisma status enum', () => {
    expect(echoMarOutcomeCode('G', MedicationAdministrationStatus.GIVEN)).toBe('G');
    expect(echoMarOutcomeCode(null, MedicationAdministrationStatus.GIVEN)).toBe('G');
  });

  it('parses legacy mashed notes', () => {
    expect(parseLegacyMarNotes('Given · Support: Assisted · test note')).toEqual({
      outcomeLabel: 'Given',
      supportLevel: 'Assisted',
      notes: 'test note',
    });
  });

  it('echoes structured administration fields', () => {
    const echo = buildMarAdminEchoFields({
      id: 'evt-1',
      status: MedicationAdministrationStatus.GIVEN,
      statusCode: 'G',
      supportLevel: 'Assisted',
      timeGiven: '09:15',
      outcomeLabel: 'Given',
      notes: 'test note',
      reason: null,
      actualDateTime: new Date('2026-08-12T09:15:00.000Z'),
      prnReason: null,
      prnOutcome: null,
      isPrn: false,
    });
    expect(echo).toMatchObject({
      administrationEventId: 'evt-1',
      done: true,
      outcomeCode: 'G',
      outcomeLabel: 'Given',
      supportLevel: 'Assisted',
      notes: 'test note',
      timeGiven: '09:15',
      administeredAt: '2026-08-12T09:15:00.000Z',
      deviceRecordedAt: '2026-08-12T09:15:00.000Z',
      witness: null,
    });
  });

  it('echoes a saved CD witness on the same medication record', () => {
    const echo = buildMarAdminEchoFields({
      id: 'evt-cd',
      status: MedicationAdministrationStatus.GIVEN,
      statusCode: 'G',
      witnessPresent: true,
      witnessName: 'Aisha Khan',
      witnessRelationCode: 'RELATIVE',
      witnessRelationDetail: 'Daughter',
      witnessNotes: null,
    });
    expect(echo.witness).toEqual({
      present: true,
      name: 'Aisha Khan',
      relationCode: 'RELATIVE',
      relationLabel: 'Relative',
      relationDetail: 'Daughter',
      notes: null,
    });
  });
});
