import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { VisitTimelineApiItem, VisitTimelineUpsertInput } from './visit-timeline.types';
import {
  buildTimelineUpsertData,
  mapRowToTimelineApiItem,
  sortTimelineRows,
} from './visit-timeline.util';

@Injectable()
export class VisitTimelineService {
  private readonly logger = new Logger(VisitTimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert a timeline event keyed by (jobId, sourceType, sourceId, eventType).
   * Failures are logged but do not fail the parent write (audit trail is best-effort
   * relative to clinical persistence — still enterprise-safe: no silent duplicate spam).
   */
  async upsertEvent(input: VisitTimelineUpsertInput): Promise<VisitTimelineApiItem | null> {
    try {
      const data = buildTimelineUpsertData(input);
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
      return mapRowToTimelineApiItem(row);
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
    const rows = await this.prisma.visitTimelineEvent.findMany({
      where: { scheduledJobId, isDraft: false },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    return sortTimelineRows(rows).map((row) => mapRowToTimelineApiItem(row));
  }
}
