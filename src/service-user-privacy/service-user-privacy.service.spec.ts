import { BadRequestException } from '@nestjs/common';
import { ServiceUserPrivacyService } from './service-user-privacy.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

const SU = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';
const LINE = '33333333-3333-4333-8333-333333333333';

function setup(opts: { lines?: Array<{ startsOn: Date; endsOn: Date | null; stoppedAt: Date | null }>; canReceiveUpdates?: boolean } = {}) {
  const line = {
    id: LINE,
    serviceUserId: SU,
    contactId: CONTACT,
    stoppedAt: null as Date | null,
    startsOn: new Date('2026-11-01T00:00:00Z'),
    endsOn: null,
  };
  const tx = {
    serviceUserSharingAgreement: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...line, ...data })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: LINE, ...data })),
      findMany: jest.fn(async () => opts.lines ?? []),
    },
    serviceUserContact: {
      findUnique: jest.fn(async () => ({ canReceiveUpdates: opts.canReceiveUpdates ?? true })),
      update: jest.fn(async () => ({})),
    },
  };
  const prisma = {
    serviceUser: { findFirst: jest.fn(async () => ({ id: SU })) },
    serviceUserSharingAgreement: { findFirst: jest.fn(async () => line) },
    serviceUserContact: { findFirst: jest.fn(async () => ({ id: CONTACT, firstName: 'Ann', lastName: 'Smith' })) },
    serviceUserLegalAuthority: { findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { logAudit: jest.fn(async () => undefined) };
  const orgSettings = { getOperationalTimezone: jest.fn(async () => 'Europe/London') };
  const service = new ServiceUserPrivacyService(prisma as never, audit as never, orgSettings as never);
  return { service, prisma, tx, audit, line };
}

describe('ServiceUserPrivacyService', () => {
  it('stopping the last sharing with a contact stops their updates, keeps the line as history and audits it', async () => {
    const { service, tx, audit } = setup({
      lines: [{ startsOn: new Date('2026-11-01T00:00:00Z'), endsOn: null, stoppedAt: new Date(), categories: ['CARE_UPDATES'] }],
      canReceiveUpdates: true,
    });
    await service.stopSharing('user-1', SU, LINE, { reason: 'She asked us to stop' });
    const update = tx.serviceUserSharingAgreement.update.mock.calls[0][0] as unknown as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ stoppedById: 'user-1', stopReason: 'She asked us to stop' });
    expect(update.data.stoppedAt).toBeInstanceOf(Date);
    expect(tx.serviceUserContact.update).toHaveBeenCalledWith({ where: { id: CONTACT }, data: { canReceiveUpdates: false, updatedById: 'user-1' } });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.SERVICE_USER_SHARING_STOPPED, recordId: LINE }));
  });

  it('a contact still shared with on another line keeps getting updates', async () => {
    const { service, tx } = setup({
      lines: [
        { startsOn: new Date('2026-11-01T00:00:00Z'), endsOn: null, stoppedAt: new Date(), categories: ['CARE_UPDATES'] },
        { startsOn: new Date('2026-01-01T00:00:00Z'), endsOn: null, stoppedAt: null, categories: ['HEALTH_MEDICINES'] },
      ],
      canReceiveUpdates: true,
    });
    await service.stopSharing('user-1', SU, LINE, { reason: 'Replaced' });
    expect(tx.serviceUserContact.update).not.toHaveBeenCalled();
  });

  it('cannot stop twice, or change a stopped line', async () => {
    const { service, line } = setup();
    line.stoppedAt = new Date();
    await expect(service.stopSharing('user-1', SU, LINE, { reason: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSharing('user-1', SU, LINE, {
        recipientKind: 'PROFESSIONAL',
        recipientName: 'GP',
        categories: ['HEALTH_MEDICINES'],
        channels: ['PHONE'],
        basis: 'CONSENT',
        startsOn: '2026-11-08',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sharing with a contact takes their name, ticks their updates and keeps "everything" on its own', async () => {
    const { service, tx } = setup({
      lines: [{ startsOn: new Date('2026-11-01T00:00:00Z'), endsOn: null, stoppedAt: null, categories: ['ALL'] }],
      canReceiveUpdates: false,
    });
    await service.createSharing('user-1', SU, {
      recipientKind: 'CONTACT',
      contactId: CONTACT,
      categories: ['ALL', 'FINANCE'],
      channels: ['PHONE', 'PHONE'],
      basis: 'CONSENT',
      startsOn: '2026-11-01',
    });
    const created = tx.serviceUserSharingAgreement.create.mock.calls[0][0] as unknown as { data: Record<string, unknown> };
    expect(created.data).toMatchObject({ recipientName: 'Ann Smith', contactId: CONTACT, categories: ['ALL'], channels: ['PHONE'] });
    expect(tx.serviceUserContact.update).toHaveBeenCalledWith({ where: { id: CONTACT }, data: { canReceiveUpdates: true, updatedById: 'user-1' } });
  });

  it('"Surveys" is kept alongside "everything", and a surveys-only line does not turn on care updates', async () => {
    const withAll = setup({ lines: [{ startsOn: new Date('2026-11-01T00:00:00Z'), endsOn: null, stoppedAt: null, categories: ['ALL', 'SURVEYS'] }], canReceiveUpdates: false });
    await withAll.service.createSharing('user-1', SU, {
      recipientKind: 'CONTACT',
      contactId: CONTACT,
      categories: ['ALL', 'FINANCE', 'SURVEYS'],
      channels: ['EMAIL'],
      basis: 'CONSENT',
      startsOn: '2026-11-01',
    });
    const created = withAll.tx.serviceUserSharingAgreement.create.mock.calls[0][0] as unknown as { data: Record<string, unknown> };
    expect(created.data).toMatchObject({ categories: ['ALL', 'SURVEYS'] });

    const surveysOnly = setup({ lines: [{ startsOn: new Date('2026-11-01T00:00:00Z'), endsOn: null, stoppedAt: null, categories: ['SURVEYS'] }], canReceiveUpdates: false });
    await surveysOnly.service.createSharing('user-1', SU, {
      recipientKind: 'CONTACT',
      contactId: CONTACT,
      categories: ['SURVEYS'],
      channels: ['EMAIL'],
      basis: 'CONSENT',
      startsOn: '2026-11-01',
    });
    expect(surveysOnly.tx.serviceUserContact.update).not.toHaveBeenCalled();
  });

  it('refuses an end date before the start, and sharing with nothing chosen', async () => {
    const { service } = setup();
    const base = { recipientKind: 'PROFESSIONAL' as const, recipientName: 'GP', channels: ['PHONE'], basis: 'CONSENT' as const };
    await expect(
      service.createSharing('user-1', SU, { ...base, categories: ['CARE_UPDATES'], startsOn: '2026-11-08', endsOn: '2026-11-01' }),
    ).rejects.toThrow('The end date is before the start date.');
    await expect(service.createSharing('user-1', SU, { ...base, categories: [], startsOn: '2026-11-08' })).rejects.toThrow(
      'Choose what may be shared.',
    );
  });
});
