import { syncLeavingRecordFromEmployment } from './employee-leaving-sync.util';

function tx(live: Array<{ id: string; leavingDate: Date; leavingReasonId: string | null; notes: string | null }>) {
  return {
    employeeLeavingRecord: {
      findMany: jest.fn().mockResolvedValue(live),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
  } as any;
}
const d = new Date('2026-12-31T00:00:00Z');

describe('syncLeavingRecordFromEmployment', () => {
  it('creates the leaving record when an end date is first entered (notice given)', async () => {
    const t = tx([]);
    await syncLeavingRecordFromEmployment(t, 'e1', 'u1', { endDate: d, leavingReasonId: 'r1', leavingNotes: ' moving ' });
    expect(t.employeeLeavingRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ employeeId: 'e1', leavingDate: d, leavingReasonId: 'r1', notes: 'moving' }),
    });
  });
  it('updates it when the date changes, without creating another', async () => {
    const t = tx([{ id: 'l1', leavingDate: new Date('2026-12-01T00:00:00Z'), leavingReasonId: 'r1', notes: null }]);
    await syncLeavingRecordFromEmployment(t, 'e1', 'u1', { endDate: d, leavingReasonId: 'r1', leavingNotes: null });
    expect(t.employeeLeavingRecord.create).not.toHaveBeenCalled();
    expect(t.employeeLeavingRecord.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'l1' } }));
  });
  it('leaves it alone when nothing changed', async () => {
    const t = tx([{ id: 'l1', leavingDate: d, leavingReasonId: null, notes: null }]);
    await syncLeavingRecordFromEmployment(t, 'e1', 'u1', { endDate: d, leavingReasonId: null, leavingNotes: '' });
    expect(t.employeeLeavingRecord.update).not.toHaveBeenCalled();
    expect(t.employeeLeavingRecord.updateMany).not.toHaveBeenCalled();
  });
  it('removes it when the end date is cleared', async () => {
    const t = tx([{ id: 'l1', leavingDate: d, leavingReasonId: null, notes: null }]);
    await syncLeavingRecordFromEmployment(t, 'e1', 'u1', { endDate: null, leavingReasonId: null, leavingNotes: null });
    expect(t.employeeLeavingRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['l1'] } }, data: expect.objectContaining({ isActive: false }) }),
    );
  });
});
