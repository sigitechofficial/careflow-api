import { BadRequestException } from '@nestjs/common';
import type { BodyMapBodyView } from '@prisma/client';
import type { BodyMapMedicationSiteDto } from './dto/body-map-medication-site.dto';

const DEFAULT_ROTATION_DISTANCE = 0.08;

export function patchRotationMaxDistance(): number {
  const raw = process.env.BODY_MAP_PATCH_ROTATION_MAX_DISTANCE;
  const n = raw ? Number(raw) : DEFAULT_ROTATION_DISTANCE;
  return Number.isFinite(n) && n > 0 && n < 1 ? n : DEFAULT_ROTATION_DISTANCE;
}

export function isPatchMedicationSite(
  subType?: string | null,
  medicationTypeCode?: string | null,
): boolean {
  if (medicationTypeCode === 'PATCH') return true;
  const s = (subType ?? '').toLowerCase();
  return s.includes('patch');
}

export function validatePatchMedicationSite(
  dto: BodyMapMedicationSiteDto,
  subType?: string | null,
  medicationTypeCode?: string | null,
): string[] {
  if (!isPatchMedicationSite(subType, medicationTypeCode)) return [];

  const errors: string[] = [];

  if (dto.oldPatchPresent === undefined || dto.oldPatchPresent === null) {
    errors.push('Old patch present (yes/no) is required for patch sites');
  }

  if (dto.oldPatchPresent === true) {
    if (!dto.oldPatchRemoved) {
      errors.push('Old patch must be removed before applying a new patch');
    }
    if (!dto.disposalRecorded) {
      errors.push('Disposal of the old patch must be recorded');
    }
    if (!dto.oldPatchRemovalAt) {
      errors.push('Old patch removal date and time is required');
    }
    if (!dto.oldPatchBodyPart?.trim()) {
      errors.push('Previous patch location (body part) is required');
    }
  }

  if (dto.oldPatchPresent === false && !dto.oldPatchNotes?.trim()) {
    errors.push(
      'Provide an escalation note when no old patch was found (first application or unable to locate)',
    );
  }

  if (!dto.nextChangeDue) {
    errors.push('Next patch change due date is required');
  }

  if (!dto.siteRotationChecked) {
    errors.push('Site rotation must be confirmed before saving a patch site');
  }

  return errors;
}

export function assertPatchMedicationSite(
  dto: BodyMapMedicationSiteDto,
  subType?: string | null,
  medicationTypeCode?: string | null,
): void {
  const errors = validatePatchMedicationSite(dto, subType, medicationTypeCode);
  if (errors.length > 0) {
    throw new BadRequestException(errors.join('; '));
  }
}

export function markerDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export type PatchRotationPriorSite = {
  recordId: string;
  medicineName: string;
  bodyPart: string;
  bodyView: BodyMapBodyView;
  x: number;
  y: number;
  appliedAt: string | null;
};

export function buildPatchRotationWarning(
  prior: PatchRotationPriorSite,
  maxDistance: number,
): string {
  return `New patch site is close to a recent patch at ${prior.bodyPart} (${prior.medicineName}, ${prior.appliedAt ? new Date(prior.appliedAt).toLocaleDateString('en-GB') : 'recent'}). Confirm site rotation.`;
}

export function evaluatePatchRotationWarnings(
  opts: {
    bodyView: BodyMapBodyView;
    x: number;
    y: number;
  },
  priorSites: PatchRotationPriorSite[],
): string[] {
  const maxDist = patchRotationMaxDistance();
  const warnings: string[] = [];
  for (const prior of priorSites) {
    if (prior.bodyView !== opts.bodyView) continue;
    const dist = markerDistance({ x: opts.x, y: opts.y }, { x: prior.x, y: prior.y });
    if (dist <= maxDist) {
      warnings.push(buildPatchRotationWarning(prior, maxDist));
    }
  }
  return warnings;
}
