import { BadRequestException } from '@nestjs/common';
import { ObservationValueKind } from '@prisma/client';
import type { CreateServiceUserObservationDto } from './dto/create-service-user-observation.dto';
import {
  isSleepQualityCode,
  isSleepReasonCode,
  normalizeSleepReasons,
} from './observation-sleep.catalog';
import { validateAlignedCarePayload } from './observation-align.catalog';

function payloadObject(dto: CreateServiceUserObservationDto): Record<string, unknown> {
  if (!dto.payload || typeof dto.payload !== 'object' || Array.isArray(dto.payload)) {
    throw new BadRequestException('payload is required for this observation type');
  }
  return dto.payload as Record<string, unknown>;
}

function requireNumber(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) {
    throw new BadRequestException(`${field} must be a number`);
  }
  return n;
}

export function validateObservationCreate(
  typeCode: string,
  valueKind: ObservationValueKind,
  dto: CreateServiceUserObservationDto,
): void {
  if (valueKind === ObservationValueKind.NUMERIC) {
    if (dto.numericValue == null || Number.isNaN(dto.numericValue)) {
      throw new BadRequestException('numericValue is required for this observation type');
    }
    return;
  }

  if (valueKind === ObservationValueKind.WELLBEING) {
    if (!dto.wellbeingScores?.length) {
      throw new BadRequestException('wellbeingScores are required for wellbeing observations');
    }
    return;
  }

  const payload = payloadObject(dto);
  const code = typeCode.toUpperCase();

  switch (code) {
    case 'BLOOD_PRESSURE': {
      requireNumber(payload.systolic, 'systolic');
      requireNumber(payload.diastolic, 'diastolic');
      if (!payload.situation || typeof payload.situation !== 'string') {
        throw new BadRequestException('situation is required for blood pressure');
      }
      return;
    }
    case 'FLUID_MONITOR': {
      const out = payload.fluidOutMl;
      const inn = payload.fluidInMl;
      const hasOut = out != null && out !== '' && !Number.isNaN(Number(out));
      const hasIn = inn != null && inn !== '' && !Number.isNaN(Number(inn));
      if (!hasOut && !hasIn) {
        throw new BadRequestException('fluidOutMl or fluidInMl is required for fluid monitor');
      }
      return;
    }
    case 'REPOSITIONING':
      if (!payload.position || typeof payload.position !== 'string') {
        throw new BadRequestException('position is required for repositioning');
      }
      return;
    case 'ABC_PATTERNS': {
      const antecedent =
        typeof payload.antecedent === 'string' ? payload.antecedent.trim() : '';
      const behaviour =
        typeof payload.behaviour === 'string'
          ? payload.behaviour.trim()
          : typeof payload.behavior === 'string'
            ? payload.behavior.trim()
            : '';
      const consequences =
        typeof payload.consequences === 'string'
          ? payload.consequences.trim()
          : typeof payload.consequence === 'string'
            ? payload.consequence.trim()
            : '';
      const actionTaken =
        typeof payload.actionTaken === 'string' ? payload.actionTaken.trim() : '';
      if (!antecedent) {
        throw new BadRequestException('antecedent is required for ABC patterns');
      }
      if (!behaviour) {
        throw new BadRequestException('behaviour is required for ABC patterns');
      }
      if (!consequences) {
        throw new BadRequestException('consequences is required for ABC patterns');
      }
      if (!actionTaken) {
        throw new BadRequestException('actionTaken is required for ABC patterns');
      }
      return;
    }
    case 'SEIZURE_CHART': {
      const description =
        typeof payload.description === 'string' ? payload.description.trim() : '';
      if (!description) {
        throw new BadRequestException('description is required for seizure chart');
      }
      return;
    }
    case 'URINALYSIS': {
      const observationOfUrine =
        typeof payload.observationOfUrine === 'string' ? payload.observationOfUrine.trim() : '';
      if (!observationOfUrine) {
        throw new BadRequestException('observationOfUrine is required for urinalysis');
      }
      if (observationOfUrine === 'OTHER') {
        const other =
          typeof payload.observationOfUrineOther === 'string'
            ? payload.observationOfUrineOther.trim()
            : '';
        if (!other) {
          throw new BadRequestException('observationOfUrineOther is required when observation is Other');
        }
      }
      const dipstick = typeof payload.dipstick === 'string' ? payload.dipstick.trim() : '';
      if (!dipstick) {
        throw new BadRequestException('dipstick is required for urinalysis');
      }
      return;
    }
    case 'NEWS2': {
      requireNumber(payload.respirationRate, 'respirationRate');
      requireNumber(payload.oxygenSaturation, 'oxygenSaturation');
      requireNumber(payload.systolic, 'systolic');
      requireNumber(payload.diastolic, 'diastolic');
      requireNumber(payload.pulse, 'pulse');
      requireNumber(payload.temperature, 'temperature');
      const airOrOxygen =
        typeof payload.airOrOxygen === 'string' ? payload.airOrOxygen.trim() : '';
      if (!airOrOxygen || !['AIR', 'OXYGEN'].includes(airOrOxygen)) {
        throw new BadRequestException('airOrOxygen must be AIR or OXYGEN');
      }
      const consciousness =
        typeof payload.consciousness === 'string' ? payload.consciousness.trim() : '';
      if (!consciousness || !['A', 'C', 'V', 'P', 'U'].includes(consciousness)) {
        throw new BadRequestException('consciousness must be A, C, V, P, or U');
      }
      return;
    }
    case 'CONTINENCE':
    case 'SKIN_INTEGRITY':
    case 'PEG_ENTERAL':
    case 'BODY_MAP':
    case 'BOWEL_MOVEMENT':
    case 'FALLS':
    case 'REPOSITIONING':
    case 'MEALS': {
      try {
        validateAlignedCarePayload(code, payload);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'Invalid observation payload');
      }
      return;
    }
    case 'SLEEP': {
      const quality = typeof payload.quality === 'string' ? payload.quality.trim() : '';
      if (!quality || !isSleepQualityCode(quality)) {
        throw new BadRequestException('quality is required for sleep');
      }
      const reasons = normalizeSleepReasons(payload);
      if (reasons.some((code) => !isSleepReasonCode(code))) {
        throw new BadRequestException('reasons contains an invalid sleep reason');
      }
      return;
    }
    case 'INFECTION': {
      const infectionType =
        typeof payload.infectionType === 'string' ? payload.infectionType.trim() : '';
      if (!infectionType) {
        throw new BadRequestException('infectionType is required for infection');
      }
      for (const key of ['infectionCleared', 'hospitalisation', 'isolationRequired'] as const) {
        const v = payload[key];
        if (v !== undefined && typeof v !== 'boolean') {
          throw new BadRequestException(`${key} must be a boolean`);
        }
      }
      return;
    }
    default:
      return;
  }
}
