/**
 * Requires PostgreSQL from DATABASE_URL, migrated schema, and seed (admin@careadmin.local / Admin@12345).
 * Run: pnpm test:e2e --testPathPatterns=service-user-live-in-profile
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requiredServiceUserFields } from './helpers/service-user-required-fields';

const shouldRun = Boolean(process.env.DATABASE_URL);
const describeLiveIn = shouldRun ? describe : describe.skip;

describeLiveIn('Service user live-in profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let suRequired: Awaited<ReturnType<typeof requiredServiceUserFields>>;
  let accessToken: string;
  let userId: string;

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
    suRequired = await requiredServiceUserFields(prisma);

    const liveInPermKeys = [
      'service_users.live_in_profile.read',
      'service_users.live_in_profile.create',
      'service_users.live_in_profile.update',
      'service_users.live_in_profile.delete',
      'service_users.live_in_profile.status.update',
      'service_users.live_in_profile.carers.read',
      'service_users.live_in_profile.carers.manage',
      'service_users.live_in_profile.documents.read',
      'service_users.live_in_profile.documents.upload',
      'service_users.live_in_profile.documents.download',
      'service_users.live_in_profile.documents.delete',
      'service_users.live_in_profile.lookups.read',
    ];
    for (const key of liveInPermKeys) {
      await prisma.permission.upsert({
        where: { key },
        update: { isActive: true, deletedAt: null },
        create: { key, isActive: true },
      });
    }
    const superAdminRole = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
    if (superAdminRole) {
      const perms = await prisma.permission.findMany({ where: { key: { in: liveInPermKeys } } });
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
    const adminUser = await prisma.user.findFirst({ where: { email: 'admin@careadmin.local', deletedAt: null } });
    userId = adminUser?.id ?? '';
    if (!accessToken) {
      // eslint-disable-next-line no-console
      console.warn('[live-in e2e] Login failed:', login.status, login.body);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET live-in-profile without token returns 401', async () => {
    const su = await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...suRequired, firstName: 'L', lastName: 'I', email: `li401.${Date.now()}@example.com` })
      .expect(201);
    const suId = su.body.data.id as string;
    await request(app.getHttpServer()).get(`/service-users/${suId}/live-in-profile`).expect(401);
  });

  it('creates profile, rejects duplicate, validates fields, carers, contracts, audit and data access', async () => {
    const su = await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...suRequired, firstName: 'Live', lastName: 'In', email: `li.e2e.${Date.now()}@example.com` })
      .expect(201);
    const suId = su.body.data.id as string;

    const contact = await request(app.getHttpServer())
      .post(`/service-users/${suId}/contacts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Resident', isPrimary: false })
      .expect(201);
    const contactId = contact.body.data.id as string;

    const wrongSu = await request(app.getHttpServer())
      .post('/service-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...suRequired, firstName: 'Other', lastName: 'Su', email: `li.other.${Date.now()}@example.com` })
      .expect(201);
    const wrongContact = await request(app.getHttpServer())
      .post(`/service-users/${wrongSu.body.data.id}/contacts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Wrong', isPrimary: false })
      .expect(201);
    const wrongContactId = wrongContact.body.data.id as string;

    const emp = await prisma.employee.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(emp).toBeTruthy();

    const c1 = await request(app.getHttpServer())
      .post(`/service-users/${suId}/live-in-profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isLiveInEnabled: true, numberOfCarers: 2, status: 'DRAFT' })
      .expect(201);
    const profileId = c1.body.data?.id as string;
    expect(profileId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/service-users/${suId}/live-in-profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(409);

    const auditCreate = await prisma.auditLog.findFirst({
      where: { action: 'live_in_profile_created', recordId: profileId },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditCreate).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/service-users/${suId}/live-in-profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ numberOfCarers: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/service-users/${suId}/live-in-profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ startDate: '2026-06-01', endDate: '2026-05-01' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/service-users/${suId}/live-in-profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ residentContactId: wrongContactId })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/service-users/${suId}/live-in-profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ residentContactId: contactId })
      .expect(200);

    const getProf = await request(app.getHttpServer())
      .get(`/service-users/${suId}/live-in-profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(getProf.body.data?.id).toBe(profileId);

    const dalView = await prisma.dataAccessLog.findFirst({
      where: {
        userId,
        module: 'SERVICE_USER',
        recordType: 'ServiceUserLiveInProfile',
        recordId: profileId,
        accessType: 'VIEW',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(dalView).toBeTruthy();

    const auditView = await prisma.auditLog.findFirst({
      where: { action: 'live_in_profile_viewed', recordId: profileId },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditView).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/service-users/${suId}/live-in-profile/preferred-carers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ employeeId: emp!.id, reason: 'Family' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/service-users/${suId}/live-in-profile/blocked-carers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ employeeId: emp!.id })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/service-users/${suId}/live-in-profile/preferred-carers/${emp!.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/service-users/${suId}/live-in-profile/blocked-carers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ employeeId: emp!.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/service-users/${suId}/live-in-profile/preferred-carers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ employeeId: emp!.id })
      .expect(400);

    const up = await request(app.getHttpServer())
      .post(`/service-users/${suId}/live-in-profile/contract-documents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('%PDF-1.4\ne2e'), { filename: 'contract.pdf', contentType: 'application/pdf' })
      .expect(201);
    const docId = up.body.data?.id as string;
    expect(docId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/service-users/${suId}/live-in-profile/contract-documents`)
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('not a pdf'), { filename: 'x.exe', contentType: 'application/octet-stream' })
      .expect(400);

    await request(app.getHttpServer())
      .get(`/service-users/${suId}/live-in-profile/contract-documents/${docId}/download`)
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer()
      .parse((res, cb) => {
        const data: Buffer[] = [];
        res.on('data', (c: Buffer) => data.push(c));
        res.on('end', () => cb(null, Buffer.concat(data)));
      })
      .expect(200);

    const dalDl = await prisma.dataAccessLog.findFirst({
      where: {
        userId,
        module: 'SERVICE_USER',
        recordType: 'ServiceUserLiveInContractDocument',
        recordId: docId,
        accessType: 'DOWNLOAD',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(dalDl).toBeTruthy();

    await request(app.getHttpServer())
      .delete(`/service-users/${suId}/live-in-profile/contract-documents/${docId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const auditPatch = await prisma.auditLog.findFirst({
      where: { action: 'live_in_profile_updated', recordId: profileId },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditPatch).toBeTruthy();

    await request(app.getHttpServer())
      .delete(`/service-users/${suId}/live-in-profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const auditDel = await prisma.auditLog.findFirst({
      where: { action: 'live_in_profile_deleted', recordId: profileId },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditDel).toBeTruthy();
  });
});
