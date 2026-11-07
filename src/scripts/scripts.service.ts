import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditStatus } from '../audit-logs/enums/audit-status.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type {
  FinishVisitCreationRunDto,
  StartVisitCreationRunDto,
} from './dto/visit-creation-run.dto';

/**
 * The configured Visit Creation automation: the same file `npm run visits:create` uses
 * (prisma/scripts/create-visits.example.json), or the file VISIT_CREATION_CONFIG_PATH names.
 * It refers to service users by number or name and carers by name — no database ids.
 */
const DEFAULT_CONFIG_PATH = 'prisma/scripts/create-visits.example.json';

/** A run that has not finished within this long no longer blocks another one. */
const RUN_LOCK_MS = 30 * 60 * 1000;

type ConfigVisit = { round?: unknown; start?: unknown; end?: unknown };
type ConfigServiceUser = { serviceUser?: unknown; visits?: unknown };

/**
 * Scripts page (admin → Scripts): automation workflows that call the existing API endpoints step by
 * step as the signed-in user, so every existing rule and audit entry still applies. This service only
 * serves the configured automation, checks a run's selections and records each run in the audit log;
 * it creates no visits itself.
 */
@Injectable()
export class ScriptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  /** The configured automation (Automatic Visit Creation), checked for shape before the page uses it. */
  async visitCreationConfig() {
    const configured =
      process.env.VISIT_CREATION_CONFIG_PATH?.trim() || DEFAULT_CONFIG_PATH;
    const path = isAbsolute(configured)
      ? configured
      : join(process.cwd(), configured);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      throw new NotFoundException(
        'No Visit Creation automation is configured on this server (VISIT_CREATION_CONFIG_PATH).',
      );
    }
    let config: { serviceUsers?: unknown } & Record<string, unknown>;
    try {
      config = JSON.parse(raw) as typeof config;
    } catch {
      throw new BadRequestException(
        'The configured Visit Creation automation is not valid JSON.',
      );
    }
    const serviceUsers = config.serviceUsers;
    if (!Array.isArray(serviceUsers) || !serviceUsers.length) {
      throw new BadRequestException(
        'The configured Visit Creation automation has no service users.',
      );
    }
    for (const su of serviceUsers as ConfigServiceUser[]) {
      const visits = su?.visits;
      if (
        typeof su?.serviceUser !== 'string' ||
        !Array.isArray(visits) ||
        !visits.length
      ) {
        throw new BadRequestException(
          'Each configured service user needs "serviceUser" and at least one visit.',
        );
      }
      for (const v of visits as ConfigVisit[]) {
        if (
          typeof v?.round !== 'string' ||
          typeof v?.start !== 'string' ||
          typeof v?.end !== 'string'
        ) {
          throw new BadRequestException(
            `A visit for "${su.serviceUser}" needs "round", "start" and "end".`,
          );
        }
      }
    }
    return {
      message: 'Visit Creation automation',
      data: {
        source:
          configured === DEFAULT_CONFIG_PATH
            ? DEFAULT_CONFIG_PATH
            : 'VISIT_CREATION_CONFIG_PATH',
        config,
      },
    };
  }

  /**
   * Checks a run before any visit is touched and records its start: the selected service users and
   * carers exist, are active and are in the user's branches; no other real run is still going.
   */
  async startVisitCreationRun(
    user: RequestUser,
    dto: StartVisitCreationRunDto,
    meta?: RequestAuditMeta,
  ) {
    const serviceUserIds = [...new Set(dto.serviceUserIds ?? [])];
    const carerIds = [...new Set(dto.carerIds ?? [])];
    if (dto.mode === 'CUSTOM' && (!serviceUserIds.length || !carerIds.length)) {
      throw new BadRequestException(
        'Select at least one service user and one carer.',
      );
    }

    const scope = this.orgScope.fromRequestUser(user);
    if (serviceUserIds.length) {
      const found = await this.prisma.serviceUser.findMany({
        where: { id: { in: serviceUserIds }, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (found.length !== serviceUserIds.length) {
        throw new BadRequestException(
          'A selected service user was not found or is not active.',
        );
      }
      for (const id of serviceUserIds)
        await this.orgScope.assertServiceUserInScope(scope, id);
    }
    if (carerIds.length) {
      const found = await this.prisma.employee.findMany({
        where: { id: { in: carerIds }, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (found.length !== carerIds.length) {
        throw new BadRequestException(
          'A selected carer was not found or is not active.',
        );
      }
      for (const id of carerIds)
        await this.orgScope.assertEmployeeInScope(scope, id);
    }

    // One real run at a time (a dry run changes nothing): an unfinished start in the last 30 minutes blocks.
    if (!dto.dryRun) {
      const since = new Date(Date.now() - RUN_LOCK_MS);
      const started = await this.prisma.auditLog.findMany({
        where: {
          module: AuditModule.SCRIPTS,
          action: AuditAction.VISIT_CREATION_SCRIPT_STARTED,
          createdAt: { gte: since },
          newValues: { path: ['dryRun'], equals: false },
        },
        select: { recordId: true, createdAt: true, userId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (started.length) {
        const finished = await this.prisma.auditLog.findMany({
          where: {
            module: AuditModule.SCRIPTS,
            action: AuditAction.VISIT_CREATION_SCRIPT_FINISHED,
            recordId: {
              in: started
                .map((s) => s.recordId)
                .filter((id): id is string => Boolean(id)),
            },
          },
          select: { recordId: true },
        });
        const done = new Set(finished.map((f) => f.recordId));
        const running = started.find(
          (s) => s.recordId && !done.has(s.recordId),
        );
        if (running) {
          throw new ConflictException(
            `Another Visit Creation run started at ${running.createdAt.toISOString().slice(11, 16)} UTC is still going. ` +
              'Wait for it to finish (runs that never finish stop blocking after 30 minutes).',
          );
        }
      }
    }

    const runId = randomUUID();
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SCRIPTS,
      action: AuditAction.VISIT_CREATION_SCRIPT_STARTED,
      recordType: 'ScriptRun',
      recordId: runId,
      description: `Visit Creation (${dto.mode === 'AUTOMATIC' ? 'automatic' : 'custom'})${dto.dryRun ? ' — dry run' : ''} started`,
      newValues: {
        script: 'visit-creation',
        mode: dto.mode,
        dryRun: dto.dryRun,
        serviceUserIds,
        carerIds,
      },
      ...meta,
    });
    return { message: 'Run started', data: { runId } };
  }

  /** Records how a run ended, with its result, against the run its start recorded. */
  async finishVisitCreationRun(
    user: RequestUser,
    runId: string,
    dto: FinishVisitCreationRunDto,
    meta?: RequestAuditMeta,
  ) {
    const started = await this.prisma.auditLog.findFirst({
      where: {
        module: AuditModule.SCRIPTS,
        action: AuditAction.VISIT_CREATION_SCRIPT_STARTED,
        recordId: runId,
        userId: user.id,
      },
      select: { newValues: true },
    });
    if (!started) throw new NotFoundException('Run not found');
    const already = await this.prisma.auditLog.count({
      where: {
        module: AuditModule.SCRIPTS,
        action: AuditAction.VISIT_CREATION_SCRIPT_FINISHED,
        recordId: runId,
      },
    });
    if (already) throw new ConflictException('This run has already finished.');

    const startedValues = (started.newValues ?? {}) as Record<string, unknown>;
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SCRIPTS,
      action: AuditAction.VISIT_CREATION_SCRIPT_FINISHED,
      recordType: 'ScriptRun',
      recordId: runId,
      status:
        dto.outcome === 'FAILED' ? AuditStatus.FAILED : AuditStatus.SUCCESS,
      description: `Visit Creation (${startedValues.mode === 'AUTOMATIC' ? 'automatic' : 'custom'})${
        startedValues.dryRun ? ' — dry run' : ''
      } finished: ${dto.outcome.toLowerCase()}`,
      newValues: {
        ...startedValues,
        outcome: dto.outcome,
        summary: dto.summary,
      },
      ...meta,
    });
    return { message: 'Run finished', data: { runId, outcome: dto.outcome } };
  }
}
