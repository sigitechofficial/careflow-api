/**
 * Requires PostgreSQL, migrated schema, seed (admin@careadmin.local / Admin@12345).
 * Run: pnpm test:e2e --testPathPatterns=initial-assessment
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const shouldRun = Boolean(process.env.DATABASE_URL);
const describeIa = shouldRun ? describe : describe.skip;

describeIa('Initial Assessment Checklist (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let serviceUserId: string;
  let templateId: string;
  let submissionId: string;
  let questionId: string;

  const perms = [
    'service_users.read',
    'service_users.initial_assessment.read',
    'service_users.initial_assessment.create',
    'service_users.initial_assessment.update',
    'service_users.initial_assessment.delete',
    'service_users.initial_assessment.submit',
    'service_users.initial_assessment.review',
    'initial_assessment_templates.read',
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

    for (const key of perms) {
      await prisma.permission.upsert({
        where: { key },
        update: { isActive: true, deletedAt: null },
        create: { key, isActive: true },
      });
    }
    const superAdminRole = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
    if (superAdminRole) {
      const found = await prisma.permission.findMany({ where: { key: { in: perms } } });
      for (const p of found) {
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

    const defaultTpl = await request(app.getHttpServer())
      .get('/initial-assessment-templates/default')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(defaultTpl.status).toBe(200);
    templateId = defaultTpl.body.data.id;
    expect(defaultTpl.body.data.sections?.length).toBeGreaterThanOrEqual(28);
    questionId = defaultTpl.body.data.sections[0].questions[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates assessment submission', async () => {
    const res = await request(app.getHttpServer())
      .post(`/service-users/${serviceUserId}/initial-assessments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(201);
    submissionId = res.body.data.id;
    expect(res.body.data.status).toBe('DRAFT');
  });

  it('prevents duplicate active draft', async () => {
    const res = await request(app.getHttpServer())
      .post(`/service-users/${serviceUserId}/initial-assessments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ templateId });
    expect(res.status).toBe(409);
  });

  it('saves answers', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/service-users/${serviceUserId}/initial-assessments/${submissionId}/answers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ answers: [{ questionId, checked: true }] });
    expect(res.status).toBe(200);
  });

  it('rejects answer for unknown question', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/service-users/${serviceUserId}/initial-assessments/${submissionId}/answers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        answers: [{ questionId: '00000000-0000-4000-8000-000000000001', checked: true }],
      });
    expect(res.status).toBe(400);
  });

  it('submits assessment', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/service-users/${serviceUserId}/initial-assessments/${submissionId}/submit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUBMITTED');
  });

  it('rejects answer edit after submit', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/service-users/${serviceUserId}/initial-assessments/${submissionId}/answers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ answers: [{ questionId, checked: false }] });
    expect(res.status).toBe(403);
  });

  it('reviews assessment', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/service-users/${serviceUserId}/initial-assessments/${submissionId}/review`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'REVIEWED', reviewNotes: 'E2E review OK' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REVIEWED');
  });

  it('returns risk summary and care plan triggers', async () => {
    const risk = await request(app.getHttpServer())
      .get(`/service-users/${serviceUserId}/initial-assessments/${submissionId}/risk-summary`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(risk.status).toBe(200);
    expect(risk.body.data).toHaveProperty('items');

    const triggers = await request(app.getHttpServer())
      .get(`/service-users/${serviceUserId}/initial-assessments/${submissionId}/care-plan-triggers`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(triggers.status).toBe(200);
    expect(triggers.body.data).toHaveProperty('items');
  });

  it('returns 401 without token', async () => {
    const res = await request(app.getHttpServer()).get(
      `/service-users/${serviceUserId}/initial-assessments`,
    );
    expect(res.status).toBe(401);
  });
});
