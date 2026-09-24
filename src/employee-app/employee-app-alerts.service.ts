import { Injectable } from '@nestjs/common';
import {
  InitialAssessmentRiskStatus,
  ServiceUserMedicalConditionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeAppClientsService } from './employee-app-clients.service';
import { activeServiceUserFlashMessageWhere } from '../service-user-flash-messages/active-flash-message.util';
import {
  compareAlertsByTier,
  countCriticalAlerts,
  mapAllergiesToAlert,
  mapDnacprToAlert,
  mapFlashMessageToAlert,
  mapIaRiskToAlert,
  mapMedicalConditionToAlert,
  mapReasonableAdjustmentToAlert,
  type ServiceUserAlertItem,
} from './service-user-alert-mapping.util';

/**
 * Aggregates all service-user alerts for the carer app into one prioritised feed.
 * Read-only surfacing of existing data — nothing is captured here.
 * Sources: allergies, DNACPR, admin medical conditions, reasonable adjustments,
 * active flash message, and open Initial Assessment risk records.
 */
@Injectable()
export class EmployeeAppAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientsService: EmployeeAppClientsService,
  ) {}

  async getAlerts(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);

    const [allergies, legal, conditions, adjustments, flash, risks] = await Promise.all([
      this.prisma.serviceUserAllergy.findMany({
        where: { serviceUserId: clientId, deletedAt: null, isActive: true },
        select: { allergyName: true },
        orderBy: { allergyName: 'asc' },
      }),
      this.prisma.serviceUserLegalDocument.findUnique({
        where: { serviceUserId: clientId },
        select: { dnacprInPlace: true, dnacprPhysicalLocation: true },
      }),
      this.prisma.serviceUserMedicalCondition.findMany({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          isActive: true,
          status: ServiceUserMedicalConditionStatus.ACTIVE,
        },
        select: { id: true, notes: true, condition: { select: { code: true, name: true } } },
      }),
      this.prisma.serviceUserReasonableAdjustment.findMany({
        where: { serviceUserId: clientId, deletedAt: null, isActive: true },
        select: { id: true, description: true, notes: true },
      }),
      this.prisma.serviceUserFlashMessage.findFirst({
        where: { serviceUserId: clientId, ...activeServiceUserFlashMessageWhere() },
        select: { id: true, message: true },
      }),
      this.prisma.initialAssessmentRiskRecord.findMany({
        where: { serviceUserId: clientId, status: InitialAssessmentRiskStatus.OPEN },
        select: { id: true, riskType: true, riskLevel: true, description: true },
      }),
    ]);

    const alerts: ServiceUserAlertItem[] = [];

    const allergyAlert = mapAllergiesToAlert(allergies.map((a) => a.allergyName));
    if (allergyAlert) alerts.push(allergyAlert);

    if (legal) {
      const dnacpr = mapDnacprToAlert({
        dnacprInPlace: legal.dnacprInPlace,
        location: legal.dnacprPhysicalLocation,
      });
      if (dnacpr) alerts.push(dnacpr);
    }

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

    for (const adj of adjustments) {
      const a = mapReasonableAdjustmentToAlert({
        id: adj.id,
        description: adj.description,
        notes: adj.notes,
      });
      if (a) alerts.push(a);
    }

    if (flash) {
      const f = mapFlashMessageToAlert({ id: flash.id, message: flash.message });
      if (f) alerts.push(f);
    }

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
