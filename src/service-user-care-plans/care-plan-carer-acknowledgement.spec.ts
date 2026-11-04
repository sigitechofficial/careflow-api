import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CARE_PLAN_UPDATED_PUSH_TYPE,
  CarePlanCarerNotificationService,
  carePlanPushReference,
} from './care-plan-carer-notification.service';
import { EmployeeAppClientDetailService } from '../employee-app/employee-app-client-detail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FcmPushService } from '../notifications/fcm-push.service';
import { MANAGER, PLAN, SU, FORM, setup } from './care-plan.test-harness';

type Ack = {
  id: string;
  publishedVersionId: string;
  carePlanInstanceId: string;
  serviceUserId: string;
  employeeId: string;
  notifiedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
};

const NOW = new Date('2026-11-03T09:00:00Z');

/** In-memory instance + visits + acknowledgement rows. */
function world(
  opts: {
    status?: string;
    lifecycleStatus?: string;
    carers?: string[];
    pushFails?: boolean;
  } = {},
) {
  const state = {
    instance: {
      id: 'inst-1',
      serviceUserId: SU,
      status: opts.status ?? 'PUBLISHED',
      lifecycleStatus: opts.lifecycleStatus ?? 'ACTIVE',
      carePathwayForm: { name: 'Mobility' },
      serviceUser: {
        firstName: 'Margaret',
        lastName: 'Jones',
        serviceUserNumber: 'SU-0042',
      },
      versions: [
        { id: 'ver-1', versionNumber: 1, supersededAt: null as Date | null },
      ],
    },
    carers: opts.carers ?? ['emp-a', 'emp-b'],
    acks: [] as Ack[],
    audits: [] as Array<Record<string, unknown>>,
  };
  const current = () =>
    state.instance.versions
      .filter((v) => !v.supersededAt)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .slice(0, 1);
  const matches = (a: Ack, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v)
        return (v as { in: unknown[] }).in.includes(
          (a as Record<string, unknown>)[k],
        );
      return (a as Record<string, unknown>)[k] === v;
    });
  const prisma = {
    serviceUserCarePlanInstance: {
      findUnique: jest.fn(() =>
        Promise.resolve({ ...state.instance, publishedVersions: current() }),
      ),
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { id: string; serviceUserId: string; lifecycleStatus: string };
        }) =>
          Promise.resolve(
            where.id === state.instance.id &&
              where.serviceUserId === state.instance.serviceUserId &&
              where.lifecycleStatus === state.instance.lifecycleStatus
              ? { id: state.instance.id, publishedVersions: current() }
              : null,
          ),
      ),
    },
    jobAllocation: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: {
            scheduledJob: {
              serviceUserId: string;
              scheduledStartDateTime: { gte: Date; lte: Date };
            };
          };
        }) => {
          expect(where.scheduledJob.serviceUserId).toBe(SU);
          expect(where.scheduledJob.scheduledStartDateTime.gte).toEqual(NOW);
          return Promise.resolve(
            state.carers.map((employeeId) => ({ employeeId })),
          );
        },
      ),
    },
    carePlanVersionAcknowledgement: {
      create: jest.fn(
        ({
          data,
        }: {
          data: Omit<
            Ack,
            'id' | 'notifiedAt' | 'acknowledgedAt' | 'acknowledgedById'
          >;
        }) => {
          if (
            state.acks.some(
              (a) =>
                a.publishedVersionId === data.publishedVersionId &&
                a.employeeId === data.employeeId,
            )
          ) {
            return Promise.reject(
              new Prisma.PrismaClientKnownRequestError('dup', {
                code: 'P2002',
                clientVersion: 'x',
              }),
            );
          }
          const row = {
            id: `ack-${state.acks.length + 1}`,
            notifiedAt: null,
            acknowledgedAt: null,
            acknowledgedById: null,
            ...data,
          };
          state.acks.push(row);
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<Ack>;
        }) => {
          const hit = state.acks.filter((a) => matches(a, where));
          hit.forEach((a) => Object.assign(a, data));
          return Promise.resolve({ count: hit.length });
        },
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: {
            publishedVersionId_employeeId: {
              publishedVersionId: string;
              employeeId: string;
            };
          };
          create: Omit<
            Ack,
            'id' | 'notifiedAt' | 'acknowledgedAt' | 'acknowledgedById'
          >;
        }) => {
          const k = where.publishedVersionId_employeeId;
          let row = state.acks.find(
            (a) =>
              a.publishedVersionId === k.publishedVersionId &&
              a.employeeId === k.employeeId,
          );
          if (!row) {
            row = {
              id: `ack-${state.acks.length + 1}`,
              notifiedAt: null,
              acknowledgedAt: null,
              acknowledgedById: null,
              ...create,
            };
            state.acks.push(row);
          }
          return Promise.resolve({ ...row });
        },
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(state.acks.find((a) => a.id === where.id) ?? null),
      ),
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { employeeId: string; publishedVersionId: { in: string[] } };
        }) =>
          Promise.resolve(
            state.acks.filter(
              (a) =>
                a.employeeId === where.employeeId &&
                where.publishedVersionId.in.includes(a.publishedVersionId),
            ),
          ),
      ),
    },
  };
  const fcm = {
    sendToEmployees: jest.fn(() =>
      opts.pushFails
        ? Promise.reject(new Error('FCM down'))
        : Promise.resolve({
            ready: true,
            tokens: 2,
            sent: 2,
            skipped: 0,
            reason: 'SENT' as const,
          }),
    ),
  };
  const notifier = new CarePlanCarerNotificationService(
    prisma as unknown as PrismaService,
    fcm as unknown as FcmPushService,
  );
  const onRound = new Set(['emp-a', 'emp-b']);
  const carer = Object.assign(
    Object.create(EmployeeAppClientDetailService.prototype) as object,
    {
      prisma,
      clientsService: {
        assertClientOnRound: jest.fn((employeeId: string) =>
          onRound.has(employeeId)
            ? Promise.resolve()
            : Promise.reject(
                new ForbiddenException('Client is not on your round'),
              ),
        ),
      },
      audit: {
        logAudit: jest.fn(
          (e: Record<string, unknown>) => (
            state.audits.push(e),
            Promise.resolve()
          ),
        ),
      },
    },
  ) as EmployeeAppClientDetailService;
  const publishV2 = () => {
    state.instance.versions[0].supersededAt = new Date();
    state.instance.versions.push({
      id: 'ver-2',
      versionNumber: 2,
      supersededAt: null,
    });
  };
  return { state, prisma, fcm, notifier, carer, publishV2 };
}

