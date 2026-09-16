import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  CarerVisitPushKind,
  EcmArrivalClassification,
  EcmDurationClassification,
  EcmExceptionKind,
  EcmExceptionLifecycle,
  EcmMissedClassification,
  EcmAuditEventType,
  Prisma,
  VisitAttendanceEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcmAuditService } from './ecm-audit.service';
import { EcmAlertService } from './ecm-alert.service';
import { slaTargetsForCriticality } from './ecm-sla.util';
import { isSosOutcomeCode, parseSosClosePayload, sosOutcomeLabel } from './ecm-reason-codes';
import { scheduledJobLocationScope } from './ecm-location-scope.util';
import { displayUserName, mapCarerSosAlert, parseCarerSosContext } from './carer-sos.util';
import { mapVisitCheckInMethodGrant } from './visit-check-in-method-grant.util';
import { loadVisitRefsByScheduledVisitIds } from '../scheduling/visit-ref-lookup.util';
import { CarerVisitPushHook } from '../notifications/carer-visit-push.hook';
import { fcmReport, type FcmSendReport } from '../notifications/fcm-send-report';

/** Open queue includes RESOLVED so managers can still Close (audit close gate). */
const OPEN_LIFECYCLES: EcmExceptionLifecycle[] = [
  EcmExceptionLifecycle.DETECTED,
  EcmExceptionLifecycle.ALERT_GENERATED,
  EcmExceptionLifecycle.ASSIGNED,
  EcmExceptionLifecycle.ACKNOWLEDGED,
  EcmExceptionLifecycle.INVESTIGATING,
  EcmExceptionLifecycle.ACTION_TAKEN,
  EcmExceptionLifecycle.RESOLVED,
  EcmExceptionLifecycle.MANAGER_REVIEWED,
];

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

