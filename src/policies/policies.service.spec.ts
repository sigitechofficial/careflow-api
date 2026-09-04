import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PolicyAudienceTargetType,
  PolicyDocumentSource,
  PolicyDocumentType,
  PolicyLinkModuleType,
  PolicyLinkScope,
  PolicyStatus,
} from '@prisma/client';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PoliciesService } from './policies.service';
import { resolveSafePolicyPath } from './policy-upload.util';

type Json = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function matchScalar(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    const exp = expected as Json;
    if ('in' in exp) return (exp.in as unknown[]).includes(actual);
    if ('equals' in exp) {
      if (exp.mode === 'insensitive') {
        return String(actual ?? '').toLowerCase() === String(exp.equals).toLowerCase();
      }
      return actual === exp.equals;
    }
    if ('contains' in exp) {
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(exp.contains).toLowerCase());
    }
    if ('gte' in exp || 'lte' in exp) {
      const value = actual instanceof Date ? actual : actual == null ? null : new Date(String(actual));
      if (!value) return false;
      if (exp.gte && value < new Date(String(exp.gte))) return false;
      if (exp.lte && value > new Date(String(exp.lte))) return false;
      return true;
    }
  }
  return actual === expected;
}

function matchWhere(row: Json, where: Json | undefined, ctx: Store): boolean {
  if (!where) return true;
  if (where.AND) {
    const parts = Array.isArray(where.AND) ? where.AND : [where.AND];
    if (!parts.every((part) => matchWhere(row, part as Json, ctx))) return false;
  }
  if (where.OR) {
    const parts = where.OR as Json[];
    if (!parts.some((part) => matchWhere(row, part, ctx))) return false;
  }
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR') continue;
    if (key === 'versions') {
      const related = ctx.versions.filter((v) => v.documentId === row.id);
      const some = (value as Json)?.some as Json | undefined;
      if (some && !related.some((ver) => matchWhere(ver as unknown as Json, some, ctx))) return false;
      continue;
    }
    if (!matchScalar(row[key], value)) return false;
  }
  return true;
}

function applyOrder<T extends Json>(rows: T[], orderBy?: Json | Json[]): T[] {
  if (!orderBy) return rows;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const [key, dir] = Object.entries(order)[0] ?? [];
      if (!key) continue;
      if (a[key] < b[key]) return dir === 'desc' ? 1 : -1;
      if (a[key] > b[key]) return dir === 'desc' ? -1 : 1;
    }
    return 0;
  });
}

type Store = {
  categories: Json[];
  documents: Json[];
  versions: Json[];
  approvals: Json[];
  applicability: Json[];
  audiences: Json[];
  links: Json[];
  tags: Json[];
  tagLinks: Json[];
  locations: Json[];
  roles: Json[];
  jobTitles: Json[];
  workAreas: Json[];
  companyProfiles: Json[];
  careTypes: Json[];
  carePathwayForms: Json[];
  carePlanInstances: Json[];
  incidents: Json[];
  medications: Json[];
  employees: Json[];
  visitPlans: Json[];
  learningCourses: Json[];
  initialAssessments: Json[];
  initialAssessmentSubmissions: Json[];
  personalDetails: Json[];
};

