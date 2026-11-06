import { randomUUID } from 'crypto';
import {
  CarePathwayFormFieldType,
  CarePathwayFormStatus,
  CarePathwayFormType,
  Prisma,
} from '@prisma/client';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FormBuilderService } from './form-builder.service';

/**
 * In-memory stand-in for the slice of Prisma that `FormBuilderService` touches
 * (care_pathway forms, versions, sections, fields). It mirrors the parts of Prisma
 * behaviour the save-schema contract depends on: caller-supplied or generated uuids,
 * `onDelete: Cascade` from section → fields, `Prisma.JsonNull`, and the `formInclude`
 * read filters (sections `deletedAt: null`; fields `deletedAt: null, isActive: true`).
 */

export type FakeSection = {
  id: string;
  formVersionId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type FakeField = {
  id: string;
  sectionId: string;
  fieldKey: string | null;
  label: string;
  fieldType: CarePathwayFormFieldType;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  optionsJson: unknown;
  validationJson: unknown;
  conditionalLogicJson: unknown;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type FakeForm = {
  id: string;
  name: string;
  description: string | null;
  formType: CarePathwayFormType;
  status: CarePathwayFormStatus;
  lastPublishedAt: Date | null;
  publishedById: string | null;
  versionLabel: string;
  pictureUrl: string | null;
  reviewFrequencyMonths: number | null;
  currentVersionId: string | null;
  updatedById: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
};

type FakeVersion = { id: string; formId: string; schemaJson: unknown };

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type Data = Record<string, unknown>;
type WhereArgs = { where?: Where };
type WriteArgs = { where: Where; data: Data };

type WhereOperator = { in?: unknown[]; notIn?: unknown[]; not?: unknown };

function isOperator(cond: unknown): cond is WhereOperator {
  return !!cond && typeof cond === 'object' && !(cond instanceof Date);
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (isOperator(cond)) {
      if (cond.in) return cond.in.includes(value);
      if (cond.notIn) return !cond.notIn.includes(value);
      if ('not' in cond) return value !== cond.not;
      throw new Error(`fake prisma: unsupported where operator on ${key}`);
    }
    return value === cond;
  });
}

/** Prisma stores `Prisma.JsonNull` as JSON null and reads it back as `null`. */
function stored(value: unknown): unknown {
  return value === Prisma.JsonNull || value === Prisma.DbNull ? null : value;
}

function applyData<T extends object>(row: T, data: Data): T {
  const target = row as Row;
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) target[key] = stored(value);
  }
  target.updatedAt = new Date();
  return row;
}

const str = (v: unknown) => v as string;
const strOrNull = (v: unknown) => (v ?? null) as string | null;

export class FormBuilderPrismaFake {
  forms: FakeForm[] = [];
  versions: FakeVersion[] = [];
  sections: FakeSection[] = [];
  fields: FakeField[] = [];
  /** Every write the service issued, in order — lets specs assert "no hard deletes". */
  writes: string[] = [];

