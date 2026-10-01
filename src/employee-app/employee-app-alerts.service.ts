import { Injectable } from '@nestjs/common';
import {
  InitialAssessmentRiskStatus,
  ServiceUserMedicalConditionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeAppClientsService } from './employee-app-clients.service';
import {
  compareAlertsByTier,
  countCriticalAlerts,
  mapAllergiesToAlert,
  mapDnacprToAlert,
  mapIaRiskToAlert,
  mapMedicalAlertToAlert,
  mapMedicalConditionToAlert,
  mapReasonableAdjustmentToAlert,
  type ServiceUserAlertItem,
} from './service-user-alert-mapping.util';
import { loadCprIaReport, resolveCprStatus } from './employee-app-cpr-status.util';
import { CARER_VISIBLE_RISK_WHERE, withoutUnreviewedIaRows } from './employee-app-ia-source.util';

/**
 * Aggregates service-user safety alerts for the carer app into one prioritised feed.
 * Read-only. Office flash messages are not included here — they appear on the visit
 * overview as a dedicated Office note.
 * Sources: allergies, DNACPR, medical conditions, medical alerts, reasonable
 * adjustments, and open IA risk records.
 */
@Injectable()
export class EmployeeAppAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientsService: EmployeeAppClientsService,
  ) {}

  async getAlerts(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);

    const [allergies, legal, conditions, medicalAlerts, adjustments, risks] =
      await Promise.all([
      this.prisma.serviceUserAllergy.findMany({
        where: { serviceUserId: clientId, deletedAt: null, isActive: true },
        select: { allergyName: true },
        orderBy: { allergyName: 'asc' },
      }),
      this.prisma.serviceUserLegalDocument.findUnique({
        where: { serviceUserId: clientId },
        select: { dnacprInPlace: true, dnacprStatusConfirmation: true, dnacprPhysicalLocation: true },
      }),
      this.prisma.serviceUserMedicalCondition.findMany({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          isActive: true,
          status: ServiceUserMedicalConditionStatus.ACTIVE,
        },
        select: { id: true, notes: true, sourceSubmissionId: true, condition: { select: { code: true, name: true } } },
      }).then((rows) => withoutUnreviewedIaRows(this.prisma, rows)),
      this.prisma.serviceUserMedicalAlert.findMany({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          title: true,
          category: true,
          severity: true,
          description: true,
          actionForCarer: true,
          notes: true,
        },
        orderBy: [{ severity: 'asc' }, { updatedAt: 'desc' }],
      }),
      this.prisma.serviceUserReasonableAdjustment.findMany({
        where: { serviceUserId: clientId, deletedAt: null, isActive: true },
        select: { id: true, description: true, notes: true },
      }),
      this.prisma.initialAssessmentRiskRecord.findMany({
        where: {
          serviceUserId: clientId,
          status: InitialAssessmentRiskStatus.OPEN,
          ...CARER_VISIBLE_RISK_WHERE,
        },
        select: { id: true, riskType: true, riskLevel: true, description: true },
      }),
    ]);

    const alerts: ServiceUserAlertItem[] = [];

    const allergyAlert = mapAllergiesToAlert(allergies.map((a) => a.allergyName));
    if (allergyAlert) alerts.push(allergyAlert);

    const dnacpr = mapDnacprToAlert(
      resolveCprStatus(legal, await loadCprIaReport(this.prisma, clientId)),
    );
    if (dnacpr) alerts.push(dnacpr);

    for (const c of conditions) {
      if (!c.condition) continue;
      alerts.push(
        mapMedicalConditionToAlert({
          id: c.id,
          code: c.condition.code,
          name: c.condition.name,
          notes: c.notes,
        }),
      );
    }

    for (const row of medicalAlerts) {
      const a = mapMedicalAlertToAlert(row);
      if (a) alerts.push(a);
    }

    for (const adj of adjustments) {
      const a = mapReasonableAdjustmentToAlert({
        id: adj.id,
        description: adj.description,
        notes: adj.notes,
      });
      if (a) alerts.push(a);
    }

    // Active flash / office note is surfaced on the visit overview as its own
    // "Office note" card — keep it out of the Safety & alerts feed.

    for (const r of risks) {
      const a = mapIaRiskToAlert({
        id: r.id,
        riskType: r.riskType,
        riskLevel: r.riskLevel,
        description: r.description,
      });
      if (a) alerts.push(a);
    }

    // Stable sort by tier (CRITICAL → IMPORTANT → INFO); order within a tier is insertion order.
    const sorted = alerts
      .map((alert, index) => ({ alert, index }))
      .sort((a, b) => compareAlertsByTier(a.alert, b.alert) || a.index - b.index)
      .map((entry) => entry.alert);

    return {
      data: {
        criticalCount: countCriticalAlerts(sorted),
        total: sorted.length,
        alerts: sorted,
      },
    };
  }
}
