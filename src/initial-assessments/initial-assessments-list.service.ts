import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { InitialAssessmentListQueryDto } from './dto/initial-assessment-list-query.dto';
import {
  bucketForStatus,
  compareListRows,
  countBuckets,
  rowMatchesView,
  type InitialAssessmentListBucket,
} from './initial-assessment-list.util';

type PersonName = { id: string; firstName: string | null; lastName: string | null; email: string } | null;

function personName(p: PersonName): { id: string; name: string } | null {
  if (!p) return null;
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return { id: p.id, name: name || p.email };
}

const PERSON_SELECT = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

/** Local QA test roles (e.g. "QA-SCH Role RO", "QAHR Esc Role") are never offered as a filter. */
const isTestRoleName = (name: string) => /^QA/i.test(name.trim());

/**
 * Read-only list of service users and their latest Initial Assessment, for the admin
 * "Initial assessments" page. "Latest" is the same rule as GET .../initial-assessment/latest
 * (newest non-deleted submission by createdAt). Branch scope follows the service-user list.
 */
@Injectable()
export class InitialAssessmentsListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(actor: RequestUser, query: InitialAssessmentListQueryDto, meta?: RequestAuditMeta) {
    const view = query.view ?? 'all';
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const now = new Date();

    const scope = this.orgScope.fromRequestUser(actor);
    const locationIds = this.orgScope.resolveListLocationIds(scope, query.locationId, undefined);
    const empty = {
      data: {
        rows: [],
        counts: countBuckets([]),
        startedByRoles: [] as string[],
      },
      meta: { page, limit, total: 0, totalPages: 0 },
    };
    if (locationIds && locationIds.length === 0) return empty;

    const and: Prisma.ServiceUserWhereInput[] = [];
    if (locationIds?.length) {
      and.push({
        OR: [
          { locationId: { in: locationIds } },
          { assignments: { some: { deletedAt: null, locationId: { in: locationIds } } } },
        ],
      });
    }
    const search = query.search?.trim();
    if (search) {
      for (const word of search.split(/\s+/).filter(Boolean)) {
        and.push({
          OR: [
            { firstName: { contains: word, mode: 'insensitive' } },
            { lastName: { contains: word, mode: 'insensitive' } },
            { preferredName: { contains: word, mode: 'insensitive' } },
            { serviceUserNumber: { contains: word, mode: 'insensitive' } },
          ],
        });
      }
    }

    const serviceUsers = await this.prisma.serviceUser.findMany({
      where: { deletedAt: null, ...(and.length ? { AND: and } : {}) },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
        isActive: true,
        location: { select: { id: true, name: true } },
        initialAssessmentSubmissions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            reviewedAt: true,
            updatedAt: true,
            createdAt: true,
            createdBy: {
              select: {
                ...PERSON_SELECT.select,
                userRoles: {
                  where: { role: { deletedAt: null, isActive: true } },
                  select: { role: { select: { name: true } } },
                },
              },
            },
            submittedBy: PERSON_SELECT,
            reviewedBy: PERSON_SELECT,
            _count: {
              select: {
                actions: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lte: now } } },
              },
            },
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const all = serviceUsers
      .map((su) => {
        const ia = su.initialAssessmentSubmissions[0] ?? null;
        const bucket: InitialAssessmentListBucket = bucketForStatus(ia?.status);
        return {
          serviceUser: {
            id: su.id,
            firstName: su.firstName,
            lastName: su.lastName,
            preferredName: su.preferredName,
            serviceUserNumber: su.serviceUserNumber,
            isActive: su.isActive,
          },
          branch: su.location ? { id: su.location.id, name: su.location.name } : null,
          bucket,
          overdueActionCount: ia?._count.actions ?? 0,
          assessment: ia
            ? {
                id: ia.id,
                status: ia.status,
                startedAt: ia.startedAt ?? ia.createdAt,
                submittedAt: ia.submittedAt,
                reviewedAt: ia.reviewedAt,
                updatedAt: ia.updatedAt,
                startedBy: personName(ia.createdBy),
                startedByRoles: (ia.createdBy?.userRoles ?? [])
                  .map((ur) => ur.role.name)
                  .filter((name) => !isTestRoleName(name)),
                submittedBy: personName(ia.submittedBy),
                reviewedBy: personName(ia.reviewedBy),
              }
            : null,
        };
      })
      // "No IA yet" is for active service users only (decided 24 Nov 2026).
      .filter((row) => row.assessment || row.serviceUser.isActive);

    const roleSet = new Set<string>();
    for (const row of all) for (const r of row.assessment?.startedByRoles ?? []) roleSet.add(r);

    const byStarter = query.startedByRole
      ? all.filter((row) => row.assessment?.startedByRoles.includes(query.startedByRole!))
      : all;
    const counts = countBuckets(byStarter);
    const filtered = byStarter
      .filter((row) => rowMatchesView(row, view))
      .sort(compareListRows(query.sort ?? 'updated'));

    const total = filtered.length;
    const rows = filtered.slice((page - 1) * limit, page * limit);

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_SUMMARY_VIEWED,
      recordType: 'InitialAssessmentList',
      recordId: 'list',
      metadata: { view, sort: query.sort ?? 'updated', locationId: query.locationId ?? null, search: search ?? null, total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: {
        rows,
        counts,
        startedByRoles: [...roleSet].sort((a, b) => a.localeCompare(b)),
      },
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
