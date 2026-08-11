import { BadRequestException } from '@nestjs/common';
import { BodyMapBodyView, BodyMapRecordType, BodyMapRiskLevel, BodyMapSide } from '@prisma/client';
import type { CreateBodyMapRecordDto } from '../../body-map/dto/create-body-map-record.dto';
import type { EmployeeAppBodyMapWizardSubmitDto } from '../dto/employee-app-body-map-wizard.dto';

export function recordViewToApiBodyView(recordView: string): BodyMapBodyView {
  if (recordView === 'leaning' || recordView === 'sitting') return BodyMapBodyView.FRONT;
  if (recordView === 'back' || recordView === 'head_back' || recordView === 'torso_back') {
    return BodyMapBodyView.BACK;
  }
  if (recordView === 'face') return BodyMapBodyView.FACE;
  if (recordView.startsWith('hand_')) return BodyMapBodyView.HAND;
  if (recordView.startsWith('foot_')) return BodyMapBodyView.FOOT;
  if (recordView === 'arm_l' || recordView === 'leg_l') return BodyMapBodyView.LEFT;
  if (recordView === 'arm_r' || recordView === 'leg_r') return BodyMapBodyView.RIGHT;
  return BodyMapBodyView.FRONT;
}

export function prototypeSideToApi(side: string | undefined): BodyMapSide | undefined {
  if (!side) return undefined;
  const s = side.trim().toLowerCase();
  if (s === 'left') return BodyMapSide.LEFT;
  if (s === 'right') return BodyMapSide.RIGHT;
  return BodyMapSide.CENTRE;
}

export function wizardNeedsSafeguarding(input: {
  recordType: BodyMapRecordType;
  subType?: string;
  causeKnown?: string;
  consistentWithInjury?: string;
}): boolean {
  if (input.recordType !== BodyMapRecordType.INJURY && input.recordType !== BodyMapRecordType.SAFEGUARDING) {
    return false;
  }
  const sub = (input.subType ?? '').toLowerCase();
  return (
    sub.includes('unexplained') ||
    input.causeKnown === 'no' ||
    input.consistentWithInjury === 'no'
  );
}

export function mapWizardSubmitToCreateDto(
  jobId: string,
  visitId: string,
  serviceUserId: string,
  employeeId: string,
  dto: EmployeeAppBodyMapWizardSubmitDto,
): CreateBodyMapRecordDto {
  const marker = dto.marker;
  if (!marker?.bodyPart?.trim()) {
    throw new BadRequestException('marker.bodyPart is required');
  }
  if (marker.x == null || marker.y == null) {
    throw new BadRequestException('marker x/y coordinates are required (0–100)');
  }

  const type = dto.type;
  const location = dto.location;
  const observation = dto.observation;
  const cause = dto.cause;
  const action = dto.action;

  if (!type?.subType?.trim()) throw new BadRequestException('type.subType is required');
  if (!observation?.description?.trim()) {
    throw new BadRequestException('observation.description is required');
  }
  if (!action?.actionSummary?.trim()) {
    throw new BadRequestException('action.actionSummary is required');
  }

  const recordType = type.recordType;
  if (recordType === BodyMapRecordType.MEDICATION && !dto.medicationSite?.serviceUserMedicationId) {
    throw new BadRequestException('medicationSite.serviceUserMedicationId is required for MEDICATION records');
  }

  const safeguardingTriggered =
    dto.safeguardingTriggered ??
    wizardNeedsSafeguarding({
      recordType,
      subType: type.subType,
      causeKnown: cause?.causeKnown,
      consistentWithInjury: cause?.consistentWithInjury,
    });

  if (safeguardingTriggered && !dto.safeguardingCheck) {
    throw new BadRequestException('safeguardingCheck is required when safeguarding is triggered');
  }

  const observationDetails: Record<string, unknown> = {
    ...(dto.observationDetailsExtra ?? {}),
    purpose: type.purpose ?? 'New observation',
    noticedDuring: type.noticedDuring ?? 'Visit',
    painLevel: observation.painLevel ?? undefined,
    skinIntact: observation.skinIntact ?? undefined,
    causeKnown: cause?.causeKnown ?? undefined,
    consistentWithInjury: cause?.consistentWithInjury ?? undefined,
    managerInformed: action.managerInformed ?? undefined,
    reviewRequired: action.reviewRequired !== 'no',
    recordView: marker.recordView,
    canvasView: marker.canvasView,
    regionId: marker.regionId ?? undefined,
    recordedDuringVisit: true,
    scheduledJobId: jobId,
    scheduledVisitId: visitId,
    recordedByEmployeeId: employeeId,
    channel: 'employee_app',
    wizardVersion: 1,
    ...(dto.clientEntryId ? { clientEntryId: dto.clientEntryId } : {}),
  };

  return {
    serviceUserId,
    recordType,
    subType: type.subType,
    bodyPart: (location?.bodyPart ?? marker.bodyPart).trim(),
    description: observation.description.trim(),
    riskLevel: observation.riskLevel ?? BodyMapRiskLevel.MEDIUM,
    causeSummary:
      cause?.causeSummary?.trim() ||
      (cause?.causeKnown === 'no' ? 'Cause unknown' : undefined),
    actionSummary: action.actionSummary.trim(),
    firstNoticedAt: type.firstNoticedAt,
    noticedByType: type.noticedDuring ?? 'Visit',
    nextReviewAt: action.reviewRequired !== 'no' ? action.nextReviewAt : undefined,
    safeguardingTriggered,
    managerReviewRequired: safeguardingTriggered || undefined,
    safeguardingCheck: dto.safeguardingCheck,
    woundAssessment: observation.woundAssessment,
    pressureAssessment: observation.pressureAssessment,
    medicationSite: dto.medicationSite,
    observationDetails,
    bodyView: recordViewToApiBodyView(marker.recordView),
    side: prototypeSideToApi(location?.side ?? marker.side) ?? prototypeSideToApi('Centre'),
    specificLocation: location?.specificLocation?.trim() || marker.summaryLabel || undefined,
    xCoordinate: marker.x,
    yCoordinate: marker.y,
    scheduledJobId: jobId,
    scheduledVisitId: visitId,
  };
}
