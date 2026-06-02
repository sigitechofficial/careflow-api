import { Injectable } from '@nestjs/common';
import { BodyMapAlertSeverity, BodyMapRecordStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeBodyMapOutstandingGaps } from './body-map-gaps.util';

const GAP_META: Record<string, { severity: BodyMapAlertSeverity }> = {
  REVIEW_OVERDUE: { severity: BodyMapAlertSeverity.HIGH },
  MAR_DOSE_UNLINKED: { severity: BodyMapAlertSeverity.MEDIUM },
  MISSING_INCIDENT_LINK: { severity: BodyMapAlertSeverity.HIGH },
  MISSING_CARE_PLAN_LINK: { severity: BodyMapAlertSeverity.MEDIUM },
  NO_ACTION_RECORDED: { severity: BodyMapAlertSeverity.LOW },
};

@Injectable()
export class BodyMapAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async syncForServiceUser(serviceUserId: string): Promise<void> {
    const records = await this.prisma.bodyMapRecord.findMany({
      where: {
        serviceUserId,
        status: {
          notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED],
        },
      },
      select: {
        id: true,
        recordType: true,
        subType: true,
        status: true,
        nextReviewAt: true,
        actionSummary: true,
        medicationSite: { select: { lastAdministrationEventId: true } },
        links: { select: { linkedModule: true } },
      },
    });

    const gaps = computeBodyMapOutstandingGaps(
      records.map(r => ({
        id: r.id,
        recordType: r.recordType,
        subType: r.subType,
        status: r.status,
        nextReviewAt: r.nextReviewAt?.toISOString() ?? null,
        medicationSite: r.medicationSite,
        links: r.links,
        actionSummary: r.actionSummary,
      })),
    );

    const activeKeys = new Set(gaps.map(g => `${g.recordId}:${g.code}`));

    for (const gap of gaps) {
      const meta = GAP_META[gap.code] ?? { severity: BodyMapAlertSeverity.MEDIUM };
      const existing = await this.prisma.bodyMapAlert.findFirst({
        where: {
          bodyMapRecordId: gap.recordId,
          alertType: gap.code,
          dismissedAt: null,
        },
      });
      if (existing) {
        if (existing.message !== gap.message || existing.severity !== meta.severity) {
          await this.prisma.bodyMapAlert.update({
            where: { id: existing.id },
            data: { message: gap.message, severity: meta.severity },
          });
        }
      } else {
        await this.prisma.bodyMapAlert.create({
          data: {
            serviceUserId,
            bodyMapRecordId: gap.recordId,
            alertType: gap.code,
            severity: meta.severity,
            message: gap.message,
          },
        });
      }
    }

    const openAlerts = await this.prisma.bodyMapAlert.findMany({
      where: { serviceUserId, dismissedAt: null, bodyMapRecordId: { not: null } },
      select: { id: true, bodyMapRecordId: true, alertType: true },
    });

    for (const alert of openAlerts) {
      const key = `${alert.bodyMapRecordId}:${alert.alertType}`;
      if (!activeKeys.has(key)) {
        await this.prisma.bodyMapAlert.update({
          where: { id: alert.id },
          data: { dismissedAt: new Date() },
        });
      }
    }
  }

  async listForServiceUser(serviceUserId: string) {
    await this.syncForServiceUser(serviceUserId);
    const rows = await this.prisma.bodyMapAlert.findMany({
      where: { serviceUserId, dismissedAt: null },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      include: {
        bodyMapRecord: { select: { id: true, recordType: true, subType: true, title: true } },
      },
    });
    return rows.map(a => ({
      id: a.id,
      serviceUserId: a.serviceUserId,
      bodyMapRecordId: a.bodyMapRecordId,
      alertType: a.alertType,
      severity: a.severity,
      message: a.message,
      createdAt: a.createdAt.toISOString(),
      record: a.bodyMapRecord
        ? {
            id: a.bodyMapRecord.id,
            recordType: a.bodyMapRecord.recordType,
            subType: a.bodyMapRecord.subType,
            title: a.bodyMapRecord.title,
          }
        : null,
    }));
  }

  async listBranchGovernanceAlerts(limit = 100) {
    const openRecords = await this.prisma.bodyMapRecord.findMany({
      where: {
        isArchived: false,
        status: { notIn: [BodyMapRecordStatus.CLOSED, BodyMapRecordStatus.RESOLVED] },
      },
      select: { serviceUserId: true },
      distinct: ['serviceUserId'],
      take: 80,
    });
    await Promise.all(
      openRecords.map(r => this.syncForServiceUser(r.serviceUserId)),
    );

    const rows = await this.prisma.bodyMapAlert.findMany({
      where: { dismissedAt: null },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        bodyMapRecord: {
          select: { id: true, recordType: true, subType: true, title: true },
        },
        serviceUser: {
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        },
      },
    });

    return {
      total: rows.length,
      alerts: rows.map(a => ({
        id: a.id,
        serviceUserId: a.serviceUserId,
        bodyMapRecordId: a.bodyMapRecordId,
        alertType: a.alertType,
        severity: a.severity,
        message: a.message,
        createdAt: a.createdAt.toISOString(),
        serviceUserName: [a.serviceUser.preferredName, a.serviceUser.firstName, a.serviceUser.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || null,
        record: a.bodyMapRecord
          ? {
              id: a.bodyMapRecord.id,
              recordType: a.bodyMapRecord.recordType,
              subType: a.bodyMapRecord.subType,
              title: a.bodyMapRecord.title,
            }
          : null,
      })),
    };
  }

  async dismiss(alertId: string, userId: string) {
    const alert = await this.prisma.bodyMapAlert.findUnique({ where: { id: alertId } });
    if (!alert) return null;
    if (alert.dismissedAt) return { id: alert.id, dismissedAt: alert.dismissedAt.toISOString() };
    const updated = await this.prisma.bodyMapAlert.update({
      where: { id: alertId },
      data: { dismissedAt: new Date(), dismissedById: userId },
    });
    return { id: updated.id, dismissedAt: updated.dismissedAt!.toISOString() };
  }
}
