import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import type { VisitTimelineApiItem, VisitTimelineUpsertInput } from './visit-timeline.types';
import {
  buildTimelineUpsertData,
  mapRowToTimelineApiItem,
  observationTimelineDetail,
  sortTimelineRows,
  summarizeTimelineDetail,
} from './visit-timeline.util';

const PREVIOUS_NOTE_TYPES = ['visit_note', 'handover', 'concern'] as const;
export type PreviousVisitNoteKind = (typeof PREVIOUS_NOTE_TYPES)[number];
export type PreviousVisitNotes = {
  jobId: string;
  visitStart: string;
  notes: { kind: PreviousVisitNoteKind; title: string; text: string; at: string }[];
};

@Injectable()
export class VisitTimelineService {
  private readonly logger = new Logger(VisitTimelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /**
   * Upsert a timeline event keyed by (jobId, sourceType, sourceId, eventType).
   * Failures are logged but do not fail the parent write (audit trail is best-effort
   * relative to clinical persistence — still enterprise-safe: no silent duplicate spam).
   */
  async upsertEvent(input: VisitTimelineUpsertInput): Promise<VisitTimelineApiItem | null> {
    try {
      const timeZone = await this.orgSettings.getOperationalTimezone();
      const data = buildTimelineUpsertData(input, timeZone);
      const row = await this.prisma.visitTimelineEvent.upsert({
        where: {
          scheduledJobId_sourceType_sourceId_eventType: {
            scheduledJobId: data.scheduledJobId,
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            eventType: data.eventType,
          },
        },
        create: {
          ...data,
        },
        update: {
          scheduledVisitId: data.scheduledVisitId,
          title: data.title,
          detail: data.detail,
          tone: data.tone,
          occurredAt: data.occurredAt,
          timeLabel: data.timeLabel,
          logEntryId: data.logEntryId,
          isDraft: data.isDraft,
          createdByEmployeeId: data.createdByEmployeeId,
          actorKind: data.actorKind,
          createdByUserId: data.createdByUserId,
          idempotencyKey: data.idempotencyKey,
        },
      });
      return mapRowToTimelineApiItem(row, timeZone);
    } catch (err) {
      this.logger.warn(
        `Failed to upsert visit timeline event job=${input.scheduledJobId} type=${input.eventType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /** Non-draft events for details → data.log.timeline, oldest → newest. */
  async listForJob(scheduledJobId: string): Promise<VisitTimelineApiItem[]> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const rows = await this.prisma.visitTimelineEvent.findMany({
      where: { scheduledJobId, isDraft: false },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const sorted = sortTimelineRows(rows);
    const officeNames = await this.officeUserNames(sorted);
    const items = sorted.map((row) => {
      const item = mapRowToTimelineApiItem(row, timeZone);
      if (row.actorKind !== 'office') return item;
      const userId = row.createdByUserId ?? null;
      return {
        ...item,
        actor: {
          kind: 'office' as const,
          userId,
          name: (userId && officeNames.get(userId)) || 'Office',
        },
      };
    });
    return this.enrichObservationDetails(items);
  }

  /** Display names of the office users on office rows (first + last, else email). */
  private async officeUserNames(
    rows: Array<{ actorKind: string | null; createdByUserId: string | null }>,
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        rows
          .filter((r) => r.actorKind === 'office' && r.createdByUserId)
          .map((r) => r.createdByUserId as string),
      ),
    ];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || 'Office',
      ]),
    );
  }

  /** Re-format observation rows from stored payload so BP shows systolic/diastolic. */
  private async enrichObservationDetails(
    items: VisitTimelineApiItem[],
  ): Promise<VisitTimelineApiItem[]> {
    const ids = [
      ...new Set(
        items
          .filter((item) => item.sourceType === 'observation' || item.type === 'observation')
          .map((item) => item.sourceId)
          .filter((id) => id.length > 0),
      ),
    ];
    if (ids.length === 0) return items;

    const observations = await this.prisma.serviceUserObservation.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        numericValue: true,
        unit: true,
        payload: true,
        observationType: { select: { code: true } },
      },
    });
    if (observations.length === 0) return items;

    const byId = new Map(observations.map((row) => [row.id, row]));
    return items.map((item) => {
      if (item.sourceType !== 'observation' && item.type !== 'observation') return item;
      const row = byId.get(item.sourceId);
      if (!row) return item;
      const payload =
        row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : null;
      const detail = summarizeTimelineDetail(
        observationTimelineDetail({
          typeCode: row.observationType.code,
          numericValue: row.numericValue != null ? Number(row.numericValue) : null,
          unit: row.unit,
          payload,
          value: payload?.value,
          outcome: typeof payload?.outcome === 'string' ? payload.outcome : 'recorded',
          unableReasonCode:
            typeof payload?.unableReasonCode === 'string' ? payload.unableReasonCode : null,
        }),
      );
      if (!detail || detail === item.detail) return item;
      return { ...item, detail, subtitle: detail };
    });
  }

  /**
   * Notes from this person's last visit before this one: visit notes, handover and concerns, plus the
   * notes on the visit record itself (office completion). Skips visits with nothing written.
   * Shown at the top of the admin visit window and in the carer app's visit details.
   */
  async previousVisitNotes(jobId: string): Promise<PreviousVisitNotes | null> {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { serviceUserId: true, scheduledStartDateTime: true },
    });
    if (!job) return null;
    const earlier = await this.prisma.scheduledJob.findMany({
      where: {
        serviceUserId: job.serviceUserId,
        deletedAt: null,
        id: { not: jobId },
        scheduledStartDateTime: { lt: job.scheduledStartDateTime },
        OR: [
          { notes: { not: null } },
          { timelineEvents: { some: { isDraft: false, eventType: { in: [...PREVIOUS_NOTE_TYPES] } } } },
        ],
      },
      orderBy: { scheduledStartDateTime: 'desc' },
      take: 5,
      select: {
        id: true,
        scheduledStartDateTime: true,
        notes: true,
        timelineEvents: {
          where: { isDraft: false, eventType: { in: [...PREVIOUS_NOTE_TYPES] } },
          orderBy: { occurredAt: 'asc' },
          select: { eventType: true, title: true, detail: true, occurredAt: true },
        },
      },
    });
    for (const prev of earlier) {
      const notes: PreviousVisitNotes['notes'] = prev.timelineEvents
        .filter((e) => (e.detail ?? '').trim())
        .map((e) => ({ kind: e.eventType as PreviousVisitNoteKind, title: e.title, text: e.detail!.trim(), at: e.occurredAt.toISOString() }));
      const own = prev.notes?.trim();
      // Office completion notes are also mirrored as a visit_note row; don't show them twice.
      if (own && !notes.some((n) => n.text === own) && !own.startsWith('MANUAL:')) {
        notes.push({ kind: 'visit_note', title: 'Visit note', text: own, at: prev.scheduledStartDateTime.toISOString() });
      }
      if (notes.length) return { jobId: prev.id, visitStart: prev.scheduledStartDateTime.toISOString(), notes };
    }
    return null;
  }
}
