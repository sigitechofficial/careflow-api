import { BadRequestException } from '@nestjs/common';
import { CarerMessageAudience } from '@prisma/client';
import { carerMessageRecipientWhere } from './carer-messages.service';

describe('carerMessageRecipientWhere', () => {
  const base = { deletedAt: null, isActive: true };

  it('ALL: every active, not-deleted employee', () => {
    expect(carerMessageRecipientWhere({ audience: CarerMessageAudience.ALL })).toEqual(base);
  });

  it('ALL ignores any branches or employees sent with it', () => {
    expect(
      carerMessageRecipientWhere({ audience: CarerMessageAudience.ALL, locationIds: ['a'], employeeIds: ['b'] }),
    ).toEqual(base);
  });

  it('BRANCHES: employment branch in the picked branches (de-duplicated)', () => {
    expect(carerMessageRecipientWhere({ audience: CarerMessageAudience.BRANCHES, locationIds: ['l1', 'l1', 'l2'] })).toEqual({
      ...base,
      employment: { locationId: { in: ['l1', 'l2'] } },
    });
  });

  it('BRANCHES needs at least one branch', () => {
    expect(() => carerMessageRecipientWhere({ audience: CarerMessageAudience.BRANCHES, locationIds: [] })).toThrow(
      BadRequestException,
    );
  });

  it('EMPLOYEES: picked employees, still only active ones', () => {
    expect(carerMessageRecipientWhere({ audience: CarerMessageAudience.EMPLOYEES, employeeIds: ['e1', 'e2', 'e1'] })).toEqual({
      ...base,
      id: { in: ['e1', 'e2'] },
    });
  });

  it('EMPLOYEES needs at least one carer', () => {
    expect(() => carerMessageRecipientWhere({ audience: CarerMessageAudience.EMPLOYEES })).toThrow(BadRequestException);
  });
});