  private sectionInclude(versionId: string) {
    return this.sections
      .filter((s) => s.formVersionId === versionId && s.deletedAt === null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        ...s,
        fields: this.fields
          .filter(
            (f) => f.sectionId === s.id && f.deletedAt === null && f.isActive,
          )
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((f) => ({ ...f })),
      }));
  }

  private formWithInclude(form: FakeForm) {
    const version = this.versions.find((v) => v.id === form.currentVersionId);
    return {
      ...form,
      currentVersion: version
        ? { ...version, sections: this.sectionInclude(version.id) }
        : null,
    };
  }

  /** Field filter with support for the `section: {...}` relation filter. */
  private fieldsWhere(where: Where | undefined) {
    const { section, ...rest } = where ?? {};
    return this.fields.filter((f) => {
      if (!matches(f, rest)) return false;
      if (!section) return true;
      const s = this.sections.find((x) => x.id === f.sectionId);
      return !!s && matches(s, section as Where);
    });
  }

  private insertSection(data: Data): FakeSection {
    const row: FakeSection = {
      id: (data.id as string | undefined) ?? randomUUID(),
      formVersionId: str(data.formVersionId),
      title: str(data.title),
      description: strOrNull(data.description),
      sortOrder: (data.sortOrder as number | undefined) ?? 0,
      isActive: (data.isActive as boolean | undefined) ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: (data.deletedAt as Date | undefined) ?? null,
    };
    this.sections.push(row);
    return row;
  }

  private insertField(data: Data): FakeField {
    const row: FakeField = {
      id: (data.id as string | undefined) ?? randomUUID(),
      sectionId: str(data.sectionId),
      fieldKey: strOrNull(data.fieldKey),
      label: str(data.label),
      fieldType: data.fieldType as CarePathwayFormFieldType,
      placeholder: strOrNull(data.placeholder),
      helpText: strOrNull(data.helpText),
      required: (data.required as boolean | undefined) ?? false,
      optionsJson: stored(data.optionsJson) ?? null,
      validationJson: stored(data.validationJson) ?? null,
      conditionalLogicJson: stored(data.conditionalLogicJson) ?? null,
      sortOrder: (data.sortOrder as number | undefined) ?? 0,
      isActive: (data.isActive as boolean | undefined) ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: (data.deletedAt as Date | undefined) ?? null,
    };
    this.fields.push(row);
    return row;
  }

  private findOrThrow<T extends { id: string }>(
    rows: T[],
    where: Where,
    what: string,
  ): T {
    const row = rows.find((r) => r.id === where.id);
    if (!row)
      throw new Error(`fake prisma: ${what} ${String(where.id)} not found`);
    return row;
  }

  /**
   * Declared as a method with an explicit return type so `client` does not reference
   * itself in its own initializer (TS7022 under the build tsconfig).
   */
  private runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn(this.client);
  }

  readonly client = {
    // Interactive transactions just run against the same in-memory store; options ignored.
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      this.runTransaction(fn),
    carePathwayForm: {
      findFirst: ({ where }: WhereArgs) => {
        const form = this.forms.find((f) => matches(f, where));
        return Promise.resolve(form ? this.formWithInclude(form) : null);
      },
      update: ({ where, data }: WriteArgs) => {
        this.writes.push('form.update');
        const form = applyData(
          this.findOrThrow(this.forms, where, 'form'),
          data,
        );
        return Promise.resolve(this.formWithInclude(form));
      },
    },
    carePathwayFormVersion: {
      update: ({ where, data }: WriteArgs) => {
        this.writes.push('version.update');
        const version = this.findOrThrow(this.versions, where, 'version');
        Object.assign(version, data);
        return Promise.resolve(version);
      },
    },
    carePathwayFormSection: {
      findMany: ({ where }: WhereArgs = {}) =>
        Promise.resolve(
          this.sections
            .filter((s) => matches(s, where))
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s) => ({ ...s })),
        ),
      create: ({ data }: { data: Data }) => {
        this.writes.push('section.create');
        return Promise.resolve({ ...this.insertSection(data) });
      },
      update: ({ where, data }: WriteArgs) => {
        this.writes.push('section.update');
        return Promise.resolve({
          ...applyData(this.findOrThrow(this.sections, where, 'section'), data),
        });
      },
      updateMany: ({ where, data }: WriteArgs) => {
        this.writes.push('section.updateMany');
        const rows = this.sections.filter((s) => matches(s, where));
        rows.forEach((r) => applyData(r, data));
        return Promise.resolve({ count: rows.length });
      },
      deleteMany: ({ where }: { where: Where }) => {
        this.writes.push('section.deleteMany');
        const doomed = new Set(
          this.sections.filter((s) => matches(s, where)).map((s) => s.id),
        );
        this.sections = this.sections.filter((s) => !doomed.has(s.id));
        this.fields = this.fields.filter((f) => !doomed.has(f.sectionId)); // onDelete: Cascade
        return Promise.resolve({ count: doomed.size });
      },
    },
    carePathwayFormField: {
      findMany: ({ where }: WhereArgs = {}) =>
        Promise.resolve(
          this.fieldsWhere(where)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((f) => ({ ...f })),
        ),
      create: ({ data }: { data: Data }) => {
        this.writes.push('field.create');
        return Promise.resolve({ ...this.insertField(data) });
      },
      createMany: ({ data }: { data: Data[] }) => {
        this.writes.push('field.createMany');
        data.forEach((d) => this.insertField(d));
        return Promise.resolve({ count: data.length });
      },
      update: ({ where, data }: WriteArgs) => {
        this.writes.push('field.update');
        return Promise.resolve({
          ...applyData(this.findOrThrow(this.fields, where, 'field'), data),
        });
      },
      updateMany: ({ where, data }: WriteArgs) => {
        this.writes.push('field.updateMany');
        const rows = this.fieldsWhere(where);
        rows.forEach((r) => applyData(r, data));
        return Promise.resolve({ count: rows.length });
      },
    },
  };

  /** Seed a form with one version holding the given sections/fields. */
  seedForm(
    sections: {
      title: string;
      fields: (Partial<FakeField> & { label: string })[];
    }[],
    status: CarePathwayFormStatus = CarePathwayFormStatus.DRAFT,
  ) {
    const formId = randomUUID();
    const versionId = randomUUID();
    this.forms.push({
      id: formId,
      name: 'Eating and drinking',
      description: null,
      formType: CarePathwayFormType.CARE_PLAN,
      status,
      lastPublishedAt: null,
      publishedById: null,
      versionLabel: '1',
      pictureUrl: null,
      reviewFrequencyMonths: 6,
      currentVersionId: versionId,
      updatedById: null,
      updatedAt: new Date(),
      deletedAt: null,
    });
    this.versions.push({ id: versionId, formId, schemaJson: null });
    sections.forEach((s, si) => {
      const section = this.insertSection({
        formVersionId: versionId,
        title: s.title,
        sortOrder: si,
      });
      s.fields.forEach((f, fi) =>
        this.insertField({
          fieldType: CarePathwayFormFieldType.TEXT,
          sortOrder: fi,
          ...f,
          sectionId: section.id,
        }),
      );
    });
    this.writes = [];
    return { formId, versionId };
  }
}

export function createFormBuilderHarness() {
  const db = new FormBuilderPrismaFake();
  const audit = { logAudit: jest.fn().mockResolvedValue(undefined) };
  const service = new FormBuilderService(
    db.client as unknown as PrismaService,
    audit as unknown as AuditLogsService,
  );
  return { db, audit, service };
}