function emptyStore(): Store {
  return {
    categories: [
      {
        id: 'cat-1',
        name: 'Safeguarding',
        code: 'SAFEGUARDING',
        description: null,
        displayOrder: 1,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    documents: [],
    versions: [],
    approvals: [],
    applicability: [],
    audiences: [],
    links: [],
    tags: [],
    tagLinks: [],
    locations: [
      { id: 'loc-london', name: 'London', deletedAt: null, isActive: true },
      { id: 'loc-birmingham', name: 'Birmingham', deletedAt: null, isActive: true },
    ],
    roles: [
      { id: 'role-carer', name: 'Carer/Domestic', deletedAt: null },
      { id: 'role-senior', name: 'Senior Carer/Nurse', deletedAt: null },
      { id: 'role-nurse', name: 'Nurse', deletedAt: null },
      { id: 'role-admin', name: 'Admin', deletedAt: null },
    ],
    jobTitles: [{ id: 'jt-carer', name: 'Care Worker', deletedAt: null }],
    workAreas: [{ id: 'wa-dom', name: 'Domiciliary', deletedAt: null }],
    companyProfiles: [
      { id: 'company-1', careServiceTypes: ['DOMICILIARY', 'RESIDENTIAL', 'SUPPORTED_LIVING'] },
    ],
    careTypes: [
      { id: 'ct-1', code: 'DOMICILIARY', isActive: true },
      { id: 'ct-2', code: 'RESIDENTIAL', isActive: true },
      { id: 'ct-3', code: 'SUPPORTED_LIVING', isActive: true },
      { id: 'ct-4', code: 'NURSING', isActive: true },
    ],
    carePathwayForms: [
      { id: 'form-diabetes', name: 'Diabetes Care Plan' },
      { id: 'form-falls', name: 'Falls Care Plan' },
    ],
    carePlanInstances: [
      { id: 'cp-margaret', carePathwayFormId: 'form-diabetes' },
      { id: 'cp-other', carePathwayFormId: 'form-falls' },
      { id: 'cp-falls-b', carePathwayFormId: 'form-falls' },
    ],
    incidents: [],
    medications: [],
    employees: [],
    visitPlans: [],
    learningCourses: [],
    initialAssessments: [],
    initialAssessmentSubmissions: [],
    personalDetails: [],
  };
}

function createPrismaMock(store: Store) {
  let seq = 1;
  const id = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;
  const now = () => new Date();

  const withCategory = (doc: Json) => ({
    ...clone(doc),
    primaryCategory: store.categories.find((c) => c.id === doc.primaryCategoryId) ?? null,
    tagLinks: store.tagLinks
      .filter((link) => link.documentId === doc.id)
      .map((link) => ({ tag: store.tags.find((tag) => tag.id === link.tagId) ?? { id: link.tagId, name: '' } })),
  });

  const withVersionTargeting = (version: Json) => ({
    ...clone(version),
    applicability: store.applicability.filter((row) => row.versionId === version.id).map(clone),
    audiences: store.audiences.filter((row) => row.versionId === version.id).map(clone),
    links: store.links.filter((row) => row.versionId === version.id).map(clone),
  });

  const collection = (rows: Json[]) => ({
    findFirst: jest.fn(async ({ where }: { where?: Json } = {}) => {
      const row = rows.find((item) => matchWhere(item, where, store));
      return row ? clone(row) : null;
    }),
    findMany: jest.fn(async ({ where }: { where?: Json } = {}) =>
      rows.filter((item) => matchWhere(item, where, store)).map(clone),
    ),
  });

  const mutating = (rows: Json[], defaults: Json = {}) => ({
    ...collection(rows),
    createMany: jest.fn(async ({ data }: { data: Json[] }) => {
      for (const item of data) {
        rows.push({ id: id(), createdAt: now(), ...defaults, ...item });
      }
      return { count: data.length };
    }),
    deleteMany: jest.fn(async ({ where }: { where?: Json } = {}) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matchWhere(rows[i]!, where, store)) {
          rows.splice(i, 1);
          count += 1;
        }
      }
      return { count };
    }),
  });

  const api = {
    policyCategory: {
      findFirst: jest.fn(async ({ where }: { where?: Json } = {}) => {
        const row = store.categories.find((c) => matchWhere(c, where, store));
        return row ? clone(row) : null;
      }),
    },
    policyDocument: {
      findFirst: jest.fn(async ({ where, include }: { where?: Json; include?: Json } = {}) => {
        const row = store.documents.find((d) => matchWhere(d, where, store));
        if (!row) return null;
        return include ? withCategory(row) : clone(row);
      }),
      findMany: jest.fn(
        async ({
          where,
          include,
          orderBy,
          skip = 0,
          take,
        }: {
          where?: Json;
          include?: Json;
          orderBy?: Json;
          skip?: number;
          take?: number;
        } = {}) => {
          let rows = applyOrder(
            store.documents.filter((d) => matchWhere(d, where, store)),
            orderBy,
          );
          if (skip) rows = rows.slice(skip);
          if (take != null) rows = rows.slice(0, take);
          return rows.map((row) => (include ? withCategory(row) : clone(row)));
        },
      ),
      count: jest.fn(async ({ where }: { where?: Json } = {}) =>
        store.documents.filter((d) => matchWhere(d, where, store)).length,
      ),
      create: jest.fn(async ({ data, include }: { data: Json; include?: Json }) => {
        const row = {
          id: id(),
          description: null,
          parentDocumentId: null,
          currentVersionId: null,
          status: PolicyStatus.DRAFT,
          isCatalogue: false,
          isActive: true,
          ownerId: null,
          reviewerId: null,
          approverId: null,
          deletedAt: null,
          createdById: null,
          updatedById: null,
          createdAt: now(),
          updatedAt: now(),
          source: PolicyDocumentSource.EDITOR,
          ...data,
        };
        store.documents.push(row);
        return include ? withCategory(row) : clone(row);
      }),
      update: jest.fn(async ({ where, data, include }: { where: Json; data: Json; include?: Json }) => {
        const row = store.documents.find((d) => matchWhere(d, where, store));
        if (!row) throw new Error('document not found');
        Object.assign(row, data, { updatedAt: now() });
        return include ? withCategory(row) : clone(row);
      }),
      delete: jest.fn(async ({ where }: { where: Json }) => {
        const index = store.documents.findIndex((d) => matchWhere(d, where, store));
        if (index < 0) throw new Error('document not found');
        const row = store.documents[index]!;
        const versionIds = store.versions
          .filter((version) => version.documentId === row.id)
          .map((version) => version.id);
        const cascade = (rows: Json[], key: string, ids: unknown[]) => {
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (ids.includes(rows[i]![key])) rows.splice(i, 1);
          }
        };
        cascade(store.approvals, 'versionId', versionIds);
        cascade(store.applicability, 'versionId', versionIds);
        cascade(store.audiences, 'versionId', versionIds);
        cascade(store.links, 'versionId', versionIds);
        cascade(store.tagLinks, 'documentId', [row.id]);
        cascade(store.versions, 'documentId', [row.id]);
        store.documents.splice(index, 1);
        return clone(row);
      }),
    },
    policyVersion: {
      findFirst: jest.fn(async ({ where, orderBy, include }: { where?: Json; orderBy?: Json | Json[]; include?: Json } = {}) => {
        const rows = applyOrder(
          store.versions.filter((v) => matchWhere(v, where, store)),
          orderBy,
        );
        const row = rows[0];
        if (!row) return null;
        return include ? withVersionTargeting(row) : clone(row);
      }),
      findFirstOrThrow: jest.fn(async ({ where, include }: { where?: Json; include?: Json } = {}) => {
        const row = store.versions.find((v) => matchWhere(v, where, store));
        if (!row) throw new Error('version not found');
        return include ? withVersionTargeting(row) : clone(row);
      }),
      findMany: jest.fn(async ({ where, orderBy, include }: { where?: Json; orderBy?: Json | Json[]; include?: Json } = {}) => {
        return applyOrder(
          store.versions.filter((v) => matchWhere(v, where, store)),
          orderBy,
        ).map((row) => (include ? withVersionTargeting(row) : clone(row)));
      }),
      count: jest.fn(async ({ where }: { where?: Json } = {}) =>
        store.versions.filter((v) => matchWhere(v, where, store)).length,
      ),
      create: jest.fn(async ({ data }: { data: Json }) => {
        const row = {
          id: id(),
          status: PolicyStatus.DRAFT,
          contentJson: null,
          contentHtml: null,
          changeSummary: null,
          fileName: null,
          mimeType: null,
          fileSize: null,
          storagePath: null,
          effectiveDate: null,
          reviewDate: null,
          publishedAt: null,
          publishedById: null,
          archivedAt: null,
          createdAt: now(),
          updatedAt: now(),
          ...data,
        };
        store.versions.push(row);
        return clone(row);
      }),
      update: jest.fn(async ({ where, data }: { where: Json; data: Json }) => {
        const row = store.versions.find((v) => matchWhere(v, where, store));
        if (!row) throw new Error('version not found');
        Object.assign(row, data, { updatedAt: now() });
        return clone(row);
      }),
      updateMany: jest.fn(async ({ where, data }: { where?: Json; data: Json }) => {
        let count = 0;
        for (const row of store.versions) {
          if (matchWhere(row, where, store)) {
            Object.assign(row, data, { updatedAt: now() });
            count += 1;
          }
        }
        return { count };
      }),
    },
    policyApproval: {
      create: jest.fn(async ({ data }: { data: Json }) => {
        const row = { id: id(), createdAt: now(), decidedAt: now(), ...data };
        store.approvals.push(row);
        return clone(row);
      }),
    },
    policyApplicability: mutating(store.applicability),
    policyAudience: mutating(store.audiences),
    policyLink: mutating(store.links),
    policyTag: collection(store.tags),
    policyTagLink: mutating(store.tagLinks),
    location: collection(store.locations),
    role: collection(store.roles),
    jobTitle: collection(store.jobTitles),
    workArea: collection(store.workAreas),
    companyProfile: collection(store.companyProfiles),
    serviceUserCareType: collection(store.careTypes),
    carePathwayForm: collection(store.carePathwayForms),
    serviceUserCarePlanInstance: collection(store.carePlanInstances),
    incident: collection(store.incidents),
    serviceUserMedication: collection(store.medications),
    employee: collection(store.employees),
    serviceUserVisitPlan: collection(store.visitPlans),
    learningCourse: collection(store.learningCourses),
    serviceUserInitialAssessment: collection(store.initialAssessments),
    initialAssessmentSubmission: collection(store.initialAssessmentSubmissions),
    employeePersonalDetail: collection(store.personalDetails),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(api)),
  };

  return api as unknown as PrismaService;
}

const admin: RequestUser = {
  id: 'user-admin',
  email: 'admin@test',
  roles: ['Admin'],
  permissions: [
    'policies.read',
    'policies.create',
    'policies.update',
    'policies.submit',
    'policies.review',
    'policies.approve',
    'policies.publish',
    'policies.archive',
  ],
  accountKind: 'user',
  assignedLocationIds: null,
};

