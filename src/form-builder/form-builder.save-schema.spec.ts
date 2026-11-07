import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CarePathwayFormFieldType,
  CarePathwayFormStatus,
} from '@prisma/client';
import { SaveCareFormSchemaDto } from './dto/save-care-form-schema.dto';
import { createFormBuilderHarness } from './form-builder.test-harness';

/**
 * `PATCH /form-builder/:id/schema` must be ID-safe: care plan answers are stored as
 * `{ "${sectionId}:${fieldId}": value }` and show-when rules point at sectionId/fieldId,
 * so a save may never re-mint ids for rows that survive it.
 */

const USER = 'user-1';

/** Same options as the global pipe in main.ts, so DTO shape errors surface exactly as in prod. */
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});

function validate(body: unknown): Promise<SaveCareFormSchemaDto> {
  return pipe.transform(body, {
    type: 'body',
    metatype: SaveCareFormSchemaDto,
  });
}

type Detail = Awaited<
  ReturnType<ReturnType<typeof createFormBuilderHarness>['service']['getById']>
>['data'];

/** Wire shape of the request body (before the ValidationPipe), as the admin builder sends it. */
type FieldPayload = {
  id?: string;
  clientId?: string;
  label: string;
  fieldKey?: string;
  fieldType: string;
  required?: boolean;
  sortOrder: number;
  conditionalLogicJson?: unknown;
  validationJson?: unknown;
};
type SectionPayload = {
  id?: string;
  title: string;
  sortOrder: number;
  fields: FieldPayload[];
};
type SchemaPayload = { sections: SectionPayload[] };

/** What the admin builder sends back after loading a form, before any edits. */
function echoPayload(detail: Detail): SchemaPayload {
  return {
    sections: detail.sections.map((s) => ({
      id: s.id,
      title: s.title,
      sortOrder: s.sortOrder,
      fields: s.fields.map((f) => ({
        id: f.id,
        label: f.label,
        fieldKey: f.fieldKey ?? undefined,
        fieldType: f.fieldType,
        required: f.required,
        sortOrder: f.sortOrder,
        conditionalLogicJson: f.conditionalLogicJson,
      })),
    })),
  };
}

function seedRiskForm() {
  const h = createFormBuilderHarness();
  const { formId, versionId } = h.db.seedForm([
    {
      title: 'Risk',
      fields: [
        {
          label: 'Is there a risk?',
          fieldKey: 'eating_risk',
          fieldType: CarePathwayFormFieldType.YES_NO,
        },
        {
          label: 'Identify the risk',
          fieldType: CarePathwayFormFieldType.RICH_TEXT,
        },
      ],
    },
    {
      title: 'Plan',
      fields: [{ label: 'Plan of care' }, { label: 'Outcome' }],
    },
  ]);
  return { ...h, formId, versionId };
}

async function load(h: ReturnType<typeof seedRiskForm>) {
  return (await h.service.getById(h.formId)).data;
}

async function save(h: ReturnType<typeof seedRiskForm>, body: unknown) {
  return (await h.service.saveSchema(USER, h.formId, await validate(body)))
    .data;
}

const allFieldIds = (d: Detail) =>
  d.sections.flatMap((s) => s.fields.map((f) => f.id));

