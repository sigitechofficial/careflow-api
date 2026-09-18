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
    const items = sortTimelineRows(rows).map((row) => mapRowToTimelineApiItem(row, timeZone));
    return this.enrichObservationDetails(items);
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
}
