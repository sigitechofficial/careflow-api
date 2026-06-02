import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../../app.module';
import {
  MEDICATION_EVENT_CREATED_ENVELOPE_EXAMPLE,
  MEDICATION_PACK_MEMBERS_LIST_ENVELOPE_EXAMPLE,
  MEDICATION_PACK_PUBLISH_ENVELOPE_EXAMPLE,
  MEDICATION_REGULAR_CHART_ENVELOPE_EXAMPLE,
} from './medication-api.examples';

const MEDICATION_PATHS = [
  '/service-users/{id}/medication-chart/regular',
  '/service-users/{id}/medication-chart/regular/export',
  '/service-users/{id}/medication-events',
  '/service-users/{id}/medication-supply',
  '/medication-reports/administered',
  '/medication-status-codes',
  '/medication-administration-rounds',
] as const;

const MEDICATION_PACK_PATHS = [
  '/service-users/{id}/medication-packs',
  '/service-users/{id}/medication-packs/{packId}',
  '/service-users/{id}/medication-packs/{packId}/members',
  '/service-users/{id}/medication-packs/{packId}/members/{memberId}',
  '/service-users/{id}/medication-packs/{packId}/manifest',
  '/service-users/{id}/medication-packs/{packId}/manifest/pdf',
  '/service-users/{id}/medication-packs/{packId}/publish',
  '/service-users/{id}/medication-packs/{packId}/supersede',
  '/service-users/{id}/medication-packs/{packId}/end',
  '/service-users/{id}/medication-packs/{packId}/compartments',
  '/service-users/{id}/medication-packs/{packId}/compartments/{compartmentId}',
  '/service-users/{id}/medication-packs/{packId}/deliveries',
  '/service-users/{id}/medication-packs/{packId}/deliveries/{deliveryId}/lines/{lineId}',
  '/service-users/{id}/medication-packs/{packId}/deliveries/{deliveryId}/countersign',
] as const;

function extractResponseExample(response: unknown): unknown {
  const typed = response as
    | {
        schema?: { example?: unknown };
        content?: { 'application/json'?: { example?: unknown; schema?: { example?: unknown } } };
      }
    | undefined;
  return (
    typed?.content?.['application/json']?.example ??
    typed?.content?.['application/json']?.schema?.example ??
    typed?.schema?.example
  );
}

describe('Medication OpenAPI contract', () => {
  it('documents critical medication paths with operation responses', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('CareAdmin API').setVersion('1.0.0').addBearerAuth().build(),
    );

    for (const path of MEDICATION_PATHS) {
      expect(document.paths?.[path]).toBeDefined();
    }

    const regularGet = document.paths?.['/service-users/{id}/medication-chart/regular']?.get;
    expect(regularGet?.responses?.['200']).toBeDefined();
    expect(regularGet?.responses?.['400']).toBeDefined();

    const eventsPost = document.paths?.['/service-users/{id}/medication-events']?.post;
    expect(eventsPost?.responses?.['201'] ?? eventsPost?.responses?.['200']).toBeDefined();

    await app.close();
  });

  it('documents medication pack paths with operation responses', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('CareAdmin API').setVersion('1.0.0').addBearerAuth().build(),
    );

    for (const path of MEDICATION_PACK_PATHS) {
      expect(document.paths?.[path]).toBeDefined();
    }

    const membersGet = document.paths?.['/service-users/{id}/medication-packs/{packId}/members']?.get;
    expect(membersGet?.responses?.['200']).toBeDefined();

    const publishPost =
      document.paths?.['/service-users/{id}/medication-packs/{packId}/publish']?.post;
    expect(publishPost?.responses?.['201']).toBeDefined();

    const exportGet =
      document.paths?.['/service-users/{id}/medication-chart/regular/export']?.get;
    const exportParams = exportGet?.parameters ?? [];
    expect(exportParams.some(p => 'name' in p && p.name === 'packExportDetail')).toBe(true);

    await app.close();
  });

  it('embeds golden examples on primary operations', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('CareAdmin API').setVersion('1.0.0').addBearerAuth().build(),
    );

    const regular200 =
      document.paths?.['/service-users/{id}/medication-chart/regular']?.get?.responses?.['200'];
    expect(extractResponseExample(regular200)).toEqual(MEDICATION_REGULAR_CHART_ENVELOPE_EXAMPLE);

    const createResp =
      document.paths?.['/service-users/{id}/medication-events']?.post?.responses?.['201'];
    expect(extractResponseExample(createResp)).toEqual(MEDICATION_EVENT_CREATED_ENVELOPE_EXAMPLE);

    const members200 =
      document.paths?.['/service-users/{id}/medication-packs/{packId}/members']?.get?.responses?.[
        '200'
      ];
    expect(extractResponseExample(members200)).toEqual(MEDICATION_PACK_MEMBERS_LIST_ENVELOPE_EXAMPLE);

    const publish201 =
      document.paths?.['/service-users/{id}/medication-packs/{packId}/publish']?.post?.responses?.[
        '201'
      ];
    expect(extractResponseExample(publish201)).toEqual(MEDICATION_PACK_PUBLISH_ENVELOPE_EXAMPLE);

    await app.close();
  });
});