describe('FormBuilderService.saveSchema — id preservation', () => {
  it('re-saving an unchanged form keeps every section and field id', async () => {
    const h = seedRiskForm();
    const before = await load(h);

    const after = await save(h, echoPayload(before));

    expect(after.sections.map((s) => s.id)).toEqual(
      before.sections.map((s) => s.id),
    );
    expect(allFieldIds(after)).toEqual(allFieldIds(before));
  });

  it('never hard-deletes and skips writes for rows that did not change', async () => {
    const h = seedRiskForm();
    await save(h, echoPayload(await load(h)));

    expect(h.db.writes).not.toContain('section.deleteMany');
    expect(
      h.db.writes.filter(
        (w) => w.startsWith('section.') || w.startsWith('field.'),
      ),
    ).toEqual([]);
  });

  it('keeps saved care plan answers attached after edits, reorder and additions', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [risk, plan] = before.sections;
    // A care plan instance's valuesJson, keyed the way the renderer/compose loader keys it.
    const answers = {
      [`${risk.id}:${risk.fields[0].id}`]: true,
      [`${plan.id}:${plan.fields[0].id}`]: 'Soft diet, encourage fluids',
    };

    const payload = echoPayload(before);
    payload.sections[0].title = 'Risk assessment';
    payload.sections[0].fields[0].label =
      'Is there an eating or drinking risk?';
    payload.sections[1].fields.reverse().forEach((f, i) => (f.sortOrder = i));
    payload.sections[1].fields.push({
      clientId: 'tmp-new-1',
      label: 'Review notes',
      fieldType: 'TEXT',
      sortOrder: 2,
    });
    const after = await save(h, payload);

    const liveKeys = new Set(
      after.sections.flatMap((s) => s.fields.map((f) => `${s.id}:${f.id}`)),
    );
    for (const key of Object.keys(answers))
      expect(liveKeys.has(key)).toBe(true);
    expect(after.sections[0].title).toBe('Risk assessment');
    expect(after.sections[0].fields[0]).toMatchObject({
      id: risk.fields[0].id,
      label: 'Is there an eating or drinking risk?',
      fieldKey: 'eating_risk',
    });
    expect(after.sections[1].fields.map((f) => f.label)).toEqual([
      'Outcome',
      'Plan of care',
      'Review notes',
    ]);
    expect(after.sections[1].fields[2].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('creates new sections with fresh ids alongside existing ones', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const payload = echoPayload(before);
    payload.sections.push({
      title: 'Preferences',
      sortOrder: 2,
      fields: [{ label: 'Favourite foods', fieldType: 'TEXT', sortOrder: 0 }],
    });

    const after = await save(h, payload);

    expect(after.sections).toHaveLength(3);
    expect(after.sections.slice(0, 2).map((s) => s.id)).toEqual(
      before.sections.map((s) => s.id),
    );
    expect(after.sections[2]).toMatchObject({ title: 'Preferences' });
    expect(before.sections.map((s) => s.id)).not.toContain(
      after.sections[2].id,
    );
  });

  it('soft-retires a removed field: hidden from the form, row and id kept', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const removed = before.sections[1].fields[1];
    const payload = echoPayload(before);
    payload.sections[1].fields = payload.sections[1].fields.slice(0, 1);

    const after = await save(h, payload);

    expect(allFieldIds(after)).not.toContain(removed.id);
    const row = h.db.fields.find((f) => f.id === removed.id)!;
    expect(row).toMatchObject({
      isActive: false,
      deletedAt: null,
      label: 'Outcome',
    });
  });

  it('soft-deletes a removed section and deactivates its fields', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const removed = before.sections[1];
    const payload = echoPayload(before);
    payload.sections = payload.sections.slice(0, 1);

    const after = await save(h, payload);

    expect(after.sections.map((s) => s.id)).toEqual([before.sections[0].id]);
    const sectionRow = h.db.sections.find((s) => s.id === removed.id)!;
    expect(sectionRow.deletedAt).toBeInstanceOf(Date);
    expect(sectionRow.isActive).toBe(false);
    for (const f of removed.fields) {
      expect(h.db.fields.find((r) => r.id === f.id)).toMatchObject({
        isActive: false,
      });
    }
  });

  it('keeps a field id when it moves to another section', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const moving = before.sections[1].fields[1];
    const payload = echoPayload(before);
    const [field] = payload.sections[1].fields.splice(1, 1);
    payload.sections[0].fields.push({ ...field, sortOrder: 2 });

    const after = await save(h, payload);

    expect(after.sections[0].fields.map((f) => f.id)).toContain(moving.id);
    expect(h.db.fields.find((f) => f.id === moving.id)).toMatchObject({
      sectionId: before.sections[0].id,
      isActive: true,
    });
  });

  it('rejects ids that are not on the form (stale editor) without writing anything', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const payload = echoPayload(before);
    payload.sections[0].fields[0].id = '7f1c9a52-0d4e-4b55-9a39-8d6f0b1d2c3e';

    await expect(save(h, payload)).rejects.toThrow(
      /no longer exists on this form/,
    );
    expect(h.db.writes).toEqual([]);
  });

  it('rejects the same field twice', async () => {
    const h = seedRiskForm();
    const payload = echoPayload(await load(h));
    payload.sections[1].fields.push({
      ...payload.sections[0].fields[0],
      sortOrder: 5,
    });

    await expect(save(h, payload)).rejects.toThrow(/appears twice/);
  });

  it('records what changed in the audit metadata and writes ids into schemaJson', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const payload = echoPayload(before);
    payload.sections[0].fields[1].label = 'Describe the risk';
    payload.sections[1].fields = payload.sections[1].fields.slice(0, 1);
    payload.sections[1].fields.push({
      label: 'New',
      fieldType: 'TEXT',
      sortOrder: 1,
    });

    await save(h, payload);

    expect(h.audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          schemaSaved: true,
          sectionsCreated: 0,
          sectionsUpdated: 0,
          sectionsRetired: 0,
          fieldsCreated: 1,
          fieldsUpdated: 1,
          fieldsRetired: 1,
        },
      }),
    );
    const schema = h.db.versions.find((v) => v.id === h.versionId)!
      .schemaJson as {
      sections: { id: string; fields: Record<string, unknown>[] }[];
    };
    expect(schema.sections[0].id).toBe(before.sections[0].id);
    expect(schema.sections[0].fields[1]).toMatchObject({
      id: before.sections[0].fields[1].id,
      label: 'Describe the risk',
      conditionalLogicJson: null,
    });
  });

  it('still moves a published form back to draft on save', async () => {
    const h = createFormBuilderHarness();
    const { formId } = h.db.seedForm(
      [{ title: 'S', fields: [{ label: 'F' }] }],
      CarePathwayFormStatus.PUBLISHED,
    );
    const before = (await h.service.getById(formId)).data;
    const after = (
      await h.service.saveSchema(
        USER,
        formId,
        await validate(echoPayload(before)),
      )
    ).data;
    expect(after.status).toBe(CarePathwayFormStatus.DRAFT);
  });
});