const branchUser: RequestUser = {
  ...admin,
  id: 'user-branch',
  email: 'branch@test',
  assignedLocationIds: ['loc-london'],
};

function createService(store?: Store) {
  const data: Store = store ?? emptyStore();
  const audit = { logAudit: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogsService;
  const prisma = createPrismaMock(data);
  return {
    service: new PoliciesService(prisma, audit),
    prisma,
    audit,
    store: data,
  };
}

const createDto = {
  title: 'Safeguarding Adults',
  reference: 'POL-SAF-001',
  documentType: PolicyDocumentType.POLICY,
  primaryCategoryId: 'cat-1',
  description: 'Adult safeguarding policy',
  contentJson: { type: 'doc', content: [] },
  contentHtml: 'Safeguarding adults policy body',
  effectiveDate: '2026-09-03',
  reviewDate: '2027-09-03',
};

async function createDraft(service: PoliciesService, dto = createDto) {
  return service.create(admin, dto);
}

async function approveFirstVersion(service: PoliciesService, id: string) {
  await service.submitForReview(admin, id, {});
  return service.approve(admin, id, {});
}

async function publishFirstVersion(service: PoliciesService, id: string) {
  await approveFirstVersion(service, id);
  return service.publish(admin, id, { changeSummary: 'Initial publication' });
}

describe('PoliciesService', () => {
  describe('CRUD', () => {
    it('creates a document and initial 1.0 DRAFT version', async () => {
      const { service, audit } = createService();
      const created = await createDraft(service);

      expect(created.reference).toBe('POL-SAF-001');
      expect(created.status).toBe(PolicyStatus.DRAFT);
      expect(created.currentVersionId).toBe(created.currentVersion?.id);
      expect(created.currentVersion?.versionMajor).toBe(1);
      expect(created.currentVersion?.versionMinor).toBe(0);
      expect(created.currentVersion?.status).toBe(PolicyStatus.DRAFT);
      expect(created.currentVersion?.contentJson).toEqual({ type: 'doc', content: [] });
      expect(audit.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'policy_created', module: 'POLICY' }),
      );
    });

    it('reads a created policy', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      const fetched = await service.getById(admin, created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.title).toBe('Safeguarding Adults');
    });

    it('lists with pagination, search, status, category and owner filters', async () => {
      const { service } = createService();
      await createDraft(service);
      await createDraft(service, { ...createDto, reference: 'POL-SAF-002', title: 'Children safeguarding' });

      const listed = await service.list(admin, {
        search: 'Children',
        status: PolicyStatus.DRAFT,
        categoryId: 'cat-1',
        documentType: PolicyDocumentType.POLICY,
        ownerId: admin.id,
        page: 1,
        limit: 20,
      });

      expect(listed.meta.total).toBe(1);
      expect(listed.data[0]?.reference).toBe('POL-SAF-002');
      expect(listed.meta.page).toBe(1);
      expect(listed.meta.limit).toBe(20);
    });

    it('updates a DRAFT policy', async () => {
      const { service, audit } = createService();
      const created = await createDraft(service);
      const updated = await service.update(admin, created.id, {
        title: 'Safeguarding Adults (revised)',
        contentHtml: 'Updated body',
      });
      expect(updated.title).toBe('Safeguarding Adults (revised)');
      expect(updated.currentVersion?.titleSnapshot).toBe('Safeguarding Adults (revised)');
      expect(updated.currentVersion?.contentHtml).toBe('Updated body');
      expect(audit.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'policy_draft_updated' }),
      );
    });

    it('archives without deleting the document or versions', async () => {
      const { service, store, audit } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      const archived = await service.archive(admin, created.id);

      expect(archived.status).toBe(PolicyStatus.ARCHIVED);
      expect(store.documents).toHaveLength(1);
      expect(store.documents[0]?.deletedAt).toBeNull();
      expect(store.versions).toHaveLength(1);
      expect(store.versions[0]?.status).toBe(PolicyStatus.ARCHIVED);
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy_archived' }));
    });
  });

  describe('incomplete drafts', () => {
    it('creates a draft with only title, reference, category, and document type', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        title: 'Incomplete',
        reference: 'POL-MIN-001',
        documentType: PolicyDocumentType.POLICY,
        primaryCategoryId: 'cat-1',
      });
      expect(created.status).toBe(PolicyStatus.DRAFT);
      expect(created.title).toBe('Incomplete');
      expect(created.currentVersion?.contentHtml).toBeNull();
      await expect(service.submitForReview(admin, created.id, {})).rejects.toThrow(BadRequestException);
    });

    it('creates and updates a partially completed draft without content or complete applicability', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        title: 'Safeguarding',
        reference: 'POL-PART-001',
        documentType: PolicyDocumentType.POLICY,
        primaryCategoryId: 'cat-1',
        description: 'WIP notes',
        applicability: [{ organisationWide: false }],
      });
      expect(created.description).toBe('WIP notes');
      expect(created.currentVersion?.applicability).toEqual([
        expect.objectContaining({ organisationWide: false, locationId: null, serviceTypeCode: null }),
      ]);

      const updated = await service.update(admin, created.id, {
        description: 'More notes',
        contentHtml: '<p>Started writing</p>',
        applicability: [{ organisationWide: false }],
      });
      expect(updated.description).toBe('More notes');
      expect(updated.currentVersion?.contentHtml).toBe('<p>Started writing</p>');
      expect(updated.currentVersion?.applicability[0]?.locationId).toBeNull();

      await expect(service.submitForReview(admin, created.id, {})).rejects.toThrow(BadRequestException);
    });

    it('lets a branch user save an incomplete draft without a location, then rejects submit', async () => {
      const { service } = createService();
      const created = await service.create(branchUser, {
        title: 'Branch draft',
        reference: 'POL-BR-DRAFT',
        documentType: PolicyDocumentType.POLICY,
        primaryCategoryId: 'cat-1',
        applicability: [{ organisationWide: false }],
      });
      expect(created.status).toBe(PolicyStatus.DRAFT);
      const updated = await service.update(branchUser, created.id, { description: 'Still incomplete' });
      expect(updated.description).toBe('Still incomplete');
      await expect(service.submitForReview(branchUser, created.id, {})).rejects.toThrow(BadRequestException);
    });

    it('still rejects invalid locations and duplicate references on draft save', async () => {
      const { service } = createService();
      await expect(
        service.create(admin, {
          title: 'Bad location',
          reference: 'POL-BAD-LOC-DRAFT',
          documentType: PolicyDocumentType.POLICY,
          primaryCategoryId: 'cat-1',
          applicability: [{ organisationWide: false, locationId: '00000000-0000-4000-8000-000000000099' }],
        }),
      ).rejects.toThrow(BadRequestException);
      await service.create(admin, {
        title: 'First',
        reference: 'POL-DUP-001',
        documentType: PolicyDocumentType.POLICY,
        primaryCategoryId: 'cat-1',
      });
      await expect(
        service.create(admin, {
          title: 'Second',
          reference: 'POL-DUP-001',
          documentType: PolicyDocumentType.POLICY,
          primaryCategoryId: 'cat-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('editing rules', () => {
    it('rejects edits after submit', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await service.submitForReview(admin, created.id, {});
      await expect(service.update(admin, created.id, { title: 'Nope' })).rejects.toThrow(BadRequestException);
    });

    it('rejects edits of published versions', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      await expect(service.update(admin, created.id, { title: 'Nope' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('workflow', () => {
    it('walks DRAFT → IN_REVIEW → APPROVED → PUBLISHED', async () => {
      const { service, audit } = createService();
      const created = await createDraft(service);

      const submitted = await service.submitForReview(admin, created.id, { comments: 'Please review' });
      expect(submitted.status).toBe(PolicyStatus.IN_REVIEW);
      expect(submitted.currentVersion?.status).toBe(PolicyStatus.IN_REVIEW);

      const approved = await service.approve(admin, created.id, {});
      expect(approved.status).toBe(PolicyStatus.APPROVED);

      const published = await service.publish(admin, created.id, {});
      expect(published.status).toBe(PolicyStatus.PUBLISHED);
      expect(published.currentVersion?.status).toBe(PolicyStatus.PUBLISHED);
      expect(published.currentVersionId).toBe(published.currentVersion?.id);

      expect(audit.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'policy_submitted_for_review' }),
      );
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy_approved' }));
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy_published' }));
    });

    it('returns IN_REVIEW to DRAFT when changes are requested', async () => {
      const { service, store, audit } = createService();
      const created = await createDraft(service);
      await service.submitForReview(admin, created.id, {});
      const returned = await service.requestChanges(admin, created.id, { comments: 'Fix intro' });
      expect(returned.status).toBe(PolicyStatus.DRAFT);
      expect(returned.currentVersion?.status).toBe(PolicyStatus.DRAFT);
      expect(store.approvals).toHaveLength(1);
      expect(audit.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'policy_changes_requested' }),
      );
    });

    it('rejects DRAFT → PUBLISHED', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await expect(service.publish(admin, created.id, {})).rejects.toThrow(BadRequestException);
    });

    it('rejects IN_REVIEW → PUBLISHED', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await service.submitForReview(admin, created.id, {});
      await expect(service.publish(admin, created.id, {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('versioning', () => {
    it('creates a minor version 1.1 as DRAFT without moving currentVersionId', async () => {
      const { service, audit } = createService();
      const created = await createDraft(service);
      const published = await publishFirstVersion(service, created.id);
      const v11 = await service.createVersion(admin, created.id, { bump: 'minor' });

      expect(v11.versionMajor).toBe(1);
      expect(v11.versionMinor).toBe(1);
      expect(v11.status).toBe(PolicyStatus.DRAFT);

      const fetched = await service.getById(admin, created.id);
      expect(fetched.currentVersionId).toBe(published.currentVersionId);
      expect(fetched.status).toBe(PolicyStatus.PUBLISHED);
      expect(audit.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'policy_version_created' }),
      );
    });

    it('creates a major version 2.0 from 1.2', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);

      const v11 = await service.createVersion(admin, created.id, { bump: 'minor' });
      await service.submitForReview(admin, created.id, {});
      await service.approve(admin, created.id, {});
      await service.publish(admin, created.id, {});

      const v12 = await service.createVersion(admin, created.id, { bump: 'minor' });
      expect(v12.versionLabel).toBe('v1.2');
      await service.submitForReview(admin, created.id, {});
      await service.approve(admin, created.id, {});
      await service.publish(admin, created.id, {});

      const v20 = await service.createVersion(admin, created.id, { bump: 'major' });
      expect(v20.versionMajor).toBe(2);
      expect(v20.versionMinor).toBe(0);
      expect(v11.versionMinor).toBe(1);
    });

    it('keeps the previous published version immutable after a new draft exists', async () => {
      const { service, store } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      const publishedId = created.currentVersionId;
      await service.createVersion(admin, created.id, { bump: 'minor' });

      const published = store.versions.find((v) => v.status === PolicyStatus.PUBLISHED);
      expect(published?.id).toBeTruthy();
      expect(publishedId).toBeTruthy();

      await service.update(admin, created.id, { title: 'New draft title' });
      const original = store.versions.find((v) => v.status === PolicyStatus.PUBLISHED);
      expect(original?.titleSnapshot).toBe('Safeguarding Adults');
    });

    it('supersedes the previous published version and updates currentVersionId', async () => {
      const { service, store } = createService();
      const created = await createDraft(service);
      const first = await publishFirstVersion(service, created.id);
      await service.createVersion(admin, created.id, { bump: 'minor' });
      await service.submitForReview(admin, created.id, {});
      await service.approve(admin, created.id, {});
      const second = await service.publish(admin, created.id, {});

      const published = store.versions.filter((v) => v.status === PolicyStatus.PUBLISHED);
      const superseded = store.versions.filter((v) => v.status === PolicyStatus.SUPERSEDED);
      expect(published).toHaveLength(1);
      expect(published[0]?.id).toBe(second.currentVersionId);
      expect(superseded).toHaveLength(1);
      expect(superseded[0]?.id).toBe(first.currentVersionId);
      expect(second.currentVersionId).not.toBe(first.currentVersionId);
    });

    it('rejects a second in-progress version', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      await service.createVersion(admin, created.id, {});
      await expect(service.createVersion(admin, created.id, { bump: 'major' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('organisation / branch isolation', () => {
    it('hides another users draft from a location-scoped user', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await expect(service.getById(branchUser, created.id)).rejects.toThrow(NotFoundException);
    });

    it('lets a location-scoped user read published policies', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      const fetched = await service.getById(branchUser, created.id);
      expect(fetched.status).toBe(PolicyStatus.PUBLISHED);
    });

    it('blocks a location-scoped user from mutating another users policy', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      await expect(service.archive(branchUser, created.id)).rejects.toThrow(ForbiddenException);
    });

    it('lets a location-scoped owner update their own draft', async () => {
      const { service } = createService();
      const created = await service.create(branchUser, {
        ...createDto,
        reference: 'POL-BR-001',
        applicability: [{ organisationWide: false, locationId: 'loc-london' }],
      });
      const updated = await service.update(branchUser, created.id, { title: 'Branch draft' });
      expect(updated.title).toBe('Branch draft');
    });
  });

  describe('draft deletion', () => {
    it('deletes a never-published draft', async () => {
      const { service, store } = createService();
      const created = await createDraft(service);
      const result = await service.deleteDraftDocument(admin, created.id);
      expect(result).toEqual({ id: created.id, deleted: true });
      expect(store.documents.find((row) => row.id === created.id)).toBeUndefined();
      await expect(service.getById(admin, created.id)).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['IN_REVIEW', async (service: PoliciesService, id: string) => service.submitForReview(admin, id, {})],
      [
        'APPROVED',
        async (service: PoliciesService, id: string) => {
          await service.submitForReview(admin, id, {});
          await service.approve(admin, id, {});
        },
      ],
      ['PUBLISHED', async (service: PoliciesService, id: string) => publishFirstVersion(service, id)],
      [
        'ARCHIVED',
        async (service: PoliciesService, id: string) => {
          await publishFirstVersion(service, id);
          await service.archive(admin, id);
        },
      ],
    ] as const)('rejects deleting a %s policy', async (_status, prepare) => {
      const { service, store } = createService();
      const created = await createDraft(service);
      await prepare(service, created.id);
      await expect(service.deleteDraftDocument(admin, created.id)).rejects.toThrow(BadRequestException);
      expect(store.documents.find((row) => row.id === created.id)).toBeTruthy();
    });

    it('rejects deleting a superseded policy document', async () => {
      const { service, store } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      const next = await service.createVersion(admin, created.id, { bump: 'minor' });
      await service.submitForReview(admin, created.id, {});
      await service.approve(admin, created.id, {});
      await service.publish(admin, created.id, { changeSummary: 'Second publication' });
      expect(store.versions.some((row) => row.status === PolicyStatus.SUPERSEDED)).toBe(true);
      await expect(service.deleteDraftDocument(admin, created.id)).rejects.toThrow(BadRequestException);
      expect(store.documents.find((row) => row.id === created.id)).toBeTruthy();
      expect(next.id).toBeTruthy();
    });

    it('does not delete a document that has a published version and a later draft', async () => {
      const { service, store } = createService();
      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      await service.createVersion(admin, created.id, { bump: 'minor' });
      await expect(service.deleteDraftDocument(admin, created.id)).rejects.toThrow(BadRequestException);
      expect(store.documents.find((row) => row.id === created.id)?.status).toBe(PolicyStatus.PUBLISHED);
    });

    it('hides another users draft from a branch-scoped delete', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await expect(service.deleteDraftDocument(branchUser, created.id)).rejects.toThrow(NotFoundException);
    });

    it('returns not found for a hidden policy delete', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await expect(service.getById(branchUser, created.id)).rejects.toThrow(NotFoundException);
      await expect(service.deleteDraftDocument(branchUser, created.id)).rejects.toThrow(NotFoundException);
    });

    it('lets a branch-scoped owner delete their own never-published draft', async () => {
      const { service, store } = createService();
      const created = await service.create(branchUser, {
        ...createDto,
        reference: 'POL-BR-DEL',
        applicability: [{ organisationWide: false, locationId: 'loc-london' }],
      });
      await service.deleteDraftDocument(branchUser, created.id);
      expect(store.documents.find((row) => row.id === created.id)).toBeUndefined();
    });

    it('removes draft child records and leaves category and tag catalogues intact', async () => {
      const { service, store } = createService();
      store.tags.push({
        id: 'tag-1',
        name: 'Safeguarding',
        deletedAt: null,
        isActive: true,
      });
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-DEL-CHILD',
        tagIds: ['tag-1'],
        audiences: [{ targetType: PolicyAudienceTargetType.ROLE, roleId: 'role-carer' }],
      });
      const versionId = created.currentVersionId;
      expect(store.versions.some((row) => row.documentId === created.id)).toBe(true);
      expect(store.applicability.some((row) => row.versionId === versionId)).toBe(true);
      expect(store.audiences.some((row) => row.versionId === versionId)).toBe(true);
      expect(store.tagLinks.some((row) => row.documentId === created.id)).toBe(true);

      await service.deleteDraftDocument(admin, created.id);

      expect(store.versions.filter((row) => row.documentId === created.id)).toHaveLength(0);
      expect(store.applicability.filter((row) => row.versionId === versionId)).toHaveLength(0);
      expect(store.audiences.filter((row) => row.versionId === versionId)).toHaveLength(0);
      expect(store.links.filter((row) => row.versionId === versionId)).toHaveLength(0);
      expect(store.approvals.filter((row) => row.versionId === versionId)).toHaveLength(0);
      expect(store.tagLinks.filter((row) => row.documentId === created.id)).toHaveLength(0);
      expect(store.categories.find((row) => row.id === 'cat-1')).toBeTruthy();
      expect(store.tags.find((row) => row.id === 'tag-1')).toBeTruthy();
    });

    it('records policy_deleted without body, binary, or filesystem path', async () => {
      const { service, audit } = createService();
      const created = await createDraft(service);
      await service.deleteDraftDocument(admin, created.id);
      const call = (audit.logAudit as jest.Mock).mock.calls.find(
        (row) => row[0].action === 'policy_deleted',
      );
      expect(call).toBeTruthy();
      expect(call[0].recordId).toBe(created.id);
      expect(call[0].newValues).toEqual(
        expect.objectContaining({
          policyId: created.id,
          reference: created.reference,
          title: created.title,
          version: 'v1.0',
          actor: { id: admin.id },
        }),
      );
      const payload = JSON.stringify(call[0]);
      expect(payload).not.toContain('contentJson');
      expect(payload).not.toContain('contentHtml');
      expect(payload).not.toContain('Safeguarding adults policy body');
      expect(payload).not.toContain('storagePath');
      expect(payload).not.toContain(process.cwd());
    });
  });

  describe('audit', () => {
    it('records the lifecycle without logging document body content', async () => {
      const { service, audit } = createService();
      const created = await createDraft(service);
      await service.update(admin, created.id, { title: 'Revised' });
      await publishFirstVersion(service, created.id);
      await service.createVersion(admin, created.id, { bump: 'minor' });
      await service.archive(admin, created.id);

      const actions = (audit.logAudit as jest.Mock).mock.calls.map((call) => call[0].action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'policy_created',
          'policy_draft_updated',
          'policy_submitted_for_review',
          'policy_approved',
          'policy_published',
          'policy_version_created',
          'policy_archived',
        ]),
      );
      for (const call of (audit.logAudit as jest.Mock).mock.calls) {
        expect(JSON.stringify(call[0])).not.toContain('Updated body');
        expect(JSON.stringify(call[0].newValues ?? {})).not.toContain('contentJson');
      }
    });
  });

  describe('Phase 3 targeting', () => {
    it('defaults new policies to organisation-wide applicability', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      expect(created.currentVersion?.applicability).toEqual([
        expect.objectContaining({ organisationWide: true, locationId: null, serviceTypeCode: null }),
      ]);
    });

    it('rejects invalid, unsupported, and unconfigured service types', async () => {
      const { service } = createService();
      await expect(
        service.create(admin, {
          ...createDto,
          reference: 'POL-BAD-1',
          applicability: [{ organisationWide: false, serviceTypeCode: 'NOT_A_TYPE' }],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(admin, {
          ...createDto,
          reference: 'POL-BAD-2',
          applicability: [{ organisationWide: false, serviceTypeCode: 'CARE_HOME' }],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(admin, {
          ...createDto,
          reference: 'POL-BAD-3',
          applicability: [{ organisationWide: false, serviceTypeCode: 'NURSING' }],
        }),
      ).rejects.toThrow(BadRequestException);

      const emptyOrg = emptyStore();
      emptyOrg.companyProfiles = [{ id: 'company-1', careServiceTypes: [] }];
      const { service: unconfigured } = createService(emptyOrg);
      await expect(
        unconfigured.create(admin, {
          ...createDto,
          applicability: [{ organisationWide: false, serviceTypeCode: 'DOMICILIARY' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown location', async () => {
      const { service } = createService();
      await expect(
        service.create(admin, {
          ...createDto,
          reference: 'POL-BAD-LOC',
          applicability: [{ organisationWide: false, locationId: '00000000-0000-4000-8000-000000000099' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents a branch user targeting another branch or going organisation-wide', async () => {
      const { service } = createService();
      await expect(
        service.create(branchUser, {
          ...createDto,
          reference: 'POL-BR-ORG',
          applicability: [{ organisationWide: true }],
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.create(branchUser, {
          ...createDto,
          reference: 'POL-BR-BHAM',
          applicability: [{ organisationWide: false, locationId: 'loc-birmingham' }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('hides a London-only published policy from Birmingham staff', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-FIRE-LON',
        applicability: [{ organisationWide: false, locationId: 'loc-london' }],
      });
      await publishFirstVersion(service, created.id);

      const birmingham: RequestUser = { ...branchUser, id: 'user-bham', assignedLocationIds: ['loc-birmingham'] };
      await expect(service.getById(birmingham, created.id)).rejects.toThrow(NotFoundException);
      const listed = await service.list(birmingham, { page: 1, limit: 20 });
      expect(listed.data.find((row) => row.id === created.id)).toBeUndefined();
      await expect(service.getById(branchUser, created.id)).resolves.toMatchObject({ id: created.id });
    });

    it('hides service-type policies that do not match discovery context', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-DOM-MED',
        applicability: [{ organisationWide: false, serviceTypeCode: 'DOMICILIARY' }],
        audiences: [{ targetType: PolicyAudienceTargetType.ROLE, roleId: 'role-carer' }],
      });
      await publishFirstVersion(service, created.id);

      const carer: RequestUser = {
        ...admin,
        id: 'user-carer',
        roles: ['Carer/Domestic'],
        assignedLocationIds: ['loc-london'],
      };
      const hidden = await service.listApplicable(carer, {
        locationId: 'loc-london',
        serviceTypeCode: 'RESIDENTIAL',
        page: 1,
        limit: 20,
      });
      expect(hidden.data).toHaveLength(0);

      const shown = await service.listApplicable(carer, {
        locationId: 'loc-london',
        serviceTypeCode: 'DOMICILIARY',
        page: 1,
        limit: 20,
      });
      expect(shown.data).toHaveLength(1);
    });

    it('hides policies when the audience role does not match', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-NURSE',
        audiences: [{ targetType: PolicyAudienceTargetType.ROLE, roleId: 'role-nurse' }],
      });
      await publishFirstVersion(service, created.id);
      const carer: RequestUser = {
        ...admin,
        id: 'user-carer',
        roles: ['Carer/Domestic'],
        assignedLocationIds: ['loc-london'],
      };
      await expect(service.getById(carer, created.id)).rejects.toThrow(NotFoundException);
    });

    it('stores module, whole care-plan, and individual care-plan links', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-DIAB',
        links: [
          { moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE },
          {
            moduleType: PolicyLinkModuleType.CARE_PLAN,
            scope: PolicyLinkScope.FORM_TEMPLATE,
            recordId: 'form-diabetes',
          },
          {
            moduleType: PolicyLinkModuleType.CARE_PLAN,
            scope: PolicyLinkScope.RECORD,
            recordId: 'cp-margaret',
          },
        ],
      });
      expect(created.currentVersion?.links).toHaveLength(3);
      const before = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'form-diabetes',
        page: 1,
        limit: 20,
      });
      expect(before.data).toHaveLength(0);
      await publishFirstVersion(service, created.id);
      const afterPublish = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'form-diabetes',
        page: 1,
        limit: 20,
      });
      expect(afterPublish.data[0]?.id).toBe(created.id);
    });

    it('rejects duplicate CareFlow links', async () => {
      const { service } = createService();
      await expect(
        service.create(admin, {
          ...createDto,
          reference: 'POL-DUP',
          links: [
            { moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE },
            { moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects unsupported module/scope combinations', async () => {
      const { service } = createService();
      await expect(
        service.create(admin, {
          ...createDto,
          reference: 'POL-BAD-SCOPE',
          links: [
            {
              moduleType: PolicyLinkModuleType.INCIDENT,
              scope: PolicyLinkScope.FORM_TEMPLATE,
              recordId: 'form-diabetes',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('expands CARE_PLAN FORM_TEMPLATE links to instances of that form only', async () => {
      const { service } = createService();
      const formPolicy = await service.create(admin, {
        ...createDto,
        reference: 'POL-FORM-DIAB',
        links: [
          {
            moduleType: PolicyLinkModuleType.CARE_PLAN,
            scope: PolicyLinkScope.FORM_TEMPLATE,
            recordId: 'form-diabetes',
          },
        ],
      });
      await publishFirstVersion(service, formPolicy.id);

      const matched = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-margaret',
        page: 1,
        limit: 20,
      });
      expect(matched.data.map((row) => row.id)).toEqual([formPolicy.id]);

      const otherForm = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-other',
        page: 1,
        limit: 20,
      });
      expect(otherForm.data).toHaveLength(0);

      const moduleOnly = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        page: 1,
        limit: 20,
      });
      expect(moduleOnly.data).toHaveLength(0);

      const unknownRecord = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: '00000000-0000-4000-8000-000000000099',
        page: 1,
        limit: 20,
      });
      expect(unknownRecord.data).toHaveLength(0);
    });

    it('shows a published Falls form-template policy on every Falls instance and not on other forms', async () => {
      const { service } = createService();
      const falls = await service.create(admin, {
        ...createDto,
        title: 'Falls Prevention & Management Policy',
        reference: 'POL-CLIN-001',
        links: [
          {
            moduleType: PolicyLinkModuleType.CARE_PLAN,
            scope: PolicyLinkScope.FORM_TEMPLATE,
            recordId: 'form-falls',
            label: 'Falls',
          },
        ],
      });
      await publishFirstVersion(service, falls.id);

      const userA = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-other',
        page: 1,
        limit: 20,
      });
      const userB = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-falls-b',
        page: 1,
        limit: 20,
      });
      const otherForm = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-margaret',
        page: 1,
        limit: 20,
      });
      expect(userA.data.map((row) => row.id)).toEqual([falls.id]);
      expect(userB.data.map((row) => row.id)).toEqual([falls.id]);
      expect(otherForm.data).toHaveLength(0);
    });

    it('shows a published RECORD policy only for that Care Plan instance', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-FALLS-RECORD',
        links: [
          {
            moduleType: PolicyLinkModuleType.CARE_PLAN,
            scope: PolicyLinkScope.RECORD,
            recordId: 'cp-other',
          },
        ],
      });
      await publishFirstVersion(service, created.id);

      const matched = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-other',
        page: 1,
        limit: 20,
      });
      const sameFormOtherUser = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-falls-b',
        page: 1,
        limit: 20,
      });
      expect(matched.data.map((row) => row.id)).toEqual([created.id]);
      expect(sameFormOtherUser.data).toHaveLength(0);
    });

    it('hides draft and approved Falls policies from contextual guidance until published', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        title: 'Falls Prevention & Management Policy',
        reference: 'POL-CLIN-DRAFT',
        links: [
          {
            moduleType: PolicyLinkModuleType.CARE_PLAN,
            scope: PolicyLinkScope.FORM_TEMPLATE,
            recordId: 'form-falls',
          },
        ],
      });

      const asDraft = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-other',
        page: 1,
        limit: 20,
      });
      expect(asDraft.data).toHaveLength(0);

      await approveFirstVersion(service, created.id);
      const asApproved = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-other',
        page: 1,
        limit: 20,
      });
      expect(asApproved.data).toHaveLength(0);

      await service.publish(admin, created.id, { changeSummary: 'Publish Falls policy' });
      const asPublished = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-other',
        page: 1,
        limit: 20,
      });
      expect(asPublished.data.map((row) => row.id)).toEqual([created.id]);
    });

    it('returns one card when several links on the same published policy match', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-MULTI',
        links: [
          { moduleType: PolicyLinkModuleType.CARE_PLAN, scope: PolicyLinkScope.MODULE },
          {
            moduleType: PolicyLinkModuleType.CARE_PLAN,
            scope: PolicyLinkScope.FORM_TEMPLATE,
            recordId: 'form-diabetes',
          },
        ],
      });
      await publishFirstVersion(service, created.id);
      const shown = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-margaret',
        page: 1,
        limit: 20,
      });
      expect(shown.data).toHaveLength(1);
      expect(shown.data[0]?.id).toBe(created.id);
    });

    it('surfaces MODULE links in record context and excludes other modules', async () => {
      const { service } = createService();
      const carePlan = await service.create(admin, {
        ...createDto,
        reference: 'POL-CP-MOD',
        links: [{ moduleType: PolicyLinkModuleType.CARE_PLAN, scope: PolicyLinkScope.MODULE }],
      });
      const medication = await service.create(admin, {
        ...createDto,
        reference: 'POL-MED-MOD',
        links: [{ moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE }],
      });
      await publishFirstVersion(service, carePlan.id);
      await publishFirstVersion(service, medication.id);

      const carePlanContext = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.CARE_PLAN,
        recordId: 'cp-margaret',
        page: 1,
        limit: 20,
      });
      expect(carePlanContext.data.map((row) => row.id)).toEqual([carePlan.id]);

      const medContext = await service.listApplicable(admin, {
        moduleType: PolicyLinkModuleType.MEDICATION,
        page: 1,
        limit: 20,
      });
      expect(medContext.data.map((row) => row.id)).toEqual([medication.id]);
    });

    it('lets a draft add and remove multiple links independently', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-EDIT-LINKS',
        links: [{ moduleType: PolicyLinkModuleType.CARE_PLAN, scope: PolicyLinkScope.MODULE }],
      });
      const withSecond = await service.update(admin, created.id, {
        links: [
          { moduleType: PolicyLinkModuleType.CARE_PLAN, scope: PolicyLinkScope.MODULE },
          { moduleType: PolicyLinkModuleType.INCIDENT, scope: PolicyLinkScope.MODULE },
        ],
      });
      expect(withSecond.currentVersion?.links).toHaveLength(2);
      const withOneRemoved = await service.update(admin, created.id, {
        links: [{ moduleType: PolicyLinkModuleType.INCIDENT, scope: PolicyLinkScope.MODULE }],
      });
      expect(withOneRemoved.currentVersion?.links).toHaveLength(1);
      expect(withOneRemoved.currentVersion?.links[0]?.moduleType).toBe(PolicyLinkModuleType.INCIDENT);
    });

    it('rejects invalid link targets and published link mutation', async () => {
      const { service } = createService();
      await expect(
        service.create(admin, {
          ...createDto,
          reference: 'POL-LINK-BAD',
          links: [
            {
              moduleType: PolicyLinkModuleType.CARE_PLAN,
              scope: PolicyLinkScope.RECORD,
              recordId: '00000000-0000-4000-8000-000000000099',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      const created = await createDraft(service);
      await publishFirstVersion(service, created.id);
      await expect(
        service.update(admin, created.id, {
          links: [{ moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('copies targeting onto a new version without mutating the published version', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-COPY',
        applicability: [{ organisationWide: false, locationId: 'loc-london', serviceTypeCode: 'DOMICILIARY' }],
        links: [{ moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE }],
      });
      const published = await publishFirstVersion(service, created.id);
      const draft = await service.createVersion(admin, created.id, { bump: 'minor' });
      expect(draft.applicability).toEqual([
        expect.objectContaining({
          organisationWide: false,
          locationId: 'loc-london',
          serviceTypeCode: 'DOMICILIARY',
        }),
      ]);

      await service.update(admin, created.id, {
        applicability: [{ organisationWide: true }],
        links: [],
      });
      const publishedVersion = await service.getVersion(admin, created.id, published.currentVersionId!);
      expect(publishedVersion.applicability[0]?.organisationWide).toBe(false);
      expect(publishedVersion.links).toHaveLength(1);
      const draftVersion = await service.getVersion(admin, created.id, draft.id);
      expect(draftVersion.applicability[0]?.organisationWide).toBe(true);
      expect(draftVersion.links).toHaveLength(0);
    });
  });

  describe('content management', () => {
    const previousUpload = process.env.UPLOAD_BASE_PATH;
    let uploadRoot: string;

    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj\n<<>>\nendobj\n%%EOF\n')]);
    const doc = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(32, 1),
    ]);
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32, 1)]);

    function file(name: string, mime: string, buffer: Buffer): Express.Multer.File {
      return {
        fieldname: 'file',
        originalname: name,
        encoding: '7bit',
        mimetype: mime,
        size: buffer.length,
        buffer,
        destination: '',
        filename: '',
        path: '',
        stream: undefined as never,
      };
    }

    beforeEach(() => {
      uploadRoot = join(tmpdir(), `policy-svc-${randomUUID()}`);
      mkdirSync(uploadRoot, { recursive: true });
      process.env.UPLOAD_BASE_PATH = uploadRoot;
    });

    afterEach(() => {
      rmSync(uploadRoot, { recursive: true, force: true });
      if (previousUpload === undefined) delete process.env.UPLOAD_BASE_PATH;
      else process.env.UPLOAD_BASE_PATH = previousUpload;
    });

    it('uploads PDF, DOC, and DOCX onto a draft version', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-UP-PDF',
        source: PolicyDocumentSource.UPLOAD,
      });
      const versionId = created.currentVersion!.id;
      const uploaded = await service.uploadVersionDocument(
        admin,
        created.id,
        versionId,
        file('Safeguarding.pdf', 'application/pdf', pdf),
      );
      expect(uploaded.hasDocument).toBe(true);
      expect(uploaded.fileName).toBe('Safeguarding.pdf');
      expect(uploaded.mimeType).toBe('application/pdf');
      expect(uploaded.contentKind).toBe('UPLOAD');
      expect(JSON.stringify(uploaded)).not.toContain('storagePath');

      const word = await service.create(admin, { ...createDto, reference: 'POL-UP-DOC' });
      await service.uploadVersionDocument(
        admin,
        word.id,
        word.currentVersion!.id,
        file('policy.doc', 'application/msword', doc),
      );
      const modern = await service.create(admin, { ...createDto, reference: 'POL-UP-DOCX' });
      await service.uploadVersionDocument(
        admin,
        modern.id,
        modern.currentVersion!.id,
        file('policy.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx),
      );
    });

    it('rejects unsupported extension, unsupported MIME, empty files, and files over 25MB', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      const versionId = created.currentVersion!.id;
      await expect(
        service.uploadVersionDocument(
          admin,
          created.id,
          versionId,
          file('notes.txt', 'text/plain', Buffer.from('hello')),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.uploadVersionDocument(
          admin,
          created.id,
          versionId,
          file('policy.pdf', 'application/octet-stream', pdf),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.uploadVersionDocument(admin, created.id, versionId, undefined),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.uploadVersionDocument(
          admin,
          created.id,
          versionId,
          file('policy.pdf', 'application/pdf', Buffer.alloc(0)),
        ),
      ).rejects.toThrow(BadRequestException);
      const huge = Buffer.concat([pdf, Buffer.alloc(25 * 1024 * 1024)]);
      await expect(
        service.uploadVersionDocument(
          admin,
          created.id,
          versionId,
          file('policy.pdf', 'application/pdf', huge),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('streams an authenticated download and hides files the user cannot see', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-FIRE-FILE',
        applicability: [{ organisationWide: false, locationId: 'loc-london' }],
      });
      await service.uploadVersionDocument(
        admin,
        created.id,
        created.currentVersion!.id,
        file('fire.pdf', 'application/pdf', pdf),
      );
      await publishFirstVersion(service, created.id);

      const download = await service.getVersionDocumentForDownload(
        admin,
        created.id,
        created.currentVersion!.id,
        'inline',
      );
      expect(existsSync(download.absolutePath)).toBe(true);
      expect(download.mimeType).toBe('application/pdf');
      expect(download.contentDisposition).toContain('inline');
      expect(download.fileName).toBe('fire.pdf');

      const birmingham: RequestUser = { ...branchUser, id: 'user-bham', assignedLocationIds: ['loc-birmingham'] };
      await expect(
        service.getVersionDocumentForDownload(birmingham, created.id, created.currentVersion!.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('respects audience visibility on download', async () => {
      const { service } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-NURSE-FILE',
        audiences: [{ targetType: PolicyAudienceTargetType.ROLE, roleId: 'role-nurse' }],
      });
      await service.uploadVersionDocument(
        admin,
        created.id,
        created.currentVersion!.id,
        file('nurses.pdf', 'application/pdf', pdf),
      );
      await publishFirstVersion(service, created.id);
      const carer: RequestUser = {
        ...admin,
        id: 'user-carer',
        roles: ['Carer/Domestic'],
        assignedLocationIds: ['loc-london'],
      };
      await expect(
        service.getVersionDocumentForDownload(carer, created.id, created.currentVersion!.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects uploads to published versions and lets drafts replace the file', async () => {
      const { service } = createService();
      const created = await createDraft(service);
      await service.uploadVersionDocument(
        admin,
        created.id,
        created.currentVersion!.id,
        file('v1.pdf', 'application/pdf', pdf),
      );
      await publishFirstVersion(service, created.id);
      await expect(
        service.uploadVersionDocument(
          admin,
          created.id,
          created.currentVersion!.id,
          file('blocked.pdf', 'application/pdf', pdf),
        ),
      ).rejects.toThrow(BadRequestException);

      const draft = await service.createVersion(admin, created.id, { bump: 'minor' });
      expect(draft.hasDocument).toBe(true);
      expect(draft.fileName).toBe('v1.pdf');
      const publishedPath = (
        await service.getVersionDocumentForDownload(admin, created.id, created.currentVersionId!)
      ).absolutePath;
      const replaced = await service.uploadVersionDocument(
        admin,
        created.id,
        draft.id,
        file('v1-1.pdf', 'application/pdf', pdf),
      );
      expect(replaced.fileName).toBe('v1-1.pdf');
      expect(existsSync(publishedPath)).toBe(true);
      const publishedFile = await service.getVersionDocumentForDownload(
        admin,
        created.id,
        created.currentVersionId!,
      );
      expect(publishedFile.fileName).toBe('v1.pdf');
      expect(publishedFile.absolutePath).toBe(publishedPath);
    });

    it('records upload audit metadata without binary or policy body', async () => {
      const { service, audit } = createService();
      const created = await createDraft(service);
      await service.uploadVersionDocument(
        admin,
        created.id,
        created.currentVersion!.id,
        file('audit.pdf', 'application/pdf', pdf),
      );
      const call = (audit.logAudit as jest.Mock).mock.calls.find(
        (row) => row[0].action === 'policy_document_uploaded',
      );
      expect(call).toBeTruthy();
      const payload = JSON.stringify(call[0]);
      expect(payload).toContain('audit.pdf');
      expect(payload).toContain('application/pdf');
      expect(payload).not.toContain('%PDF');
      expect(payload).not.toContain('contentJson');
      expect(payload).not.toContain('Safeguarding adults policy body');
    });

    it('cleans up an uploaded draft file when the draft is deleted', async () => {
      const { service, store } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-DEL-FILE',
        source: PolicyDocumentSource.UPLOAD,
      });
      await service.uploadVersionDocument(
        admin,
        created.id,
        created.currentVersion!.id,
        file('draft.pdf', 'application/pdf', pdf),
      );
      const storagePath = store.versions.find((row) => row.documentId === created.id)?.storagePath as string;
      const absolute = resolveSafePolicyPath(storagePath);
      expect(existsSync(absolute)).toBe(true);
      await service.deleteDraftDocument(admin, created.id);
      expect(existsSync(absolute)).toBe(false);
      expect(store.documents.find((row) => row.id === created.id)).toBeUndefined();
    });

    it('never deletes a published policy file', async () => {
      const { service, store } = createService();
      const created = await service.create(admin, {
        ...createDto,
        reference: 'POL-KEEP-FILE',
        source: PolicyDocumentSource.UPLOAD,
      });
      await service.uploadVersionDocument(
        admin,
        created.id,
        created.currentVersion!.id,
        file('live.pdf', 'application/pdf', pdf),
      );
      await publishFirstVersion(service, created.id);
      const storagePath = store.versions.find((row) => row.documentId === created.id)?.storagePath as string;
      const absolute = resolveSafePolicyPath(storagePath);
      expect(existsSync(absolute)).toBe(true);
      await expect(service.deleteDraftDocument(admin, created.id)).rejects.toThrow(BadRequestException);
      expect(existsSync(absolute)).toBe(true);
      expect(store.documents.find((row) => row.id === created.id)).toBeTruthy();
    });
  });
});
