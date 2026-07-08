import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { FundingContractsQueryDto } from './dto/funding-contracts.dto';
import {
  assessFundingBillingReadiness,
  formatAuthorisedHours,
  formatFundersSplit,
  isBillableFundingStatus,
} from './funding-contract.util';

const fundingLineInclude = {
  funder: {
    select: {
      id: true,
      name: true,
      code: true,
      defaultChargeCardId: true,
    },
  },
  defaultChargeCard: { select: { id: true, name: true, code: true, status: true } },
  serviceUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      serviceUserNumber: true,
      isActive: true,
    },
  },
} as const;

type FundingLine = Prisma.ServiceUserFundingGetPayload<{ include: typeof fundingLineInclude }>;

export type FundingContractReadiness = 'READY' | 'INCOMPLETE' | 'ENDED' | 'NO_FUNDING';

export type FundingContractRow = {
  id: string;
  serviceUserId: string;
  serviceUserName: string;
  serviceUserNumber: string | null;
  funders: string;
  packageRef: string | null;
  poNumber: string | null;
  poExpiresAt: string | null;
  authorisedHours: string | null;
  billingContact: string | null;
  effectiveFrom: string | null;
  status: FundingContractReadiness;
  readinessIssues: string[];
  fundingLineCount: number;
};

function formatServiceUserName(su: FundingLine['serviceUser']): string {
  const parts = [su.preferredName?.trim() || su.firstName?.trim(), su.lastName?.trim()].filter(
    Boolean,
  );
  return parts.join(' ') || 'Unnamed service user';
}

function formatBillingContact(line: FundingLine): string | null {
  const name = line.billingContactName?.trim();
  if (!name) return null;
  const email = line.billingContactEmail?.trim();
  return email ? `${name} (${email})` : name;
}

function pickPrimaryLine(lines: FundingLine[]): FundingLine | null {
  if (!lines.length) return null;
  const active = lines.filter((l) => l.isActive && isBillableFundingStatus(l.status));
  const pool = active.length ? active : lines;
  return (
    pool.find((l) => l.isPrimary) ??
    [...pool].sort((a, b) => a.splitPriority - b.splitPriority)[0] ??
    null
  );
}

function deriveContractStatus(lines: FundingLine[]): {
  status: FundingContractReadiness;
  issues: string[];
} {
  if (!lines.length) return { status: 'NO_FUNDING', issues: ['No funding contracts'] };

  const activeBillable = lines.filter((l) => l.isActive && isBillableFundingStatus(l.status));
  if (!activeBillable.length) {
    return { status: 'ENDED', issues: [] };
  }

  const issues = new Set<string>();
  for (const line of activeBillable) {
    const readiness = assessFundingBillingReadiness({
      status: line.status,
      isActive: line.isActive,
      funderId: line.funderId,
      defaultChargeCardId: line.defaultChargeCardId,
      funderDefaultChargeCardId: line.funder?.defaultChargeCardId ?? null,
      purchaseOrderNumber: line.purchaseOrderNumber,
      purchaseOrderExpiresAt: line.purchaseOrderExpiresAt,
      billingContactName: line.billingContactName,
    });
    for (const issue of readiness.issues) issues.add(issue);
  }

  if (issues.size > 0) {
    return { status: 'INCOMPLETE', issues: [...issues] };
  }
  return { status: 'READY', issues: [] };
}

function buildRow(serviceUserId: string, lines: FundingLine[]): FundingContractRow {
  const su = lines[0].serviceUser;
  const primary = pickPrimaryLine(lines);
  const billableLines = lines.filter((l) => l.isActive && isBillableFundingStatus(l.status));
  const { status, issues } = deriveContractStatus(lines);

  const authorisedHours =
    billableLines
      .map((l) => formatAuthorisedHours(l.authorisedWeeklyHours))
      .find(Boolean) ??
    (primary ? formatAuthorisedHours(primary.authorisedWeeklyHours) : null);

  return {
    id: serviceUserId,
    serviceUserId,
    serviceUserName: formatServiceUserName(su),
    serviceUserNumber: su.serviceUserNumber,
    funders: formatFundersSplit(billableLines.length ? billableLines : lines),
    packageRef: primary?.fundingReference ?? primary?.packageName ?? null,
    poNumber: primary?.purchaseOrderNumber ?? null,
    poExpiresAt: primary?.purchaseOrderExpiresAt
      ? primary.purchaseOrderExpiresAt.toISOString().slice(0, 10)
      : null,
    authorisedHours,
    billingContact: primary ? formatBillingContact(primary) : null,
    effectiveFrom: primary?.startDate ? primary.startDate.toISOString().slice(0, 10) : null,
    status,
    readinessIssues: issues,
    fundingLineCount: lines.length,
  };
}

@Injectable()
export class FundingContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: FundingContractsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const search = query.search?.trim().toLowerCase();

    const fundings = await this.prisma.serviceUserFunding.findMany({
      where: { deletedAt: null },
      include: fundingLineInclude,
      orderBy: [{ serviceUserId: 'asc' }, { splitPriority: 'asc' }, { createdAt: 'asc' }],
    });

    const grouped = new Map<string, FundingLine[]>();
    for (const line of fundings) {
      const bucket = grouped.get(line.serviceUserId) ?? [];
      bucket.push(line);
      grouped.set(line.serviceUserId, bucket);
    }

    let rows = [...grouped.entries()].map(([serviceUserId, lines]) =>
      buildRow(serviceUserId, lines),
    );

    if (search) {
      rows = rows.filter(
        (row) =>
          row.serviceUserName.toLowerCase().includes(search) ||
          (row.serviceUserNumber?.toLowerCase().includes(search) ?? false) ||
          row.funders.toLowerCase().includes(search) ||
          (row.packageRef?.toLowerCase().includes(search) ?? false) ||
          (row.poNumber?.toLowerCase().includes(search) ?? false) ||
          (row.billingContact?.toLowerCase().includes(search) ?? false),
      );
    }

    const readiness = query.readiness ?? 'ALL';
    if (readiness !== 'ALL') {
      rows = rows.filter((row) => row.status === readiness);
    }

    const total = rows.length;
    const start = (page - 1) * limit;
    const pageRows = rows.slice(start, start + limit);

    return {
      data: pageRows,
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getSummary() {
    const [activeServiceUsers, fundings] = await Promise.all([
      this.prisma.serviceUser.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.serviceUserFunding.findMany({
        where: { deletedAt: null },
        include: fundingLineInclude,
      }),
    ]);

    const grouped = new Map<string, FundingLine[]>();
    for (const line of fundings) {
      const bucket = grouped.get(line.serviceUserId) ?? [];
      bucket.push(line);
      grouped.set(line.serviceUserId, bucket);
    }

    let ready = 0;
    let incomplete = 0;
    let ended = 0;
    const serviceUsersWithFunding = grouped.size;

    for (const lines of grouped.values()) {
      const { status } = deriveContractStatus(lines);
      if (status === 'READY') ready += 1;
      else if (status === 'INCOMPLETE') incomplete += 1;
      else if (status === 'ENDED') ended += 1;
    }

    const missingFundingContracts = Math.max(0, activeServiceUsers - ready);

    return {
      activeServiceUsers,
      serviceUsersWithFunding,
      ready,
      incomplete,
      ended,
      missingFundingContracts,
    };
  }
}