describe('FormBuilderService.saveSchema — conditional logic (show when)', () => {
  it('accepts and persists conditionalLogicJson through a save and reload', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [risk] = before.sections;
    const logic = {
      showWhen: [
        { sectionId: risk.id, fieldId: risk.fields[0].id, operator: 'is_true' },
      ],
    };
    const payload = echoPayload(before);
    payload.sections[0].fields[1].conditionalLogicJson = logic;

    await save(h, payload);
    const reloaded = await load(h);

    expect(reloaded.sections[0].fields[1].conditionalLogicJson).toEqual(logic);
    // …and the reloaded form round-trips through another save unchanged.
    await save(h, echoPayload(reloaded));
    expect((await load(h)).sections[0].fields[1].conditionalLogicJson).toEqual(
      logic,
    );
  });

  it('keeps a value-based rule exactly as sent', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [, plan] = before.sections;
    const logic = {
      showWhen: [
        {
          sectionId: plan.id,
          fieldId: plan.fields[0].id,
          operator: 'equals',
          value: 'No',
        },
      ],
    };
    const payload = echoPayload(before);
    payload.sections[1].fields[1].conditionalLogicJson = logic;

    const after = await save(h, payload);
    expect(after.sections[1].fields[1].conditionalLogicJson).toEqual(logic);
  });

  it('resolves rules that point at fields created in the same save (clientId)', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const payload = echoPayload(before);
    payload.sections.push({
      title: 'Swallowing',
      sortOrder: 2,
      fields: [
        {
          clientId: 'tmp-gate',
          label: 'Swallowing difficulty?',
          fieldType: 'YES_NO',
          sortOrder: 0,
        },
        {
          clientId: 'tmp-detail',
          label: 'Describe',
          fieldType: 'TEXT',
          sortOrder: 1,
          conditionalLogicJson: {
            showWhen: [
              {
                sectionId: 'tmp-section',
                fieldId: 'tmp-gate',
                operator: 'is_true',
              },
            ],
          },
        },
      ],
    });

    const after = await save(h, payload);
    const swallowing = after.sections[2];
    const [gate, detail] = swallowing.fields;

    expect(detail.conditionalLogicJson).toEqual({
      showWhen: [
        { sectionId: swallowing.id, fieldId: gate.id, operator: 'is_true' },
      ],
    });
  });

  it('normalises a rule sectionId to where the controlling field actually lives', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [risk, plan] = before.sections;
    const payload = echoPayload(before);
    payload.sections[1].fields[0].conditionalLogicJson = {
      showWhen: [
        { sectionId: plan.id, fieldId: risk.fields[0].id, operator: 'is_true' },
      ],
    };

    const after = await save(h, payload);
    expect(after.sections[1].fields[0].conditionalLogicJson).toEqual({
      showWhen: [
        { sectionId: risk.id, fieldId: risk.fields[0].id, operator: 'is_true' },
      ],
    });
  });

  it('keeps stored rules when a client omits conditionalLogicJson, clears them on null', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [risk] = before.sections;
    const logic = {
      showWhen: [
        { sectionId: risk.id, fieldId: risk.fields[0].id, operator: 'is_true' },
      ],
    };
    const withRule = echoPayload(before);
    withRule.sections[0].fields[1].conditionalLogicJson = logic;
    await save(h, withRule);

    const omitted = echoPayload(await load(h));
    delete omitted.sections[0].fields[1].conditionalLogicJson;
    await save(h, omitted);
    expect((await load(h)).sections[0].fields[1].conditionalLogicJson).toEqual(
      logic,
    );

    const cleared = echoPayload(await load(h));
    cleared.sections[0].fields[1].conditionalLogicJson = null;
    await save(h, cleared);
    expect(
      (await load(h)).sections[0].fields[1].conditionalLogicJson,
    ).toBeNull();
  });

  it('stores an empty showWhen list as no logic', async () => {
    const h = seedRiskForm();
    const payload = echoPayload(await load(h));
    payload.sections[0].fields[1].conditionalLogicJson = { showWhen: [] };
    const after = await save(h, payload);
    expect(after.sections[0].fields[1].conditionalLogicJson).toBeNull();
  });

  it('does not rewrite a rule that only differs by jsonb key order', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [risk] = before.sections;
    // Postgres jsonb hands keys back in its own order; that must not count as a change.
    h.db.fields.find((f) => f.id === risk.fields[1].id)!.conditionalLogicJson =
      {
        showWhen: [
          {
            operator: 'is_true',
            fieldId: risk.fields[0].id,
            sectionId: risk.id,
          },
        ],
      };
    h.db.writes = [];

    await save(h, echoPayload(await load(h)));
    expect(h.db.writes).not.toContain('field.update');
  });

  it('rejects a rule that points at a field removed in the same save', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [risk] = before.sections;
    const payload = echoPayload(before);
    payload.sections[0].fields[1].conditionalLogicJson = {
      showWhen: [
        { sectionId: risk.id, fieldId: risk.fields[0].id, operator: 'is_true' },
      ],
    };
    payload.sections[0].fields.splice(0, 1);

    await expect(save(h, payload)).rejects.toThrow(
      /"show when" condition on a field that is not on this form/,
    );
    expect(h.db.writes).toEqual([]);
  });

  it('rejects removing a field that a stored (omitted) rule still depends on', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [risk] = before.sections;
    h.db.fields.find((f) => f.id === risk.fields[1].id)!.conditionalLogicJson =
      {
        showWhen: [
          {
            sectionId: risk.id,
            fieldId: risk.fields[0].id,
            operator: 'is_true',
          },
        ],
      };
    const payload = echoPayload(await load(h));
    delete payload.sections[0].fields[1].conditionalLogicJson;
    payload.sections[0].fields.splice(0, 1);

    await expect(save(h, payload)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a rule on the field itself', async () => {
    const h = seedRiskForm();
    const before = await load(h);
    const [risk] = before.sections;
    const payload = echoPayload(before);
    payload.sections[0].fields[1].conditionalLogicJson = {
      showWhen: [
        {
          sectionId: risk.id,
          fieldId: risk.fields[1].id,
          operator: 'equals',
          value: 'x',
        },
      ],
    };

    await expect(save(h, payload)).rejects.toThrow(/on itself/);
  });
});

