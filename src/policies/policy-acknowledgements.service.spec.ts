import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PolicyAcknowledgementStatus } from '@prisma/client';
import { daysAgo, seed, webUser } from './policy-acknowledgements.fake';

describe('PolicyAcknowledgementsService', () => {
  it('lists the policies the signed-in user must acknowledge, matched by employee email', async () => {
    const { service } = seed();
    const res = await service.listForUser(webUser('ANNA@care.test'));
    expect(res.data.employeeLinked).toBe(true);
    expect(res.data.items.map((i) => i.reference).sort()).toEqual(['POL-1', 'POL-2']);
    const pol1 = res.data.items.find((i) => i.reference === 'POL-1')!;
    expect(pol1.versionLabel).toBe('v1.1');
    // Clock started with v1.0 (30 days ago): a minor version does not restart it.
    expect(pol1.overdue).toBe(true);
    expect(pol1.status).toBe(PolicyAcknowledgementStatus.PENDING);
    expect(res.data.counts).toEqual({ total: 2, acknowledged: 0, outstanding: 2, viewed: 0, overdue: 1 });
  });

  it('uses linked user roles: a manager is not in a carers-only audience', async () => {
    const { service } = seed();
    const res = await service.listForUser(webUser('cara@care.test'));
    expect(res.data.items.map((i) => i.reference)).toEqual(['POL-2']);
  });

  it('returns an empty list with a reason when the user has no employee record', async () => {
    const { service } = seed();
    const res = await service.listForUser(webUser('nobody@care.test'));
    expect(res.data.employeeLinked).toBe(false);
    expect(res.data.reason).toMatch(/not linked to an employee record/);
    expect(res.data.items).toEqual([]);
  });

  it('ignores inactive employees', async () => {
    const { service } = seed();
    const res = await service.listForUser(webUser('gone@care.test'));
    expect(res.data.employeeLinked).toBe(false);
  });

  it('counts an acknowledgement of an earlier minor version', async () => {
    const { service, store } = seed();
    store.acks.push({
      id: 'old',
      versionId: 'v1-0',
      employeeId: 'emp-anna',
      status: PolicyAcknowledgementStatus.ACKNOWLEDGED,
      viewedAt: daysAgo(29),
      acknowledgedAt: daysAgo(29),
    });
    const res = await service.listForEmployee('emp-anna');
    const pol1 = res.data.items.find((i) => i.reference === 'POL-1')!;
    expect(pol1.status).toBe(PolicyAcknowledgementStatus.ACKNOWLEDGED);
    expect(pol1.overdue).toBe(false);
  });

  it('records VIEWED once on open, then acknowledges with an audit entry', async () => {
    const { service, store, audit } = seed();
    const user = webUser('anna@care.test');

    const viewed = await service.recordViewedForUser(user, 'doc-2');
    expect(viewed.data.status).toBe(PolicyAcknowledgementStatus.VIEWED);
    expect(store.acks).toHaveLength(1);
    expect(store.acks[0]).toMatchObject({ employeeId: 'emp-anna', userId: user.id, channel: 'WEB' });
    const firstViewedAt = store.acks[0].viewedAt;

    await service.recordViewedForUser(user, 'doc-2');
    expect(store.acks[0].viewedAt).toBe(firstViewedAt);

    const res = await service.acknowledgeForUser(user, 'doc-2', { ipAddress: '1.1.1.1', userAgent: 'jest' });
    expect(res.data.status).toBe(PolicyAcknowledgementStatus.ACKNOWLEDGED);
    expect(store.acks[0]).toMatchObject({ status: PolicyAcknowledgementStatus.ACKNOWLEDGED, channel: 'WEB' });
    expect(store.acks[0].acknowledgedAt).toBeInstanceOf(Date);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'policy_acknowledged',
        userId: user.id,
        recordType: 'PolicyAcknowledgement',
        metadata: expect.objectContaining({ employeeId: 'emp-anna', documentId: 'doc-2', channel: 'WEB' }),
      }),
    );

    // Opening again after acknowledging does not go back to VIEWED.
    const again = await service.recordViewedForUser(user, 'doc-2');
    expect(again.data.status).toBe(PolicyAcknowledgementStatus.ACKNOWLEDGED);
    expect(store.acks[0].status).toBe(PolicyAcknowledgementStatus.ACKNOWLEDGED);
  });

  it('rejects acknowledging a policy that is not required for the employee', async () => {
    const { service, store, audit } = seed();
    const cara = webUser('cara@care.test');
    // Not required at all.
    await expect(service.acknowledgeForUser(cara, 'doc-3')).rejects.toBeInstanceOf(BadRequestException);
    // Required, but not for this audience (carers only).
    await expect(service.acknowledgeForUser(cara, 'doc-1')).rejects.toBeInstanceOf(BadRequestException);
    // Catalogue documents are never staff policies.
    await expect(service.acknowledgeForEmployee('emp-anna', 'doc-cat')).rejects.toBeInstanceOf(NotFoundException);
    // No employee record.
    await expect(service.acknowledgeForUser(webUser('nobody@care.test'), 'doc-2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.acks).toHaveLength(0);
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('Employee App: sanitises policy HTML saved before save-time sanitising', async () => {
    const { service, store } = seed();
    const version = store.versions.find((v: { id: string }) => v.id === 'v1-1')!;
    version.contentHtml =
      '<h2 onclick="steal()">Key points</h2><script>alert(1)</script><p><a href="javascript:alert(1)">Read</a></p>';
    const detail = await service.getForEmployee('emp-anna', 'doc-1');
    expect(detail.data.contentHtml).toBe('<h2>Key points</h2><p><a>Read</a></p>');
  });

  it('Employee App: returns content, records VIEWED and acknowledges without a user id', async () => {
    const { service, store, audit } = seed();
    const detail = await service.getForEmployee('emp-anna', 'doc-1', 'portal-1');
    expect(detail.data.contentHtml).toContain('Key points for staff');
    expect(detail.data.contentKind).toBe('EDITOR');
    expect(detail.data.acknowledgement.status).toBe(PolicyAcknowledgementStatus.VIEWED);
    expect(store.acks[0]).toMatchObject({ versionId: 'v1-1', userId: null, channel: 'EMPLOYEE_APP' });

    await service.acknowledgeForEmployee('emp-anna', 'doc-1', undefined, 'portal-1');
    expect(store.acks[0].status).toBe(PolicyAcknowledgementStatus.ACKNOWLEDGED);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: undefined,
        metadata: expect.objectContaining({ channel: 'EMPLOYEE_APP', employeePortalAccountId: 'portal-1' }),
      }),
    );
  });

  it('Employee App: a policy outside my audience is not found', async () => {
    const { service } = seed();
    await expect(service.getForEmployee('emp-cara', 'doc-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('manager report respects branch scope', async () => {
    const { service, store } = seed();
    store.acks.push({
      id: 'a1',
      versionId: 'v2-0',
      employeeId: 'emp-anna',
      status: PolicyAcknowledgementStatus.ACKNOWLEDGED,
      viewedAt: daysAgo(1),
      acknowledgedAt: daysAgo(1),
    });

    const all = await service.documentReport(webUser('boss@care.test', { assignedLocationIds: null }), 'doc-2');
    expect(all.data.rows.map((r) => r.name)).toEqual(['Anna Carer', 'Ben Carer', 'Cara Manager']);
    expect(all.data.totals).toEqual({ required: 3, acknowledged: 1, viewedOnly: 0, notOpened: 2, overdue: 0 });
    expect(all.data.rows[0]).toMatchObject({ branch: 'Branch A', jobTitle: 'Care Assistant', status: 'ACKNOWLEDGED' });

    const branchB = await service.documentReport(webUser('boss@care.test', { assignedLocationIds: ['loc-b'] }), 'doc-2');
    expect(branchB.data.rows.map((r) => r.name)).toEqual(['Ben Carer']);
    expect(branchB.data.totals.required).toBe(1);
    expect(branchB.data.branchScoped).toBe(true);

    const none = await service.documentReport(webUser('boss@care.test', { assignedLocationIds: [] }), 'doc-2');
    expect(none.data.rows).toEqual([]);
  });

  it('manager report: overdue staff and a policy that does not need acknowledging', async () => {
    const { service } = seed();
    const report = await service.documentReport(webUser('boss@care.test'), 'doc-1');
    expect(report.data.rows.map((r) => [r.name, r.overdue])).toEqual([
      ['Anna Carer', true],
      ['Ben Carer', true],
    ]);
    expect(report.data.totals.overdue).toBe(2);

    const notRequired = await service.documentReport(webUser('boss@care.test'), 'doc-3');
    expect(notRequired.data.acknowledgementRequired).toBe(false);
    expect(notRequired.data.rows).toEqual([]);
  });

  it('summary gives required / acknowledged / overdue per policy within branch scope', async () => {
    const { service } = seed();
    const res = await service.summary(webUser('boss@care.test', { assignedLocationIds: ['loc-a'] }));
    const byRef = Object.fromEntries(res.data.map((row) => [row.reference, row]));
    expect(Object.keys(byRef).sort()).toEqual(['POL-1', 'POL-2']);
    expect(byRef['POL-1']).toMatchObject({ required: 1, acknowledged: 0, overdue: 1 });
    expect(byRef['POL-2']).toMatchObject({ required: 2, acknowledged: 0, overdue: 0 });
  });
});