function toCoord(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class EcmExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: EcmAuditService,
    private readonly alerts: EcmAlertService,
    private readonly carerPush: CarerVisitPushHook,
  ) {}

  /**
   * Ensure open exceptions exist for classifications on the evaluation (idempotent by kind).
   */
  async syncFromEvaluation(evaluationId: string) {
    const evaluation = await this.prisma.ecmVisitEvaluation.findUnique({
      where: { id: evaluationId },
      include: {
        scheduledJob: { select: { metadata: true } },
      },
    });
    if (!evaluation) return [];

    const jobMeta =
      evaluation.scheduledJob.metadata &&
      typeof evaluation.scheduledJob.metadata === 'object' &&
      !Array.isArray(evaluation.scheduledJob.metadata)
        ? (evaluation.scheduledJob.metadata as Record<string, unknown>)
        : {};
    const missedReasonCode =
      typeof jobMeta.missedReasonCode === 'string' ? jobMeta.missedReasonCode : null;
    const missedReasonLabel =
      typeof jobMeta.missedReasonLabel === 'string'
        ? jobMeta.missedReasonLabel
        : missedReasonCode;
    const missedReasonNotes =
      typeof jobMeta.missedReasonNotes === 'string' ? jobMeta.missedReasonNotes : null;
    const confirmedMissedDetail = [missedReasonLabel, missedReasonNotes]
      .filter(Boolean)
      .join(' — ') || undefined;

    const desired: {
      kind: EcmExceptionKind;
      title: string;
      detail?: string;
      reasonCode?: string | null;
    }[] = [];

    if (evaluation.arrivalClassification === EcmArrivalClassification.LATE_ARRIVAL) {
      desired.push({
        kind: EcmExceptionKind.LATE_ARRIVAL,
        title: 'Late arrival',
        detail:
          evaluation.startVarianceMinutes != null
            ? `Start variance +${evaluation.startVarianceMinutes} minutes`
            : undefined,
      });
    }
    if (evaluation.arrivalClassification === EcmArrivalClassification.VERY_LATE_ARRIVAL) {
      desired.push({
        kind: EcmExceptionKind.VERY_LATE_ARRIVAL,
        title: 'Very late arrival',
        detail:
          evaluation.startVarianceMinutes != null
            ? `Start variance +${evaluation.startVarianceMinutes} minutes`
            : undefined,
      });
    }
    if (evaluation.arrivalClassification === EcmArrivalClassification.EARLY_ARRIVAL) {
      desired.push({
        kind: EcmExceptionKind.EARLY_ARRIVAL,
        title: 'Early arrival',
      });
    }
    if (evaluation.durationClassification === EcmDurationClassification.SHORT_VISIT) {
      desired.push({ kind: EcmExceptionKind.SHORT_VISIT, title: 'Short visit' });
    }
    if (evaluation.durationClassification === EcmDurationClassification.LONG_VISIT) {
      desired.push({ kind: EcmExceptionKind.LONG_VISIT, title: 'Long visit' });
    }
    if (evaluation.durationClassification === EcmDurationClassification.EXCESSIVE_OVERRUN) {
      desired.push({
        kind: EcmExceptionKind.EXCESSIVE_OVERRUN,
        title: 'Excessive overrun',
      });
    }
    if (evaluation.missedClassification === EcmMissedClassification.POTENTIAL_MISSED) {
      desired.push({
        kind: EcmExceptionKind.POTENTIAL_MISSED,
        title: 'Potential missed visit',
      });
    }
    if (evaluation.missedClassification === EcmMissedClassification.CONFIRMED_MISSED) {
      desired.push({
        kind: EcmExceptionKind.CONFIRMED_MISSED,
        title: 'Confirmed missed visit',
        detail: confirmedMissedDetail,
        reasonCode: missedReasonCode,
      });
    }
    if (evaluation.operationalExceptionCodes.includes('OUTSIDE_GEOFENCE')) {
      desired.push({
        kind: EcmExceptionKind.OUTSIDE_GEOFENCE,
        title: 'Outside geofence attendance',
      });
    }
    if (evaluation.operationalExceptionCodes.includes('MANUAL_ATTENDANCE')) {
      desired.push({
        kind: EcmExceptionKind.MANUAL_ATTENDANCE,
        title: 'Admin completed visit',
      });
    }
    if (evaluation.operationalExceptionCodes.includes('MOCK_LOCATION')) {
      desired.push({
        kind: EcmExceptionKind.MOCK_LOCATION,
        title: 'Mock location flagged',
      });
    }
    if (
      evaluation.actualCheckInAt &&
      !evaluation.actualCheckOutAt &&
      evaluation.plannedEndDateTime &&
      evaluation.plannedEndDateTime.getTime() < Date.now()
    ) {
      desired.push({
        kind: EcmExceptionKind.MISSING_CHECKOUT,
        title: 'Missing check-out',
      });
    }

    const createdOrExisting = [];
    for (const item of desired) {
      const open = await this.prisma.ecmException.findFirst({
        where: {
          scheduledJobId: evaluation.scheduledJobId,
          kind: item.kind,
          lifecycle: { in: OPEN_LIFECYCLES },
        },
      });
      if (open) {
        if (
          item.kind === EcmExceptionKind.CONFIRMED_MISSED &&
          (item.detail || item.reasonCode) &&
          (open.detail !== item.detail || open.reasonCode !== (item.reasonCode ?? null))
        ) {
          const updated = await this.prisma.ecmException.update({
            where: { id: open.id },
            data: {
              detail: item.detail ?? open.detail,
              reasonCode: item.reasonCode ?? open.reasonCode,
            },
          });
          createdOrExisting.push(updated);
        } else {
          createdOrExisting.push(open);
        }
        continue;
      }
      const sla = slaTargetsForCriticality(evaluation.criticality);
      const row = await this.prisma.ecmException.create({
        data: {
          scheduledJobId: evaluation.scheduledJobId,
          ecmVisitEvaluationId: evaluation.id,
          kind: item.kind,
          lifecycle: EcmExceptionLifecycle.DETECTED,
          title: item.title,
          detail: item.detail,
          reasonCode: item.reasonCode ?? null,
          responseTargetMinutes: sla.responseTargetMinutes,
          escalationDeadlineAt:
            sla.escalationMinutes > 0
              ? new Date(Date.now() + sla.escalationMinutes * 60_000)
              : new Date(),
        },
      });
      await this.audit.append({
        eventType: EcmAuditEventType.EXCEPTION_DETECTED,
        scheduledJobId: evaluation.scheduledJobId,
        ecmExceptionId: row.id,
        summary: `Exception detected: ${row.kind}`,
        detail: { title: row.title, detail: row.detail },
      });
      await this.alerts.applySlaAndAlert({
        exceptionId: row.id,
        criticality: evaluation.criticality,
        notify: true,
      });
      createdOrExisting.push(row);
    }

    await this.clearStaleExceptions(
      evaluation.scheduledJobId,
      evaluation.id,
      desired.map(d => d.kind),
      evaluation.missedClassification,
    );

    return createdOrExisting;
  }

  /**
   * Close open exceptions whose kinds are no longer justified by the evaluation.
   * Miss kinds are always eligible when classification is NONE; other kinds (e.g.
   * MISSING_CHECKOUT) clear when office completion / re-eval no longer desires them.
   * RESOLVED alone still appears in listOpen — close after resolve.
   */
  private async clearStaleExceptions(
    scheduledJobId: string,
    evaluationId: string,
    desiredKinds: EcmExceptionKind[],
    missedClassification: EcmMissedClassification,
  ) {
    const keep = new Set(desiredKinds);
    // Defensive: if miss classification still set, never drop that miss kind early.
    if (missedClassification === EcmMissedClassification.POTENTIAL_MISSED) {
      keep.add(EcmExceptionKind.POTENTIAL_MISSED);
    }
    if (missedClassification === EcmMissedClassification.CONFIRMED_MISSED) {
      keep.add(EcmExceptionKind.CONFIRMED_MISSED);
    }

    const open = await this.prisma.ecmException.findMany({
      where: {
        scheduledJobId,
        lifecycle: { in: OPEN_LIFECYCLES },
      },
    });
    const stale = open.filter(
      row =>
        row.kind !== EcmExceptionKind.LEFT_VISIT_AREA &&
        row.kind !== EcmExceptionKind.CARER_SOS &&
        row.kind !== EcmExceptionKind.OUTSIDE_AREA_CHECK_IN_REQUEST &&
        row.kind !== EcmExceptionKind.UNABLE_TO_START &&
        !keep.has(row.kind),
    );
    if (stale.length === 0) return;

    for (const row of stale) {
      const resolved =
        row.lifecycle === EcmExceptionLifecycle.RESOLVED ||
        row.lifecycle === EcmExceptionLifecycle.MANAGER_REVIEWED
          ? row
          : await this.prisma.ecmException.update({
              where: { id: row.id },
              data: {
                lifecycle: EcmExceptionLifecycle.RESOLVED,
                reasonCode: 'CLEARED_BY_REEVALUATION',
                resolutionNote:
                  'Exception cleared after visit outcome / re-evaluation.',
                resolvedAt: new Date(),
                resolvedById: null,
                firstActionAt: row.firstActionAt ?? new Date(),
                ecmVisitEvaluationId: evaluationId,
              },
            });

      if (resolved.lifecycle !== EcmExceptionLifecycle.CLOSED) {
        await this.prisma.ecmException.update({
          where: { id: resolved.id },
          data: {
            lifecycle: EcmExceptionLifecycle.CLOSED,
            closedAt: new Date(),
            closedById: null,
          },
        });
      }

      await this.audit.append({
        eventType: EcmAuditEventType.EXCEPTION_CLOSED,
        scheduledJobId,
        ecmExceptionId: row.id,
        summary: `${row.kind} exception cleared by re-evaluation`,
        detail: {
          reasonCode: 'CLEARED_BY_REEVALUATION',
          previousLifecycle: row.lifecycle,
          previousKind: row.kind,
          evaluationId,
          missedClassification,
        },
      });
    }
  }

  async raiseUnableToStart(params: {
    scheduledJobId: string;
    employeeId: string;
    reasonCode: string;
    reasonLabel: string;
    notes: string;
  }) {
    const existing = await this.prisma.ecmException.findFirst({
      where: {
        scheduledJobId: params.scheduledJobId,
        kind: EcmExceptionKind.UNABLE_TO_START,
        lifecycle: { in: OPEN_LIFECYCLES },
      },
      select: { id: true },
    });
    if (existing) return existing;

    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: params.scheduledJobId, deletedAt: null },
      select: { ecmEvaluation: { select: { id: true, criticality: true } } },
    });
    const sla = slaTargetsForCriticality(job?.ecmEvaluation?.criticality ?? 'PRIORITY');
    const title = `Unable to start — ${params.reasonLabel}`;
    const detail = params.notes.trim() || params.reasonLabel;
    const exception = await this.prisma.ecmException.create({
      data: {
        scheduledJobId: params.scheduledJobId,
        ecmVisitEvaluationId: job?.ecmEvaluation?.id ?? null,
        kind: EcmExceptionKind.UNABLE_TO_START,
        lifecycle: EcmExceptionLifecycle.DETECTED,
        title,
        detail,
        context: {
          employeeId: params.employeeId,
          reasonCode: params.reasonCode,
          reasonLabel: params.reasonLabel,
          notes: params.notes,
        } as Prisma.InputJsonValue,
        responseTargetMinutes: sla.responseTargetMinutes,
        escalationDeadlineAt:
          sla.escalationMinutes > 0
            ? new Date(Date.now() + sla.escalationMinutes * 60_000)
            : new Date(),
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_DETECTED,
      scheduledJobId: params.scheduledJobId,
      ecmExceptionId: exception.id,
      actorUserId: null,
      summary: title,
      detail: {
        employeeId: params.employeeId,
        reasonCode: params.reasonCode,
      },
    });
    await this.alerts.applySlaAndAlert({
      exceptionId: exception.id,
      criticality: job?.ecmEvaluation?.criticality ?? 'PRIORITY',
      notify: true,
    });
    return exception;
  }

  async listOpen(limit = 50, serviceUserId?: string, locationId?: string) {
    await this.alerts.refreshOverdueFlags(200);
    const suWhere =
      serviceUserId || locationId
        ? {
            scheduledJob: {
              deletedAt: null,
              ...(serviceUserId ? { serviceUserId } : {}),
              ...(locationId ? scheduledJobLocationScope(locationId) : {}),
            },
          }
        : {};
    const include = {
      visitAreaLock: true,
      checkInMethodGrant: true,
      scheduledJob: {
        select: {
          id: true,
          jobName: true,
          status: true,
          scheduledStartDateTime: true,
          scheduledEndDateTime: true,
          serviceUserId: true,
          visits: {
            where: { deletedAt: null },
            select: { id: true, actualStartDateTime: true, visitRef: true },
            orderBy: { scheduledStartDateTime: 'asc' as const },
            take: 1,
          },
          serviceUser: {
            select: { id: true, firstName: true, lastName: true, preferredName: true },
          },
          allocations: {
            where: {
              deletedAt: null,
              isActive: true,
              unallocatedAt: null,
              status: { in: ACTIVE_ALLOCATION },
            },
            select: {
              isLeadCarer: true,
              employee: {
                select: {
                  id: true,
                  personalDetail: {
                    select: { firstName: true, lastName: true },
                  },
                },
              },
            },
          },
        },
      },
    } as const;
    // Every visit's LEFT_VISIT_AREA card must appear — do not let the page
    // limit hide a later same-day lock behind older exceptions.
    const [sosRows, areaRows, mockRows, checkInRequestRows, unableToStartRows, otherRows] =
      await Promise.all([
      this.prisma.ecmException.findMany({
        where: {
          kind: EcmExceptionKind.CARER_SOS,
          lifecycle: { in: OPEN_LIFECYCLES },
          ...suWhere,
        },
        orderBy: [{ createdAt: 'desc' }],
        include,
      }),
      this.prisma.ecmException.findMany({
        where: {
          kind: EcmExceptionKind.LEFT_VISIT_AREA,
          lifecycle: { in: OPEN_LIFECYCLES },
          ...suWhere,
        },
        orderBy: [{ createdAt: 'desc' }],
        include,
      }),
      this.prisma.ecmException.findMany({
        where: {
          kind: EcmExceptionKind.MOCK_LOCATION,
          lifecycle: { in: OPEN_LIFECYCLES },
          ...suWhere,
        },
        orderBy: [{ createdAt: 'desc' }],
        include,
      }),
      this.prisma.ecmException.findMany({
        where: {
          kind: EcmExceptionKind.OUTSIDE_AREA_CHECK_IN_REQUEST,
          lifecycle: { in: OPEN_LIFECYCLES },
          ...suWhere,
        },
        orderBy: [{ createdAt: 'desc' }],
        include,
      }),
      this.prisma.ecmException.findMany({
        where: {
          kind: EcmExceptionKind.UNABLE_TO_START,
          lifecycle: { in: OPEN_LIFECYCLES },
          ...suWhere,
        },
        orderBy: [{ createdAt: 'desc' }],
        include,
      }),
      this.prisma.ecmException.findMany({
        where: {
          kind: {
            notIn: [
              EcmExceptionKind.CARER_SOS,
              EcmExceptionKind.LEFT_VISIT_AREA,
              EcmExceptionKind.MOCK_LOCATION,
              EcmExceptionKind.OUTSIDE_AREA_CHECK_IN_REQUEST,
              EcmExceptionKind.UNABLE_TO_START,
            ],
          },
          lifecycle: { in: OPEN_LIFECYCLES },
          ...suWhere,
        },
        orderBy: [{ overdue: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(limit, 100),
        include,
      }),
    ]);
    const reservedIds = new Set(
      [...sosRows, ...areaRows, ...mockRows, ...checkInRequestRows, ...unableToStartRows].map(
        (row) => row.id,
      ),
    );
    const rows = [
      ...sosRows,
      ...areaRows,
      ...mockRows,
      ...checkInRequestRows,
      ...unableToStartRows,
      ...otherRows.filter((row) => !reservedIds.has(row.id)),
    ];
    const mockedJobIds = await this.mockedVisitJobIds(
      rows.map((row) => row.scheduledJobId),
    );
    const checkInLocations = await this.loadCheckInLocationsByJobIds(
      rows.map((row) => row.scheduledJobId),
    );
    const visitIds = rows
      .map((row) => row.scheduledJob.visits[0]?.id)
      .filter((id): id is string => Boolean(id));
    const visitRefs = await loadVisitRefsByScheduledVisitIds(this.prisma, visitIds);
    const ackIds = [
      ...new Set(
        rows.map((row) => row.acknowledgedById).filter((id): id is string => Boolean(id)),
      ),
    ];
    const ackUsers =
      ackIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: ackIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          });
    const ackNames = new Map(
      ackUsers.map((user) => [user.id, displayUserName(user) ?? user.id]),
    );
    return {
      data: rows.map((r) => {
        const start = r.scheduledJob.scheduledStartDateTime;
        const end = r.scheduledJob.scheduledEndDateTime;
        const carers = r.scheduledJob.allocations.map((a) => {
          const name = [a.employee.personalDetail?.firstName, a.employee.personalDetail?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
          return {
            employeeId: a.employee.id,
            name: name || a.employee.id,
            isLeadCarer: a.isLeadCarer,
          };
        });
        return {
          id: r.id,
          scheduledJobId: r.scheduledJobId,
          kind: r.kind,
          lifecycle: r.lifecycle,
          title: r.title,
          detail: r.detail,
          overdue: r.overdue,
          responseTargetMinutes: r.responseTargetMinutes,
          escalationDeadlineAt: r.escalationDeadlineAt?.toISOString() ?? null,
          acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
          acknowledgedById: r.acknowledgedById,
          acknowledgedByName: r.acknowledgedById
            ? ackNames.get(r.acknowledgedById) ?? null
            : null,
          createdAt: r.createdAt.toISOString(),
          jobName: r.scheduledJob.jobName,
          jobStatus: r.scheduledJob.status,
          visitRef:
            (r.scheduledJob.visits[0]?.id
              ? visitRefs.get(r.scheduledJob.visits[0]!.id)
              : null) ??
            r.scheduledJob.visits[0]?.visitRef ??
            null,
          plannedDate: start.toISOString().slice(0, 10),
          plannedStartDateTime: start.toISOString(),
          plannedEndDateTime: end?.toISOString() ?? null,
          carers,
          serviceUserId: r.scheduledJob.serviceUserId,
          serviceUserName:
            r.scheduledJob.serviceUser.preferredName?.trim() ||
            [r.scheduledJob.serviceUser.firstName, r.scheduledJob.serviceUser.lastName]
              .filter(Boolean)
              .join(' '),
          clockedInAt:
            r.scheduledJob.visits[0]?.actualStartDateTime?.toISOString() ?? null,
          hasMockLocation:
            r.kind === EcmExceptionKind.MOCK_LOCATION ||
            mockedJobIds.has(r.scheduledJobId) ||
            (r.kind === EcmExceptionKind.CARER_SOS &&
              Boolean(parseCarerSosContext(r.context).isMockedLocation)),
          areaLock: r.visitAreaLock
            ? {
                status: r.visitAreaLock.status,
                lockedAt: r.visitAreaLock.lockedAt.toISOString(),
                allowedAt: r.visitAreaLock.allowedAt?.toISOString() ?? null,
                allowedByName: r.visitAreaLock.allowedByName,
                allowNote: r.visitAreaLock.allowNote,
                employeeId: r.visitAreaLock.employeeId,
                latitude: toCoord(r.visitAreaLock.latitude),
                longitude: toCoord(r.visitAreaLock.longitude),
                distanceMeters: r.visitAreaLock.distanceMeters,
              }
            : null,
          checkInLocation: checkInLocations.get(r.scheduledJobId) ?? null,
          sos:
            r.kind === EcmExceptionKind.CARER_SOS
              ? mapCarerSosAlert(r, {
                  acknowledgedByName: r.acknowledgedById
                    ? ackNames.get(r.acknowledgedById) ?? null
                    : null,
                })
              : null,
          checkInMethodRequest: r.checkInMethodGrant
            ? mapVisitCheckInMethodGrant(r.checkInMethodGrant, {
                employeeName:
                  carers.find((c) => c.employeeId === r.checkInMethodGrant?.employeeId)
                    ?.name ?? null,
              })
            : null,
        };
      }),
    };
  }

  async acknowledge(id: string, userId: string, note?: string) {
    const row = await this.requireOpen(id);
    const firstAck = !row.acknowledgedAt;
    const updated = await this.prisma.ecmException.update({
      where: { id },
      data: {
        lifecycle: EcmExceptionLifecycle.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgedById: userId,
        ownerUserId: row.ownerUserId ?? userId,
        firstActionAt: row.firstActionAt ?? new Date(),
        resolutionNote: note?.trim() || row.resolutionNote,
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_ACKNOWLEDGED,
      scheduledJobId: updated.scheduledJobId,
      ecmExceptionId: updated.id,
      actorUserId: userId,
      summary: `Exception acknowledged: ${updated.kind}`,
      detail: { note: note ?? null },
    });
    let fcm: FcmSendReport;
    if (!firstAck) {
      fcm = fcmReport({ ready: false, reason: 'NOT_FIRST_ACK' });
    } else if (updated.kind !== EcmExceptionKind.CARER_SOS) {
      fcm = fcmReport({ ready: false, reason: 'NOT_SOS' });
    } else {
      const employeeId = parseCarerSosContext(updated.context).employeeId?.trim();
      if (!employeeId) {
        fcm = fcmReport({ ready: false, reason: 'NO_EMPLOYEE' });
      } else {
        fcm = await this.carerPush.notifySafe({
          employeeIds: [employeeId],
          kind: CarerVisitPushKind.SOS_ACKNOWLEDGED,
          title: 'Office acknowledged your SOS',
          body: 'The office has seen your alert and is responding.',
          scheduledJobId: updated.scheduledJobId,
        });
      }
    }
    return { ...updated, fcm };
  }

  async resolve(id: string, userId: string, reasonCode: string, note?: string) {
    const row = await this.requireOpen(id);
    if (!reasonCode?.trim()) {
      throw new BadRequestException('reasonCode is required');
    }
    if (row.kind === EcmExceptionKind.CARER_SOS) {
      const outcome = reasonCode.trim().toUpperCase();
      if (!isSosOutcomeCode(outcome) && !sosOutcomeLabel(outcome)) {
        throw new BadRequestException('Choose a SOS outcome');
      }
      reasonCode = outcome;
    }
    const updated = await this.prisma.ecmException.update({
      where: { id },
      data: {
        lifecycle: EcmExceptionLifecycle.RESOLVED,
        reasonCode: reasonCode.trim(),
        resolutionNote: note?.trim() || null,
        resolvedAt: new Date(),
        resolvedById: userId,
        firstActionAt: row.firstActionAt ?? new Date(),
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_RESOLVED,
      scheduledJobId: updated.scheduledJobId,
      ecmExceptionId: updated.id,
      actorUserId: userId,
      summary: `Exception resolved: ${updated.kind} (${reasonCode.trim()})`,
      detail: { reasonCode: reasonCode.trim(), note: note ?? null },
    });
    return updated;
  }

  async closeSos(
    id: string,
    userId: string,
    actionCode: string,
    outcomeCode: string,
    note?: string,
    actionNote?: string,
  ) {
    const row = await this.requireOpen(id);
    if (row.kind !== EcmExceptionKind.CARER_SOS) {
      throw new BadRequestException('Only a carer SOS can be closed with an outcome');
    }
    if (!row.acknowledgedAt) {
      throw new BadRequestException('Acknowledge the SOS before closing');
    }
    const parsed = parseSosClosePayload(actionCode, outcomeCode, note, actionNote);
    if (!parsed.ok) throw new BadRequestException(parsed.message);

    const now = new Date();
    const nextContext = {
      ...parseCarerSosContext(row.context),
      officeActionCode: parsed.actionCode,
      officeActionNote: parsed.actionNote,
    };
    const updated = await this.prisma.ecmException.update({
      where: { id },
      data: {
        lifecycle: EcmExceptionLifecycle.CLOSED,
        reasonCode: parsed.outcomeCode,
        resolutionNote: parsed.note ?? row.resolutionNote,
        context: nextContext as Prisma.InputJsonValue,
        resolvedAt: row.resolvedAt ?? now,
        resolvedById: row.resolvedById ?? userId,
        closedAt: now,
        closedById: userId,
        firstActionAt: row.firstActionAt ?? now,
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_RESOLVED,
      scheduledJobId: updated.scheduledJobId,
      ecmExceptionId: updated.id,
      actorUserId: userId,
      summary: `SOS resolved: ${updated.kind} (${parsed.outcomeCode})`,
      detail: {
        actionCode: parsed.actionCode,
        reasonCode: parsed.outcomeCode,
        note: parsed.note,
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_CLOSED,
      scheduledJobId: updated.scheduledJobId,
      ecmExceptionId: updated.id,
      actorUserId: userId,
      summary: `SOS closed: ${parsed.outcomeCode}`,
      detail: {
        actionCode: parsed.actionCode,
        reasonCode: parsed.outcomeCode,
        note: parsed.note,
      },
    });
    return updated;
  }

  async listSosForVisit(scheduledJobId: string) {
    const rows = await this.prisma.ecmException.findMany({
      where: { scheduledJobId, kind: EcmExceptionKind.CARER_SOS },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        detail: true,
        lifecycle: true,
        createdAt: true,
        context: true,
        acknowledgedAt: true,
        acknowledgedById: true,
        reasonCode: true,
        resolutionNote: true,
        closedAt: true,
        closedById: true,
      },
    });
    const nameIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.acknowledgedById, row.closedById])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const users =
      nameIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: nameIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          });
    const names = new Map(users.map((user) => [user.id, displayUserName(user) ?? user.id]));
    return {
      data: rows.map((row) =>
        mapCarerSosAlert(row, {
          acknowledgedByName: row.acknowledgedById
            ? names.get(row.acknowledgedById) ?? null
            : null,
          closedByName: row.closedById ? names.get(row.closedById) ?? null : null,
        }),
      ),
    };
  }

  async close(id: string, userId: string, note?: string) {
    const row = await this.prisma.ecmException.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Exception not found');
    if (
      row.lifecycle !== EcmExceptionLifecycle.RESOLVED &&
      row.lifecycle !== EcmExceptionLifecycle.MANAGER_REVIEWED
    ) {
      throw new BadRequestException('Resolve the exception before closing');
    }
    const updated = await this.prisma.ecmException.update({
      where: { id },
      data: {
        lifecycle: EcmExceptionLifecycle.CLOSED,
        closedAt: new Date(),
        closedById: userId,
        resolutionNote: note?.trim() || row.resolutionNote,
      },
    });
    await this.audit.append({
      eventType: EcmAuditEventType.EXCEPTION_CLOSED,
      scheduledJobId: updated.scheduledJobId,
      ecmExceptionId: updated.id,
      actorUserId: userId,
      summary: `Exception closed: ${updated.kind}`,
      detail: { note: note ?? null },
    });
    return updated;
  }

  private async requireOpen(id: string) {
    const row = await this.prisma.ecmException.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Exception not found');
    if (!OPEN_LIFECYCLES.includes(row.lifecycle)) {
      throw new BadRequestException(`Exception is already ${row.lifecycle}`);
    }
    return row;
  }

  private async loadCheckInLocationsByJobIds(jobIds: string[]): Promise<
    Map<
      string,
      {
        latitude: number
        longitude: number
        accuracyMeters: number | null
        distanceMeters: number | null
        outsideGeofence: boolean
        isMockLocation: boolean
        occurredAt: string
        employeeId: string
      }
    >
  > {
    const unique = [...new Set(jobIds.filter(Boolean))];
    const map = new Map<
      string,
      {
        latitude: number
        longitude: number
        accuracyMeters: number | null
        distanceMeters: number | null
        outsideGeofence: boolean
        isMockLocation: boolean
        occurredAt: string
        employeeId: string
      }
    >();
    if (unique.length === 0) return map;
    const events = await this.prisma.visitAttendanceEvent.findMany({
      where: {
        scheduledJobId: { in: unique },
        eventType: VisitAttendanceEventType.CHECK_IN,
      },
      orderBy: { occurredAt: 'desc' },
      select: {
        scheduledJobId: true,
        employeeId: true,
        occurredAt: true,
        latitude: true,
        longitude: true,
        accuracyMeters: true,
        distanceMeters: true,
        outsideGeofence: true,
        isMockLocation: true,
      },
    });
    for (const event of events) {
      if (map.has(event.scheduledJobId)) continue;
      const latitude = toCoord(event.latitude);
      const longitude = toCoord(event.longitude);
      if (latitude == null || longitude == null) continue;
      map.set(event.scheduledJobId, {
        latitude,
        longitude,
        accuracyMeters: toCoord(event.accuracyMeters),
        distanceMeters: event.distanceMeters,
        outsideGeofence: event.outsideGeofence,
        isMockLocation: event.isMockLocation,
        occurredAt: event.occurredAt.toISOString(),
        employeeId: event.employeeId,
      });
    }
    return map;
  }

  private async mockedVisitJobIds(jobIds: string[]): Promise<Set<string>> {
    const unique = [...new Set(jobIds.filter(Boolean))];
    if (unique.length === 0) return new Set();
    const events = await this.prisma.visitAttendanceEvent.findMany({
      where: {
        scheduledJobId: { in: unique },
        isMockLocation: true,
      },
      select: { scheduledJobId: true },
    });
    return new Set(events.map((event) => event.scheduledJobId));
  }
}
