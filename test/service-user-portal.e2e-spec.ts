/**
 * Requires PostgreSQL from DATABASE_URL, migrated schema, and seed (admin@careadmin.local / Admin@12345).
 * Run: pnpm test:e2e --testPathPatterns=service-user-portal
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const shouldRun = Boolean(process.env.DATABASE_URL);
const describePortal = shouldRun ? describe : describe.skip;

describePortal('Service user portal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let staffToken: string;
  let serviceUserId: string;
  let portalEmail: string;
  let portalPassword: string;
  let portalToken: string;

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

    const portalPerms = ['service_users.portal.read', 'service_users.portal.manage', 'service_users.read'];
    for (const key of portalPerms) {
      await prisma.permission.upsert({
        where: { key },
        update: { isActive: true, deletedAt: null },
        create: { key, isActive: true },
      });
    }
    const superAdminRole = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
    if (superAdminRole) {
      const perms = await prisma.permission.findMany({ where: { key: { in: portalPerms } } });
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
    staffToken = login.body.data?.accessToken;
    expect(staffToken).toBeTruthy();

    const su = await prisma.serviceUser.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(su).toBeTruthy();
    serviceUserId = su!.id;
    portalEmail = `portal-test+${Date.now()}@example.com`;
    portalPassword = 'PortalTest1!';

    await request(app.getHttpServer())
      .put(`/service-users/${serviceUserId}/portal-account`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ email: portalEmail, isEnabled: true })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/service-users/${serviceUserId}/portal-account/set-password`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ password: portalPassword })
      .expect(200);

    const portalLogin = await request(app.getHttpServer())
      .post('/auth/service-user/login')
      .send({ email: portalEmail, password: portalPassword });
    expect([200, 201]).toContain(portalLogin.status);
    portalToken = portalLogin.body.data?.accessToken;
    expect(portalToken).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('portal token loads dashboard and profile', async () => {
    const dashboard = await request(app.getHttpServer())
      .get('/portal/dashboard')
      .set('Authorization', `Bearer ${portalToken}`)
      .expect(200);
    expect(dashboard.body.data.profile.serviceUserId).toBe(serviceUserId);

    await request(app.getHttpServer())
      .get('/portal/profile')
      .set('Authorization', `Bearer ${portalToken}`)
      .expect(200);
  });

  it('portal token cannot access staff service-users list', async () => {
    await request(app.getHttpServer())
      .get('/service-users')
      .set('Authorization', `Bearer ${portalToken}`)
      .expect(403);
  });

  it('staff token cannot access portal dashboard', async () => {
    await request(app.getHttpServer())
      .get('/portal/dashboard')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
  });

  it('portal can patch about-me', async () => {
    const patch = await request(app.getHttpServer())
      .patch('/portal/about-me')
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ aboutMe: { whatIsMostImportantToMe: 'Family and independence' } })
      .expect(200);
    expect(patch.body.data.aboutMe.whatIsMostImportantToMe).toBe('Family and independence');
  });

  it('portal token loads visit plans', async () => {
    const res = await request(app.getHttpServer())
      .get('/portal/visit-plans')
      .set('Authorization', `Bearer ${portalToken}`)
      .expect(200);
    expect(res.body.data).toHaveProperty('plans');
    expect(Array.isArray(res.body.data.plans)).toBe(true);
  });

  it('portal can add a contact', async () => {
    const res = await request(app.getHttpServer())
      .post('/portal/contacts')
      .set('Authorization', `Bearer ${portalToken}`)
      .send({
        firstName: 'Portal',
        lastName: 'Friend',
        phone: '01234567890',
        isEmergencyContact: true,
      })
      .expect(201);
    expect(res.body.data.firstName).toBe('Portal');
    expect(res.body.data.lastName).toBe('Friend');
  });

  it('portal token loads completed visits', async () => {
    const res = await request(app.getHttpServer())
      .get('/portal/completed-visits')
      .set('Authorization', `Bearer ${portalToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
