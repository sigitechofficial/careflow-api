import { EmployeeComplianceService } from './employee-compliance.service';

describe('EmployeeComplianceService.attachEvidence', () => {
  const type = { id: 'dl', name: 'Driving Licence', hasExpiry: true, requiresDocument: true, requiresVerification: true };
  const baseRow = {
    id: 'c1',
    status: 'MISSING',
    issueDate: null,
    expiryDate: null,
    submittedAt: null,
    verifiedAt: null,
    rejectedAt: null,
    isNoLongerRequired: false,
    documentUrl: null,
    complianceType: type,
    requirement: null,
    documents: [] as unknown[],
  };

  function setup(existing: Record<string, unknown> | null) {
    let row: Record<string, unknown> | null = existing ? { ...baseRow, ...existing } : null;
    const prisma: Record<string, unknown> = {
      complianceType: { findFirst: jest.fn(async () => type) },
      employeeCompliance: {
        findFirst: jest.fn(async () => row),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (row = { ...baseRow, ...data, id: 'new' })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (row = { ...row!, ...data })),
      },
      employeeComplianceDocument: {
        create: jest.fn(async () => {
          (row!.documents as unknown[]).push({ id: 'doc' });
          return { id: 'doc' };
        }),
      },
      complianceVerification: { create: jest.fn(async () => ({})) },
    };
    prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
    const service = new EmployeeComplianceService(prisma as never, { logAudit: jest.fn() } as never);
    jest
      .spyOn(service as unknown as { resolveRequirementId: () => Promise<null> }, 'resolveRequirementId')
      .mockResolvedValue(null);
    return { service, prisma, current: () => row };
  }

  const file = { fileUrl: '/f.pdf', fileName: 'f.pdf', originalName: 'licence.pdf', fileSize: 10, mimeType: 'application/pdf' };

  it('creates the compliance item when missing and files the document, waiting for checking', async () => {
    const { service, prisma, current } = setup(null);
    const out = await service.attachEvidence({
      userId: 'u1', employeeId: 'e1', complianceTypeId: 'dl', expiryDate: new Date('2030-01-01'), file, source: 'certification', sourceId: 'cert1',
    });
    expect(out).toEqual({ complianceId: 'new' });
    expect((prisma.employeeComplianceDocument as { create: jest.Mock }).create).toHaveBeenCalled();
    expect(current()!.status).toBe('PENDING_REVIEW');
  });

  it('newer evidence updates the dates and needs checking again', async () => {
    const { service, current } = setup({ expiryDate: new Date('2026-01-01'), verifiedAt: new Date('2025-01-01') });
    await service.attachEvidence({
      userId: 'u1', employeeId: 'e1', complianceTypeId: 'dl', expiryDate: new Date('2031-01-01'), file, source: 'employee_document', sourceId: 'd1',
    });
    expect(current()!.expiryDate).toEqual(new Date('2031-01-01'));
    expect(current()!.verifiedAt).toBeNull();
  });

  it('older evidence is only filed and keeps the current dates', async () => {
    const { service, current } = setup({ expiryDate: new Date('2032-01-01'), verifiedAt: new Date('2025-01-01') });
    await service.attachEvidence({
      userId: 'u1', employeeId: 'e1', complianceTypeId: 'dl', expiryDate: new Date('2027-01-01'), file, source: 'employee_document', sourceId: 'd1',
    });
    expect(current()!.expiryDate).toEqual(new Date('2032-01-01'));
    expect(current()!.verifiedAt).toEqual(new Date('2025-01-01'));
  });
});
