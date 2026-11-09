import { Injectable } from '@nestjs/common';
import {
  InitialAssessmentRiskLevel,
  InitialAssessmentRiskStatus,
  ServiceUserMedicalConditionStatus,
} from '@prisma/client';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertServiceUserAccessible, userHasPermission } from './medical-access.util';

/**
 * Read-model composition for Medical Conditions & Alerts screen.
 * Does not invent a second SoT table.
 */
@Injectable()
export class MedicalSafetySummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async getSummary(user: RequestUser, serviceUserId: string) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);

    const sourcesIncluded: string[] = [];
    const sourcesOmitted: string[] = [];

    const include = (key: string, permitted: boolean) => {
      if (permitted) sourcesIncluded.push(key);
      else sourcesOmitted.push(key);
      return permitted;
    };

    const canConditions = include(
      'medicalConditions',
      userHasPermission(user, 'service_users.medical_conditions.read'),
    );
    const canAdjustments = include(
      'reasonableAdjustments',
      userHasPermission(user, 'service_users.medical_adjustments.read'),
    );
    const canHistory = include(
      'medicalHistory',
      userHasPermission(user, 'service_users.medical_history.read'),
    );
    const canMonitoring = include(
      'monitoringConfig',
      userHasPermission(user, 'service_users.medical_monitoring.read'),
    );
    const canUsual = include(
      'usualParameters',
      userHasPermission(user, 'service_users.medical_usual_parameters.read'),
    );
    const canAllergies = include(
      'allergies',
      userHasPermission(user, 'service_users.allergies.read', 'service_users.read'),
    );
    const canMedAllergies = include(
      'medicationAllergies',
      userHasPermission(
        user,
        'service_users.medications.allergies.read',
        'service_users.medications.read',
        'service_users.read',
      ),
    );
    const canFlash = include(
      'flashMessage',
      userHasPermission(user, 'service_users.flash_message.read', 'service_users.read'),
    );
    const canRisk = include(
      'riskLevel',
      userHasPermission(user, 'service_users.read'),
    );
    const canLegal = include(
      'legalDocuments',
      userHasPermission(user, 'service_users.documents.read', 'service_users.read'),
    );
    const canIaRisks = include(
      'initialAssessmentRisks',
      userHasPermission(user, 'service_users.assessments.read', 'service_users.read'),
    );
    const canBodyMap = include(
      'bodyMapAlerts',
      userHasPermission(user, 'service_users.body_map.read', 'service_users.read'),
    );

    const now = new Date();

    const [
      medicalConditions,
      reasonableAdjustments,
      medicalHistory,
      monitoringConfig,
      usualParameters,
      allergies,
      medicationAllergies,
      flashMessage,
      serviceUserCore,
      legalDocuments,
      initialAssessmentRisks,
      bodyMapAlerts,
    ] = await Promise.all([
      canConditions
        ? this.prisma.serviceUserMedicalCondition.findMany({
            where: {
              serviceUserId,
              deletedAt: null,
              status: ServiceUserMedicalConditionStatus.ACTIVE,
            },
            include: {
              condition: { select: { id: true, code: true, name: true, category: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take: 50,
          })
        : Promise.resolve(null),
      canAdjustments
        ? this.prisma.serviceUserReasonableAdjustment.findMany({
            where: { serviceUserId, deletedAt: null, isActive: true },
            orderBy: { updatedAt: 'desc' },
            take: 50,
          })
        : Promise.resolve(null),
      canHistory
        ? this.prisma.serviceUserMedicalHistoryEvent.findMany({
            where: { serviceUserId, deletedAt: null, isActive: true },
            orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
            take: 20,
          })
        : Promise.resolve(null),
      canMonitoring
        ? this.prisma.serviceUserMonitoringConfig.findMany({
            where: { serviceUserId, enabled: true },
            orderBy: { configKey: 'asc' },
          })
        : Promise.resolve(null),
      canUsual
        ? this.prisma.serviceUserUsualParameter.findMany({
            where: { serviceUserId, enabled: true },
            include: {
              observationType: { select: { id: true, code: true, name: true } },
            },
            orderBy: { updatedAt: 'desc' },
          })
        : Promise.resolve(null),
      canAllergies
        ? this.prisma.serviceUserAllergy.findMany({
            where: { serviceUserId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve(null),
      // Medicine allergies are now part of the one allergy list above; the old separate list is no longer used.
      canMedAllergies
        ? Promise.resolve([] as { id: string; allergyName: string; reaction: string | null; severity: string | null }[])
        : Promise.resolve(null),
      canFlash
        ? this.prisma.serviceUserFlashMessage.findFirst({
            where: {
              serviceUserId,
              deletedAt: null,
              isCurrent: true,
              clearedAt: null,
              displayUntil: { gt: now },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve(null),
      canRisk
        ? this.prisma.serviceUser.findFirst({
            where: { id: serviceUserId, deletedAt: null },
            select: {
              id: true,
              riskLevel: { select: { id: true, code: true, name: true, color: true } },
            },
          })
        : Promise.resolve(null),
      canLegal
        ? this.prisma.serviceUserLegalDocument.findUnique({
            where: { serviceUserId },
            select: {
              id: true,
              dnacprInPlace: true,
              dnacprStatusConfirmation: true,
              dnacprPhysicalLocation: true,
              dnacprStartDate: true,
              lpaStatusConfirmation: true,
            },
          })
        : Promise.resolve(null),
      canIaRisks
        ? this.prisma.initialAssessmentRiskRecord.findMany({
            where: {
              serviceUserId,
              status: InitialAssessmentRiskStatus.OPEN,
              riskLevel: InitialAssessmentRiskLevel.HIGH,
            },
            orderBy: { updatedAt: 'desc' },
            take: 20,
            select: {
              id: true,
              description: true,
              riskType: true,
              riskLevel: true,
              status: true,
              updatedAt: true,
            },
          })
        : Promise.resolve(null),
      canBodyMap
        ? this.prisma.bodyMapAlert.findMany({
            where: {
              serviceUserId,
              dismissedAt: null,
            },
            orderBy: { updatedAt: 'desc' },
            take: 20,
            select: {
              id: true,
              alertType: true,
              severity: true,
              message: true,
              updatedAt: true,
            },
          })
        : Promise.resolve(null),
    ]);

    return {
      data: {
        serviceUserId,
        medicalConditions: medicalConditions
          ? medicalConditions.map((r) => ({
              id: r.id,
              status: r.status,
              condition: r.condition,
              onsetDate: r.onsetDate?.toISOString().slice(0, 10) ?? null,
              reviewDate: r.reviewDate?.toISOString().slice(0, 10) ?? null,
              source: r.source,
            }))
          : undefined,
        reasonableAdjustments: reasonableAdjustments
          ? reasonableAdjustments.map((r) => ({
              id: r.id,
              type: r.type,
              description: r.description,
              source: r.source,
            }))
          : undefined,
        medicalHistory: medicalHistory
          ? medicalHistory.map((r) => ({
              id: r.id,
              title: r.title,
              eventDate: r.eventDate?.toISOString().slice(0, 10) ?? null,
              approximateDate: r.approximateDate,
            }))
          : undefined,
        monitoringConfig: monitoringConfig
          ? monitoringConfig.map((r) => ({
              id: r.id,
              configKey: r.configKey,
              enabled: r.enabled,
              numericValue: r.numericValue != null ? Number(r.numericValue.toString()) : null,
              booleanValue: r.booleanValue,
            }))
          : undefined,
        usualParameters: usualParameters
          ? usualParameters.map((r) => ({
              id: r.id,
              observationType: r.observationType,
              usualNumericValue:
                r.usualNumericValue != null ? Number(r.usualNumericValue.toString()) : null,
              usualTextValue: r.usualTextValue,
              lowerBand: r.lowerBand != null ? Number(r.lowerBand.toString()) : null,
              upperBand: r.upperBand != null ? Number(r.upperBand.toString()) : null,
            }))
          : undefined,
        allergies: allergies
          ? allergies.map((r) => ({
              id: r.id,
              allergyName: r.allergyName,
              comment: r.comment,
            }))
          : undefined,
        medicationAllergies: medicationAllergies
          ? medicationAllergies.map((r) => ({
              id: r.id,
              allergyName: r.allergyName,
              reaction: r.reaction,
              severity: r.severity,
            }))
          : undefined,
        flashMessage: canFlash
          ? flashMessage
            ? {
                id: flashMessage.id,
                message: flashMessage.message,
                displayUntil: flashMessage.displayUntil?.toISOString() ?? null,
                updatedAt: flashMessage.updatedAt.toISOString(),
              }
            : null
          : undefined,
        riskLevel: canRisk ? (serviceUserCore?.riskLevel ?? null) : undefined,
        legalDocuments: canLegal
          ? legalDocuments
            ? {
                id: legalDocuments.id,
                dnacprInPlace: legalDocuments.dnacprInPlace,
                dnacprStatusConfirmation: legalDocuments.dnacprStatusConfirmation,
                dnacprPhysicalLocation: legalDocuments.dnacprPhysicalLocation,
                dnacprStartDate: legalDocuments.dnacprStartDate?.toISOString().slice(0, 10) ?? null,
                lpaStatusConfirmation: legalDocuments.lpaStatusConfirmation,
              }
            : null
          : undefined,
        initialAssessmentRisks: initialAssessmentRisks
          ? initialAssessmentRisks.map((r) => ({
              id: r.id,
              description: r.description,
              riskType: r.riskType,
              riskLevel: r.riskLevel,
              status: r.status,
              updatedAt: r.updatedAt.toISOString(),
            }))
          : undefined,
        bodyMapAlerts: bodyMapAlerts
          ? bodyMapAlerts.map((r) => ({
              id: r.id,
              alertType: r.alertType,
              severity: r.severity,
              message: r.message,
              updatedAt: r.updatedAt.toISOString(),
            }))
          : undefined,
        meta: {
          sourcesIncluded,
          sourcesOmitted,
          composedAt: now.toISOString(),
        },
      },
    };
  }
}