describe('Phase 4B — carer notifications & care plan acknowledgement', () => {
  it('1. a new publication notifies carers on upcoming visits, with no clinical content in the push', async () => {
    const w = world();
    const res = await w.notifier.notifyCurrentVersion('inst-1', NOW);
    expect(res).toEqual({ notified: ['emp-a', 'emp-b'], alreadyNotified: [] });
    expect(w.fcm.sendToEmployees).toHaveBeenCalledTimes(1);
    const [ids, payload] = w.fcm.sendToEmployees.mock.calls[0] as unknown as [
      string[],
      { title: string; body: string; data: Record<string, string> },
    ];
    expect(ids).toEqual(['emp-a', 'emp-b']);
    expect(payload.title).toBe('Care plan updated');
    expect(payload.body).toBe(
      'Mobility (version 1) for MJ (SU-0042). Open the app to read and acknowledge it.',
    );
    expect(payload.data).toEqual({
      type: CARE_PLAN_UPDATED_PUSH_TYPE,
      serviceUserId: SU,
      carePlanInstanceId: 'inst-1',
      publishedVersionId: 'ver-1',
      versionNumber: '1',
    });
    expect(payload.body).not.toMatch(/Margaret|Jones/);
    // Delivery is recorded, acknowledgement is not.
    expect(
      w.state.acks.map((a) => [
        a.employeeId,
        a.notifiedAt?.toISOString(),
        a.acknowledgedAt,
      ]),
    ).toEqual([
      ['emp-a', NOW.toISOString(), null],
      ['emp-b', NOW.toISOString(), null],
    ]);
  });

  it('push reference never includes the full name', () => {
    expect(
      carePlanPushReference({
        firstName: 'Ann',
        lastName: 'Lee',
        serviceUserNumber: null,
      }),
    ).toBe('AL');
    expect(
      carePlanPushReference({
        firstName: null,
        lastName: null,
        serviceUserNumber: null,
      }),
    ).toBe('Service user');
  });

  it('3. drafts, unpublished, suspended and archived plans never notify', async () => {
    for (const opts of [
      { status: 'DRAFT' },
      { lifecycleStatus: 'SUSPENDED' },
      { lifecycleStatus: 'ARCHIVED' },
    ]) {
      const w = world(opts);
      await expect(
        w.notifier.notifyCurrentVersion('inst-1', NOW),
      ).resolves.toMatchObject({ skipped: 'NOT_ACTIVE_PUBLISHED' });
      expect(w.fcm.sendToEmployees).not.toHaveBeenCalled();
      expect(w.state.acks).toEqual([]);
    }
    const noVisits = world({ carers: [] });
    await expect(
      noVisits.notifier.notifyCurrentVersion('inst-1', NOW),
    ).resolves.toMatchObject({ skipped: 'NO_CARERS' });
  });

  it('3b. saving a draft or submitting / approving it never notifies; only a successful publish does', async () => {
    const t = setup({ approvalRequired: true });
    const notify = jest.fn(() =>
      Promise.resolve({ notified: [], alreadyNotified: [] }),
    );
    (
      t.service as unknown as { carerNotifications: unknown }
    ).carerNotifications = { notifyCurrentVersion: notify };
    await t.save(PLAN);
    await t.submit();
    await expect(t.publish()).rejects.toThrow('must be approved');
    await t.approve();
    expect(notify).not.toHaveBeenCalled();
    await t.publish();
    expect(notify).toHaveBeenCalledWith('inst-1');
  });

  it('5. duplicate events do not duplicate notifications', async () => {
    const w = world();
    await w.notifier.notifyCurrentVersion('inst-1', NOW);
    const again = await w.notifier.notifyCurrentVersion('inst-1', NOW);
    expect(again).toEqual({
      notified: [],
      alreadyNotified: ['emp-a', 'emp-b'],
    });
    expect(w.fcm.sendToEmployees).toHaveBeenCalledTimes(1);
    expect(w.state.acks).toHaveLength(2);

    // A carer newly allocated later is notified on the next event; the others are not.
    w.state.carers = ['emp-a', 'emp-b', 'emp-c'];
    const later = await w.notifier.notifyCurrentVersion('inst-1', NOW);
    expect(later.notified).toEqual(['emp-c']);
  });

  it('2. a new version needs a new acknowledgement and is notified again', async () => {
    const w = world();
    await w.notifier.notifyCurrentVersion('inst-1', NOW);
    await w.carer.acknowledgeCarePlan('emp-a', 'user-a', SU, 'inst-1', 'ver-1');
    w.publishV2();
    const res = await w.notifier.notifyCurrentVersion('inst-1', NOW);
    expect(res.notified).toEqual(['emp-a', 'emp-b']);
    const v2 = w.state.acks.filter((a) => a.publishedVersionId === 'ver-2');
    expect(v2.every((a) => a.acknowledgedAt === null)).toBe(true);
    await expect(
      w.carer.acknowledgeCarePlan('emp-a', 'user-a', SU, 'inst-1', 'ver-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('6. acknowledging is explicit, tied to the version, audited once, and idempotent', async () => {
    const w = world();
    await w.notifier.notifyCurrentVersion('inst-1', NOW);
    const first = await w.carer.acknowledgeCarePlan(
      'emp-a',
      'user-a',
      SU,
      'inst-1',
      'ver-1',
    );
    const second = await w.carer.acknowledgeCarePlan(
      'emp-a',
      'user-a',
      SU,
      'inst-1',
      'ver-1',
    );
    expect(second.data.acknowledgedAt).toBe(first.data.acknowledgedAt);
    expect(w.state.acks.filter((a) => a.employeeId === 'emp-a')).toEqual([
      expect.objectContaining({
        publishedVersionId: 'ver-1',
        acknowledgedById: 'user-a',
        acknowledgedAt: expect.any(Date) as Date,
      }),
    ]);
    expect(w.state.audits).toHaveLength(1);
    expect(w.state.audits[0]).toMatchObject({
      action: 'care_plan_acknowledged',
      userId: 'user-a',
      newValues: {
        employeeId: 'emp-a',
        publishedVersionId: 'ver-1',
        versionNumber: 1,
      },
    });
    // The other carer still has to acknowledge.
    expect(
      w.state.acks.find((a) => a.employeeId === 'emp-b')!.acknowledgedAt,
    ).toBeNull();
  });

  it('6b. a carer assigned after publication (never notified) can still acknowledge the current version', async () => {
    const w = world();
    await w.carer.acknowledgeCarePlan('emp-b', 'user-b', SU, 'inst-1', 'ver-1');
    expect(w.state.acks).toEqual([
      expect.objectContaining({
        employeeId: 'emp-b',
        notifiedAt: null,
        acknowledgedAt: expect.any(Date) as Date,
      }),
    ]);
  });

  it('4. a carer not on the service user’s round cannot acknowledge, nor see suspended plans', async () => {
    const w = world();
    await expect(
      w.carer.acknowledgeCarePlan('emp-x', 'user-x', SU, 'inst-1', 'ver-1'),
    ).rejects.toThrow(ForbiddenException);
    expect(w.state.acks).toEqual([]);

    const suspended = world({ lifecycleStatus: 'SUSPENDED' });
    await expect(
      suspended.carer.acknowledgeCarePlan(
        'emp-a',
        'user-a',
        SU,
        'inst-1',
        'ver-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('7. publishing succeeds even when notifying carers fails', async () => {
    const t = setup();
    const w = world({ pushFails: true });
    (
      t.service as unknown as { carerNotifications: unknown }
    ).carerNotifications = w.notifier;
    await t.save(PLAN);
    const res = await t.publish(MANAGER);
    expect(res.data?.latestPublishedVersion?.versionNumber).toBe(1);
    expect(t.db.versions).toHaveLength(1);

    // And the failure is reported rather than thrown.
    await expect(
      w.notifier.notifyCurrentVersion('inst-1', NOW),
    ).resolves.toMatchObject({
      error: expect.stringContaining('FCM down') as string,
    });
  });

  it('resuming a suspended plan notifies carers who have not been told about the current version', async () => {
    const t = setup({
      published: true,
      nextReviewDueAt: new Date('2027-06-01'),
    });
    const notify = jest.fn(() =>
      Promise.resolve({ notified: [], alreadyNotified: [] }),
    );
    (
      t.service as unknown as { carerNotifications: unknown }
    ).carerNotifications = { notifyCurrentVersion: notify };
    await t.service.suspend(MANAGER, SU, FORM, { reason: 'In hospital' });
    expect(notify).not.toHaveBeenCalled();
    await t.service.resume(MANAGER, SU, FORM, {
      reason: 'Home again',
      reviewConfirmed: true,
    });
    expect(notify).toHaveBeenCalledWith('inst-1');
  });
});
