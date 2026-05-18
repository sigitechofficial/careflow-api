/**
 * Requires PostgreSQL, migrated schema, seed (admin@careadmin.local / Admin@12345).
 * Run: pnpm test:e2e --testPathPatterns=service-user-calendar
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const shouldRun = Boolean(process.env.DATABASE_URL);
const describeCal = shouldRun ? describe : describe.skip;

describeCal('Service user calendar (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let serviceUserId: string;
  let eventTypeId: string;
  let eventId: string;

  const calendarPerms = [
    'service_users.read',
    'service_users.calendar.read',
    'service_users.calendar.create',
    'service_users.calendar.update',
    'service_users.calendar.delete',
    'service_users.calendar.status.update',
    'service_users.calendar_event_types.read',
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    for (const key of calendarPerms) {
      await prisma.permission.upsert({
        where: { key },
        update: { isActive: true, deletedAt: null },
        create: { key, isActive: true },
      });
    }
    const superAdminRole = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
    if (superAdminRole) {
      const perms = await prisma.permission.findMany({ where: { key: { in: calendarPerms } } });
      for (const p of perms) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: p.id } },
          update: {},
          create: { roleId: superAdminRole.id, permissionId: p.id },
        });
      }
    }

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@careadmin.local', password: 'Admin@12345' });
    accessToken = login.body.data?.accessToken;

    const su = await prisma.serviceUser.findFirst({ where: { deletedAt: null } });
    serviceUserId = su!.id;
    const et = await prisma.calendarEventType.findFirst({ where: { code: 'APPOINTMENT' } });
    eventTypeId = et!.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects create without title', async () => {
    const res = await request(app.getHttpServer())
      .post(`/service-users/${serviceUserId}/calendar/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ startDateTime: '2026-06-01T10:00:00.000Z' });
    expect(res.status).toBe(400);
  });

  it('creates calendar event', async () => {
    const res = await request(app.getHttpServer())
      .post(`/service-users/${serviceUserId}/calendar/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'E2E GP visit',
        eventTypeId,
        startDateTime: '2026-06-10T10:00:00.000Z',
        endDateTime: '2026-06-10T11:00:00.000Z',
      });
    expect([200, 201]).toContain(res.status);
    eventId = res.body.data?.id;
    expect(eventId).toBeTruthy();
  });

  it('rejects endDateTime before startDateTime', async () => {
    const res = await request(app.getHttpServer())
      .post(`/service-users/${serviceUserId}/calendar/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Bad range',
        startDateTime: '2026-06-11T12:00:00.000Z',
        endDateTime: '2026-06-11T10:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });

  it('lists service user calendar events', async () => {
    const res = await request(app.getHttpServer())
      .get(`/service-users/${serviceUserId}/calendar/events`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns month calendar view', async () => {
    const res = await request(app.getHttpServer())
      .get(`/service-users/${serviceUserId}/calendar?view=MONTH&date=2026-06-01`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data?.view).toBe('MONTH');
    expect(res.body.data?.groupedByDate).toBeDefined();
  });

  it('returns week calendar view', async () => {
    const res = await request(app.getHttpServer())
      .get(`/service-users/${serviceUserId}/calendar?view=WEEK&date=2026-06-10`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data?.view).toBe('WEEK');
  });

  it('returns day calendar view', async () => {
    const res = await request(app.getHttpServer())
      .get(`/service-users/${serviceUserId}/calendar?view=DAY&date=2026-06-10`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data?.view).toBe('DAY');
  });

  it('updates calendar event status', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/service-users/${serviceUserId}/calendar/events/${eventId}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'COMPLETED' });
    expect(res.status).toBe(200);
    expect(res.body.data?.status).toBe('COMPLETED');
  });

  it('returns global calendar events', async () => {
    const res = await request(app.getHttpServer())
      .get('/service-users/calendar/events?dateFrom=2026-06-01&dateTo=2026-06-30')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('soft deletes calendar event', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/service-users/${serviceUserId}/calendar/events/${eventId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 without token', async () => {
    const res = await request(app.getHttpServer()).get(
      `/service-users/${serviceUserId}/calendar/events`,
    );
    expect(res.status).toBe(401);
  });
});
