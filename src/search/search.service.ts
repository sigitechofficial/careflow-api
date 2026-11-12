import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { ServiceUsersService } from '../service-users/service-users.service';
import { EmployeesService } from '../employees/employees.service';
import { CrmService } from '../crm/crm.service';
import { IncidentsService } from '../incidents/incidents.service';
import { SafeguardingService } from '../safeguarding/safeguarding.service';
import { FeedbackService } from '../feedback/feedback.service';
import { PoliciesService } from '../policies/policies.service';
import { surveyVisibleInScope } from '../surveys/survey-scope.util';
import { closestNames } from './fuzzy-names';

/** One thing found, ready to show: the admin opens `href` (with `search` as URL parameters). */
export type SearchHit = {
  id: string;
  section: string;
  label: string;
  detail?: string;
  href: string;
  search?: Record<string, string>;
  /** A person whose tabs can be opened directly ("Mary Jones medication"). */
  recordType?: 'serviceUser' | 'employee';
  recordId?: string;
};

const PER_SOURCE = 5;
const NAME_CACHE_MS = 60_000;

type Source = {
  section: string;
  /** Searched only for someone holding any of these. */
  anyOf: string[];
  run: (actor: RequestUser, q: string) => Promise<SearchHit[]>;
  /** People: a typo is corrected to the closest real name and searched again. */
  people?: 'serviceUser' | 'employee';
};

const full = (...parts: Array<string | null | undefined>) => parts.map((p) => p?.trim()).filter(Boolean).join(' ');
const rowsOf = (res: unknown): Record<string, any>[] => {
  const r = res as { data?: unknown };
  const d = r?.data as { items?: unknown } | unknown[] | undefined;
  if (Array.isArray(d)) return d as Record<string, any>[];
  if (d && Array.isArray((d as { items?: unknown }).items)) return (d as { items: Record<string, any>[] }).items;
  return [];
};
const words = (q: string) => q.trim().split(/\s+/).filter(Boolean);
/** Every word must match one of the fields (so full names and "Jones Mary" both work). */
const everyWord = (q: string, fields: string[]) =>
  words(q).map((w) => ({ OR: fields.map((f) => ({ [f]: { contains: w, mode: 'insensitive' } })) }));

