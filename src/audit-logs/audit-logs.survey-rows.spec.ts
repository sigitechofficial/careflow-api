import { NotFoundException } from '@nestjs/common';
import { AuditLogsService, auditRowSurveyId, hiddenSurveyAuditWhere } from './audit-logs.service';

/**
 * Survey audit entries (sends, reminders, answers counted per day, downloads) are shown only to
 * people with results access to that survey, in its branches; admins see all.
 */
describe('audit log: survey entries limited to people with results access', () => {
  const restricted = {
    responses: { restricted: true, ownerKeys: [], roleIds: [], userIds: ['someone-else'] },
    results: { restricted: true, ownerKeys: [], roleIds: [], userIds: ['someone-else'] },
  };
  const surveys = [
    { id: 'open-1', clonedFromId: null, createdById: 'maker', isAnonymous: true, allowAnonymousResponses: false, libraryReference: null, libraryMeta: null, accessPolicy: null, reportingThreshold: null, locationIds: [], isTemplate: false },
    { id: 'closed-1', clonedFromId: null, createdById: 'maker', isAnonymous: true, allowAnonymousResponses: false, libraryReference: null, libraryMeta: null, accessPolicy: restricted, reportingThreshold: null, locationIds: [], isTemplate: false },
  ];

  function setup(rowForId?: any) {
    const prisma: any = {
      survey: { findMany: jest.fn(async () => surveys), findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
      role: { findMany: jest.fn(async () => []) },
      surveyAlertOwnerRole: { findMany: jest.fn(async () => []) },
      auditLog: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(async () => rowForId) },
      $transaction: jest.fn(async (ops: any[]) => [0, []]),
    };
    return { prisma, service: new AuditLogsService(prisma) };
  }
  const coordinator = { id: 'u1', email: 'u1@x', roles: ['Care Coordinator'], permissions: ['audit_logs.read', 'surveys.read'], accountKind: 'user', assignedLocationIds: null } as any;
  const admin = { ...coordinator, roles: ['Admin'] };
  const inspector = { ...coordinator, roles: ['Temporary Inspector'], permissions: ['audit_logs.read'] };

  it('finds the survey an entry is about', () => {
    expect(auditRowSurveyId({ recordType: 'Survey', recordId: 's1', metadata: null, newValues: null })).toBe('s1');
    expect(auditRowSurveyId({ recordType: 'SurveyAlert', recordId: 'a1', metadata: null, newValues: { surveyId: 's2' } })).toBe('s2');
    expect(auditRowSurveyId({ recordType: 'SurveyResponse', recordId: 'r1', metadata: { surveyId: 's3' }, newValues: null })).toBe('s3');
    expect(auditRowSurveyId({ recordType: 'Employee', recordId: 'e1', metadata: {}, newValues: { channels: [] } })).toBeNull();
  });

  it('leaves out survey entries about hidden surveys (record, metadata or new values), keeps everything else', () => {
    expect(hiddenSurveyAuditWhere(new Set())).toBeNull();
    expect(hiddenSurveyAuditWhere('all')).toEqual({ NOT: { module: 'SURVEY' } });
    expect(hiddenSurveyAuditWhere(new Set(['s1']))).toEqual({
      NOT: {
        module: 'SURVEY',
        OR: [
          { recordType: 'Survey', recordId: { in: ['s1'] } },
          { metadata: { path: ['surveyId'], equals: 's1' } },
          { newValues: { path: ['surveyId'], equals: 's1' } },
        ],
      },
    });
  });

  it('the list: a coordinator does not see a restricted survey’s entries; an admin sees all; audit-only access sees no survey entries', async () => {
    const { prisma, service } = setup();
    await service.findAuditLogs({} as any, { reader: coordinator });
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where.AND)).toContain('closed-1');
    expect(JSON.stringify(where.AND)).not.toContain('open-1');

    await service.findAuditLogs({ search: 'survey' } as any, { reader: admin });
    expect(prisma.auditLog.findMany.mock.calls[1][0].where.AND).toHaveLength(1); // the search only

    await service.findAuditLogs({} as any, { reader: inspector });
    expect(prisma.auditLog.findMany.mock.calls[2][0].where.AND).toEqual([{ NOT: { module: 'SURVEY' } }]);
  });

  it('one entry: not found when it is about a survey the reader may not see', async () => {
    const row = { id: 'x', module: 'SURVEY', recordType: 'Survey', recordId: 'closed-1', metadata: { surveyId: 'closed-1', day: '2026-11-04' }, newValues: null };
    await expect(setup(row).service.findAuditLogById('x', { reader: coordinator })).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup(row).service.findAuditLogById('x', { reader: inspector })).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup(row).service.findAuditLogById('x', { reader: admin })).resolves.toEqual({ data: row });
    const open = { ...row, recordId: 'open-1', metadata: { surveyId: 'open-1' } };
    await expect(setup(open).service.findAuditLogById('x', { reader: coordinator })).resolves.toEqual({ data: open });
  });
});
