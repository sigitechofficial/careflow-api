/**
 * Requires PostgreSQL from DATABASE_URL, migrated schema, and seed (admin@careadmin.local / Admin@12345).
 * Run: pnpm test:e2e --testPathPatterns=service-users
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const shouldRun = Boolean(process.env.DATABASE_URL);
const describeSu = shouldRun ? describe : describe.skip;

describeSu('Service users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;

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

    const keys = [
      'service_users.read',
      'service_users.create',
      'service_users.update',
      'service_users.delete',
      'service_users.status.update',
      'service_users.contacts.read',
      'service_users.contacts.create',
      'service_users.contacts.update',
      'service_users.contacts.delete',
      'service_users.address.read',
      'service_users.address.update',
      'service_users.assignments.read',
      'service_users.assignments.update',
      'service_users.photos.upload',
      'service_users.photos.delete',
      'service_users.lookups.read',
      'service_users.inventory.read',
      'service_users.inventory.create',
      'service_users.inventory.update',
      'service_users.inventory.delete',
      'service_users.allergies.read',
      'service_users.allergies.create',
      'service_users.allergies.update',
      'service_users.allergies.delete',
      'service_users.documents.read',
      'service_users.documents.update',
      'service_users.documents.delete',
      'service_users.absences.read',
      'service_users.absences.create',
      'service_users.absences.update',
      'service_users.absences.delete',
      'service_users.dom_care.read',
      'service_users.dom_care.update',
      'service_users.initial_assessment.read',
      'service_users.initial_assessment.update',
    ];
    for (const key of keys) {
      await prisma.permission.upsert({
        where: { key },
        update: { isActive: true, deletedAt: null },
        create: { key, isActive: true },
      });
    }
    const superAdminRole = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
    if (superAdminRole) {
      const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
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
    if (![200, 201].includes(login.status)) {
      // eslint-disable-next-line no-console
      console.warn('[service-users e2e] Login failed; tests may fail:', login.status, login.body);
    }
    accessToken = login.body.data?.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /service-users without token returns 401', async () => {
    await request(app.getHttpServer()).get('/service-users').expect(401);
  });

  it('POST /service-users rejects missing firstName', async () => {
    await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ lastName: 'X' })
      .expect(400);
  });

  it('POST /service-users rejects invalid email', async () => {
    await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'A', lastName: 'B', email: 'not-an-email' })
      .expect(400);
  });

  it('creates, lists, gets detail, updates status, soft-deletes service user', async () => {
    const create = await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'E2E', lastName: 'TestUser', email: `e2e.su.${Date.now()}@example.com` })
      .expect(201);
    const id = create.body.data?.id as string;
    expect(id).toBeTruthy();

    const list = await request(app.getHttpServer())
      .get('/service-users?search=E2E&limit=5')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    const detail = await request(app.getHttpServer())
      .get(`/service-users/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(detail.body.data?.firstName).toBe('E2E');

    const dal = await prisma.dataAccessLog.findFirst({
      where: { recordId: id, module: 'SERVICE_USER' },
      orderBy: { createdAt: 'desc' },
    });
    expect(dal).toBeTruthy();

    const statusRow = await prisma.serviceUserStatus.upsert({
      where: { code: 'INACTIVE' },
      update: { isActive: true },
      create: { name: 'Inactive', code: 'INACTIVE', description: 'E2E' },
    });
    expect(statusRow).toBeTruthy();
    await request(app.getHttpServer())
      .patch(`/service-users/${id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ statusId: statusRow!.id, reason: 'e2e' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/service-users/${id}/address`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ postcode: 'AB1 2CD', keySafeNumber: 'SECRET123' })
      .expect(200);

    const auditAddr = await prisma.auditLog.findFirst({
      where: { recordType: 'ServiceUserAddress', action: 'service_user_address_updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditAddr?.newValues).toBeDefined();
    const nv = auditAddr!.newValues as Record<string, unknown>;
    expect(JSON.stringify(nv)).not.toContain('SECRET123');

    await request(app.getHttpServer())
      .delete(`/service-users/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('enforces single primary contact', async () => {
    const create = await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Primary', lastName: 'Test', email: `e2e.pc.${Date.now()}@example.com` })
      .expect(201);
    const id = create.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/service-users/${id}/contacts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'A', isPrimary: true })
      .expect(201);
    const c2 = await request(app.getHttpServer())
      .post(`/service-users/${id}/contacts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'B', isPrimary: true })
      .expect(201);
    const primaries = await prisma.serviceUserContact.count({
      where: { serviceUserId: id, deletedAt: null, isPrimary: true },
    });
    expect(primaries).toBe(1);

    await request(app.getHttpServer())
      .delete(`/service-users/${id}/contacts/${c2.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/service-users/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('rejects invalid key worker on assignment', async () => {
    const create = await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Assign', lastName: 'Test', email: `e2e.as.${Date.now()}@example.com` })
      .expect(201);
    const id = create.body.data.id as string;
    const fakeEmp = '00000000-0000-4000-8000-000000000001';
    await request(app.getHttpServer())
      .patch(`/service-users/${id}/assignments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ keyWorkerId: fakeEmp })
      .expect(400);
    await request(app.getHttpServer())
      .delete(`/service-users/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('GET /service-users/:id/dom-care returns defaults for a new service user', async () => {
    const create = await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Dom', lastName: 'CareE2E', email: `e2e.dom.${Date.now()}@example.com` })
      .expect(201);
    const id = create.body.data?.id as string;
    expect(id).toBeTruthy();
    const dom = await request(app.getHttpServer())
      .get(`/service-users/${id}/dom-care`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(dom.body.data?.numberOfCarers).toBe(1);
    expect(dom.body.data?.preferredCarers).toEqual([]);
    await request(app.getHttpServer())
      .delete(`/service-users/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('GET /service-users/:id/initial-assessment returns defaults for a new service user', async () => {
    const create = await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'IA', lastName: 'E2E', email: `e2e.ia.${Date.now()}@example.com` })
      .expect(201);
    const id = create.body.data?.id as string;
    expect(id).toBeTruthy();
    const ia = await request(app.getHttpServer())
      .get(`/service-users/${id}/initial-assessment`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(ia.body.data?.numberOfCarers).toBe(1);
    expect(ia.body.data?.checklist).toEqual({});
    await request(app.getHttpServer())
      .delete(`/service-users/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });
});
