import { isActiveForStatus, syncServiceUserActiveFlag } from './service-user-active-flag.util';

describe('isActiveForStatus', () => {
  it('keeps people in care, on hold or not yet started active', () => {
    for (const c of ['ACTIVE', 'ON_HOLD', 'PENDING', 'PRE_ADMISSION', null, undefined]) {
      expect(isActiveForStatus(c)).toBe(true);
    }
  });
  it('marks discharged, deceased and inactive people not active', () => {
    for (const c of ['DISCHARGED', 'DECEASED', 'INACTIVE']) expect(isActiveForStatus(c)).toBe(false);
  });
});

describe('syncServiceUserActiveFlag', () => {
  function tx(row: unknown) {
    return {
      serviceUser: { findFirst: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}) },
    } as any;
  }
  it('clears the flag when the person is discharged', async () => {
    const t = tx({ isActive: true, status: { code: 'DISCHARGED' } });
    await syncServiceUserActiveFlag(t, 'su1');
    expect(t.serviceUser.update).toHaveBeenCalledWith({ where: { id: 'su1' }, data: { isActive: false } });
  });
  it('sets it again when they come back into care', async () => {
    const t = tx({ isActive: false, status: { code: 'ACTIVE' } });
    await syncServiceUserActiveFlag(t, 'su1');
    expect(t.serviceUser.update).toHaveBeenCalledWith({ where: { id: 'su1' }, data: { isActive: true } });
  });
  it('does nothing when already in step', async () => {
    const t = tx({ isActive: true, status: { code: 'ON_HOLD' } });
    await syncServiceUserActiveFlag(t, 'su1');
    expect(t.serviceUser.update).not.toHaveBeenCalled();
  });
});