describe('FormBuilderService.saveSchema — validationJson', () => {
  it('persists, preserves when omitted, and clears on null', async () => {
    const h = seedRiskForm();
    const payload = echoPayload(await load(h));
    payload.sections[1].fields[0].validationJson = {
      maxLength: 2000,
      rules: [{ min: 1 }],
    };
    await save(h, payload);
    expect((await load(h)).sections[1].fields[0].validationJson).toEqual({
      maxLength: 2000,
      rules: [{ min: 1 }],
    });

    await save(h, echoPayload(await load(h)));
    expect((await load(h)).sections[1].fields[0].validationJson).toEqual({
      maxLength: 2000,
      rules: [{ min: 1 }],
    });

    const cleared = echoPayload(await load(h));
    cleared.sections[1].fields[0].validationJson = null;
    await save(h, cleared);
    expect((await load(h)).sections[1].fields[0].validationJson).toBeNull();
  });
});

describe('SaveCareFormSchemaDto validation', () => {
  const field = (extra: Record<string, unknown> = {}) => ({
    label: 'Describe',
    fieldType: 'TEXT',
    sortOrder: 0,
    ...extra,
  });
  const body = (f: Record<string, unknown>) => ({
    sections: [{ title: 'S', sortOrder: 0, fields: [f] }],
  });
  const rule = (extra: Record<string, unknown> = {}) => ({
    sectionId: 's',
    fieldId: 'f',
    operator: 'is_true',
    ...extra,
  });

  it('accepts a well-formed show-when rule and null logic', async () => {
    await expect(
      validate(body(field({ conditionalLogicJson: { showWhen: [rule()] } }))),
    ).resolves.toBeDefined();
    const dto = await validate(body(field({ conditionalLogicJson: null })));
    expect(dto.sections[0].fields[0].conditionalLogicJson).toBeNull();
  });

  it.each([
    ['unknown operator', { showWhen: [rule({ operator: 'greater_than' })] }],
    [
      'missing fieldId',
      { showWhen: [{ sectionId: 's', operator: 'is_true' }] },
    ],
    ['extra rule property', { showWhen: [rule({ hack: 1 })] }],
    ['showWhen not an array', { showWhen: rule() }],
    ['unknown top-level key', { showWhen: [rule()], hideWhen: [] }],
    ['an array instead of an object', [rule()]],
    [
      'a non-string value',
      { showWhen: [rule({ operator: 'equals', value: { a: 1 } })] },
    ],
    ['too many rules', { showWhen: Array.from({ length: 11 }, () => rule()) }],
  ])('rejects conditionalLogicJson with %s', async (_label, logic) => {
    await expect(
      validate(body(field({ conditionalLogicJson: logic }))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-uuid field id and a malformed clientId', async () => {
    await expect(
      validate(body(field({ id: 'new-field-0' }))),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate(body(field({ clientId: 'has spaces' }))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a validationJson object intact and rejects arrays or oversized values', async () => {
    const dto = await validate(
      body(field({ validationJson: { maxLength: 10, nested: { a: [1] } } })),
    );
    expect(dto.sections[0].fields[0].validationJson).toEqual({
      maxLength: 10,
      nested: { a: [1] },
    });

    await expect(
      validate(body(field({ validationJson: [1, 2] }))),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate(body(field({ validationJson: { blob: 'x'.repeat(5000) } }))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