/**
 * "Find anything": one request searches every kind of record the person may see. Lists that have their own search
 * (service users, staff, enquiries, incidents, safeguarding, complaints, policies) are searched through their own
 * service, so branch and privacy rules are exactly those of the list pages. The rest are read here with the same
 * permission and branch checks. One kind failing never hides the others.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private nameCache: { at: number; serviceUser: string[]; employee: string[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** A service from its own module, looked up when needed (no module imports, so no import loops). */
  private svc<T>(type: new (...args: any[]) => T): T {
    return this.moduleRef.get(type, { strict: false });
  }

  private readonly sources: Source[] = [
    {
      section: 'Service users',
      anyOf: ['service_users.read'],
      people: 'serviceUser',
      run: async (actor, q) =>
        rowsOf(await this.svc(ServiceUsersService).list({ search: q, limit: PER_SOURCE, page: 1 } as never, actor)).map((r) => ({
          id: `su:${r.id}`,
          section: 'Service users',
          label: full(r.firstName, r.lastName) || r.preferredName || 'Service user',
          detail: [r.serviceUserNumber, r.status === 'ACTIVE' ? null : r.status?.toLowerCase()].filter(Boolean).join(' · ') || undefined,
          href: `/service-users/${r.id}/profile`,
          recordType: 'serviceUser',
          recordId: r.id,
        })),
    },
    {
      section: 'Staff',
      anyOf: ['employees.read'],
      people: 'employee',
      run: async (actor, q) =>
        rowsOf(await this.svc(EmployeesService).list({ search: q, limit: PER_SOURCE, page: 1 } as never, actor)).map((r) => ({
          id: `emp:${r.id}`,
          section: 'Staff',
          label: r.fullName ?? full(r.firstName, r.lastName) ?? 'Staff member',
          detail: r.jobTitle?.name ?? r.jobTitleName ?? undefined,
          href: `/employee/${r.id}/edit`,
          recordType: 'employee',
          recordId: r.id,
        })),
    },
    {
      section: 'Enquiries & referrals',
      anyOf: ['crm.read', 'crm.manage'],
      run: async (actor, q) =>
        rowsOf(await this.svc(CrmService).list(actor, { search: q } as never))
          .slice(0, PER_SOURCE)
          .map((r) => ({
            id: `enq:${r.id}`,
            section: 'Enquiries & referrals',
            label: full(r.firstName, r.lastName) || r.referenceNumber,
            detail: r.kind === 'REFERRAL' ? `${r.referenceNumber} · Referral` : r.referenceNumber,
            href: `/crm/${r.id}`,
          })),
    },
    {
      section: 'Incidents',
      anyOf: ['incidents.read'],
      run: async (actor, q) =>
        rowsOf(await this.svc(IncidentsService).list(actor, { search: q, page: 1, limit: PER_SOURCE } as never)).map((r) => ({
          id: `inc:${r.id}`,
          section: 'Incidents',
          label: r.primaryPersonName ? `${r.referenceNumber} · ${r.primaryPersonName}` : r.referenceNumber,
          detail: r.category?.label ?? undefined,
          href: `/incidents/${r.id}`,
        })),
    },
    {
      section: 'Safeguarding',
      anyOf: ['safeguarding.read', 'safeguarding.manage'],
      run: async (actor, q) =>
        rowsOf(await this.svc(SafeguardingService).list(actor, { search: q } as never))
          .slice(0, PER_SOURCE)
          .map((r) => ({
            id: `sg:${r.id}`,
            section: 'Safeguarding',
            label: r.serviceUserName ?? r.personDescription ?? r.referenceNumber,
            detail: r.referenceNumber,
            href: `/safeguarding/${r.id}`,
          })),
    },
    {
      section: 'Complaints & compliments',
      anyOf: ['complaints.read'],
      run: async (actor, q) =>
        rowsOf(await this.svc(FeedbackService).list(actor, { search: q } as never))
          .slice(0, PER_SOURCE)
          .map((r) => ({ id: `fb:${r.id}`, section: 'Complaints & compliments', label: r.subject, detail: r.referenceNumber, href: `/incidents/feedback/${r.id}` })),
    },
    {
      section: 'Policies',
      anyOf: ['policies.read'],
      run: async (actor, q) =>
        rowsOf(await this.svc(PoliciesService).list(actor, { search: q, limit: PER_SOURCE, page: 1 } as never)).map((r) => ({
          id: `pol:${r.id}`,
          section: 'Policies',
          label: r.title,
          detail: r.reference ?? undefined,
          href: `/policies/${r.id}`,
        })),
    },
    {
      section: 'Service user documents',
      anyOf: ['service_users.documents.read', 'service_users.read'],
      run: (actor, q) => this.serviceUserDocuments(actor, q),
    },
    {
      section: 'Staff documents',
      anyOf: ['employees.documents.read'],
      run: (actor, q) => this.employeeDocuments(actor, q),
    },
    {
      section: 'Contacts',
      anyOf: ['service_users.read'],
      run: (actor, q) => this.serviceUserContacts(actor, q),
    },
    {
      section: 'Surveys',
      anyOf: ['surveys.read', 'surveys.manage'],
      run: (actor, q) => this.surveys(actor, q),
    },
    {
      section: 'Outside people (surveys)',
      anyOf: ['surveys.manage'],
      run: async (_actor, q) =>
        (
          await this.prisma.surveyExternalContact.findMany({
            where: { deletedAt: null, AND: everyWord(q, ['name', 'organisation', 'email']) },
            select: { id: true, name: true, organisation: true },
            take: PER_SOURCE,
          })
        ).map((c) => ({ id: `out:${c.id}`, section: 'Outside people (surveys)', label: c.name, detail: c.organisation ?? undefined, href: '/surveys/outside-people' })),
    },
    {
      section: 'Courses',
      anyOf: ['learning.courses.read', 'learning.courses.manage'],
      run: async (_actor, q) =>
        (
          await this.prisma.learningCourse.findMany({
            where: { deletedAt: null, AND: everyWord(q, ['title', 'shortDescription']) },
            select: { id: true, title: true, status: true },
            take: PER_SOURCE,
          })
        ).map((c) => ({ id: `course:${c.id}`, section: 'Courses', label: c.title, detail: String(c.status).toLowerCase(), href: `/learning/courses/${c.id}` })),
    },
    {
      section: 'Candidates',
      anyOf: ['hr.candidates.read', 'hr.read'],
      run: async (_actor, q) =>
        (
          await this.prisma.candidate.findMany({
            where: { deletedAt: null, AND: everyWord(q, ['firstName', 'lastName', 'email']) },
            select: { id: true, firstName: true, lastName: true, stage: true },
            take: PER_SOURCE,
          })
        ).map((c) => ({ id: `cand:${c.id}`, section: 'Candidates', label: full(c.firstName, c.lastName), detail: String(c.stage).toLowerCase().replace(/_/g, ' '), href: `/hr/candidates/${c.id}` })),
    },
    {
      section: 'Office users',
      anyOf: ['users.read'],
      run: (actor, q) => this.officeUsers(actor, q),
    },
    {
      section: 'Roles',
      anyOf: ['roles.manage', 'users.read'],
      run: async (_actor, q) =>
        (
          await this.prisma.role.findMany({ where: { deletedAt: null, AND: everyWord(q, ['name', 'description']) }, select: { id: true, name: true }, take: PER_SOURCE })
        ).map((r) => ({ id: `role:${r.id}`, section: 'Roles', label: r.name, href: '/settings/roles-permissions', search: { sub: 'roles' } })),
    },
    {
      section: 'Branches',
      anyOf: ['lookups.read'],
      run: async (actor, q) => {
        const scope = this.orgScope.fromRequestUser(actor);
        const rows = await this.prisma.location.findMany({ where: { deletedAt: null, AND: everyWord(q, ['name']) }, select: { id: true, name: true }, take: 20 });
        return rows
          .filter((l) => this.orgScope.locationsInScope(scope, [l.id]))
          .slice(0, PER_SOURCE)
          .map((l) => ({ id: `loc:${l.id}`, section: 'Branches', label: l.name, href: '/settings/location-management' }));
      },
    },
    {
      section: 'Funders',
      anyOf: ['lookups.read'],
      run: async (_actor, q) =>
        (
          await this.prisma.funder.findMany({ where: { deletedAt: null, AND: everyWord(q, ['name', 'contactName', 'email']) }, select: { id: true, name: true }, take: PER_SOURCE })
        ).map((f) => ({ id: `funder:${f.id}`, section: 'Funders', label: f.name, href: '/settings', search: { tab: 'funders' } })),
    },
  ];

  async search(actor: RequestUser, rawQuery: string): Promise<{ data: { hits: SearchHit[]; didYouMean: string | null; suggested: SearchHit[] } }> {
    const q = rawQuery.trim().slice(0, 100);
    if (q.length < 2) return { data: { hits: [], didYouMean: null, suggested: [] } };
    const can = (anyOf: string[]) => anyOf.some((p) => actor.permissions.includes(p));
    const sources = this.sources.filter((s) => can(s.anyOf));
    const settled = await Promise.allSettled(sources.map((s) => s.run(actor, q)));
    const hits: SearchHit[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') hits.push(...r.value);
      else this.logger.warn(`Search in ${sources[i]!.section} failed: ${r.reason instanceof Error ? r.reason.message : 'error'}`);
    });

    // Nothing found at all: a small typo in a name ("Mery Jones")? Search again with the closest real name, through
    // the same scoped lists (so it never shows anyone the person could not find by typing the name correctly).
    // Shown apart, as "Did you mean…?", never mixed with real matches.
    let didYouMean: string | null = null;
    const suggested: SearchHit[] = [];
    const peopleSources = sources.filter((s) => s.people);
    if (peopleSources.length && !hits.length && /[a-z]{3,}/i.test(q)) {
      const names = await this.knownNames();
      for (const s of peopleSources) {
        const best = closestNames(q, names[s.people!], 1)[0];
        if (!best || best.toLowerCase() === q.toLowerCase()) continue;
        try {
          const found = await s.run(actor, best);
          if (found.length) {
            suggested.push(...found);
            didYouMean ??= best;
          }
        } catch {
          // the corrected search failing is no worse than nothing found
        }
      }
    }
    return { data: { hits, didYouMean, suggested } };
  }

  /** Every service user's and staff member's name, for typo correction only (never returned as results). */
  private async knownNames() {
    if (this.nameCache && Date.now() - this.nameCache.at < NAME_CACHE_MS) return this.nameCache;
    const [su, emp] = await Promise.all([
      this.prisma.serviceUser.findMany({ where: { deletedAt: null }, select: { firstName: true, lastName: true, preferredName: true } }),
      this.prisma.employeePersonalDetail.findMany({ where: { deletedAt: null, employee: { deletedAt: null } }, select: { firstName: true, lastName: true } }),
    ]);
    const names = (rows: Array<{ firstName: string | null; lastName: string | null; preferredName?: string | null }>) => [
      ...new Set(rows.flatMap((r) => [full(r.firstName, r.lastName), full(r.preferredName, r.lastName)]).filter((n) => n.length > 2)),
    ];
    this.nameCache = { at: Date.now(), serviceUser: names(su), employee: names(emp) };
    return this.nameCache;
  }

  /** Documents of service users this person can see (title, type, file name, and the text inside the file). */
  private async serviceUserDocuments(actor: RequestUser, q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.serviceUserDocumentRecord.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        serviceUser: { deletedAt: null },
        AND: words(q).map((w) => ({
          OR: [
            { title: { contains: w, mode: 'insensitive' } },
            { fileName: { contains: w, mode: 'insensitive' } },
            { notes: { contains: w, mode: 'insensitive' } },
            { searchText: { contains: w, mode: 'insensitive' } },
            { documentType: { name: { contains: w, mode: 'insensitive' } } },
          ],
        })) as Prisma.ServiceUserDocumentRecordWhereInput[],
      },
      select: { id: true, title: true, serviceUserId: true, serviceUser: { select: { firstName: true, lastName: true } }, documentType: { select: { name: true } } },
      orderBy: { uploadedAt: 'desc' },
      take: 20,
    });
    const visible = await this.inScope(rows, (r) => this.orgScope.assertServiceUserInScope(this.orgScope.fromRequestUser(actor), r.serviceUserId));
    return visible.slice(0, PER_SOURCE).map((r) => ({
      id: `sudoc:${r.id}`,
      section: 'Service user documents',
      label: r.title,
      detail: [full(r.serviceUser.firstName, r.serviceUser.lastName), r.documentType?.name].filter(Boolean).join(' · '),
      href: `/service-users/${r.serviceUserId}/documents`,
    }));
  }

  /** Staff documents (name, description, tags, file name, and the text inside the file). */
  private async employeeDocuments(actor: RequestUser, q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.employeeDocument.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        AND: words(q).map((w) => ({
          OR: [
            { name: { contains: w, mode: 'insensitive' } },
            { description: { contains: w, mode: 'insensitive' } },
            { fileName: { contains: w, mode: 'insensitive' } },
            { tags: { has: w.toLowerCase() } },
            { searchText: { contains: w, mode: 'insensitive' } },
          ],
        })) as Prisma.EmployeeDocumentWhereInput[],
      },
      select: { id: true, name: true, employeeId: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const visible = await this.inScope(rows, (r) => this.orgScope.assertEmployeeInScope(this.orgScope.fromRequestUser(actor), r.employeeId));
    const names = new Map(
      (
        await this.prisma.employeePersonalDetail.findMany({
          where: { employeeId: { in: visible.map((v) => v.employeeId) } },
          select: { employeeId: true, firstName: true, lastName: true },
        })
      ).map((p) => [p.employeeId, full(p.firstName, p.lastName)]),
    );
    return visible.slice(0, PER_SOURCE).map((r) => ({
      id: `empdoc:${r.id}`,
      section: 'Staff documents',
      label: r.name,
      detail: names.get(r.employeeId),
      href: `/employee/${r.employeeId}/edit`,
      search: { tab: 'documents' },
    }));
  }

  /** Family and other contacts of service users this person can see. */
  private async serviceUserContacts(actor: RequestUser, q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.serviceUserContact.findMany({
      where: { deletedAt: null, isActive: true, serviceUser: { deletedAt: null }, AND: everyWord(q, ['firstName', 'lastName', 'email']) },
      select: { id: true, firstName: true, lastName: true, serviceUserId: true, serviceUser: { select: { firstName: true, lastName: true } } },
      take: 20,
    });
    const visible = await this.inScope(rows, (r) => this.orgScope.assertServiceUserInScope(this.orgScope.fromRequestUser(actor), r.serviceUserId));
    return visible.slice(0, PER_SOURCE).map((r) => ({
      id: `contact:${r.id}`,
      section: 'Contacts',
      label: full(r.firstName, r.lastName),
      detail: `Contact of ${full(r.serviceUser.firstName, r.serviceUser.lastName)}`,
      href: `/service-users/${r.serviceUserId}/profile`,
    }));
  }

  private async surveys(actor: RequestUser, q: string): Promise<SearchHit[]> {
    const scope = this.orgScope.fromRequestUser(actor);
    const rows = await this.prisma.survey.findMany({
      where: { deletedAt: null, isCatalogue: false, AND: everyWord(q, ['title', 'description']) },
      select: { id: true, title: true, status: true, isTemplate: true, locationIds: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows
      .filter((s) => surveyVisibleInScope(scope, s))
      .slice(0, PER_SOURCE)
      .map((s) => ({ id: `survey:${s.id}`, section: 'Surveys', label: s.title, detail: s.isTemplate ? 'template' : String(s.status).toLowerCase(), href: `/surveys/${s.id}` }));
  }

  /** Office users in the person's branches (everyone, for someone with access to all branches). */
  private async officeUsers(actor: RequestUser, q: string): Promise<SearchHit[]> {
    const scope = this.orgScope.fromRequestUser(actor);
    const branchOnly = scope.locationIds !== null;
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        AND: everyWord(q, ['firstName', 'lastName', 'email']),
        ...(branchOnly ? { userLocations: { some: { locationId: { in: scope.locationIds ?? [] } } } } : {}),
      },
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true, userRoles: { select: { role: { select: { name: true } } } } },
      take: PER_SOURCE,
    });
    return rows.map((u) => ({
      id: `user:${u.id}`,
      section: 'Office users',
      label: full(u.firstName, u.lastName) || u.email,
      detail: [u.userRoles.map((r) => r.role.name).join(', '), u.isActive ? null : 'switched off'].filter(Boolean).join(' · ') || u.email,
      href: '/settings/roles-permissions',
      search: { sub: 'office-users' },
    }));
  }

  /** Rows whose check passes (a check throws when the person may not see it). */
  private async inScope<T>(rows: T[], check: (row: T) => Promise<void>): Promise<T[]> {
    const ok = await Promise.all(rows.map((r) => check(r).then(() => true, () => false)));
    return rows.filter((_, i) => ok[i]);
  }
}
