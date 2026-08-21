import { VisitPlanNightDuty, VisitPlanSlotKind } from '@prisma/client';
import type { VisitPlanSlotCarerAssignmentDto, VisitPlanSlotExceptionDto } from './dto/visit-plan-slot-enterprise.dto';
import type { VisitPlanSlotLinkFields, VisitPlanSlotSchedulingOptions } from './visit-plan-slot-options.defaults';

export type NormalizedVisitPlanSlot = {
  slotCode: string;
  daysOfWeek: number[];
  plannedStartTime: string;
  plannedEndTime: string;
  requiredCarers: number;
  isEnabled: boolean;
  medicationRoundCode: string | null;
  notes: string;
  sortOrder: number;
  slotKind: VisitPlanSlotKind;
  nightDuty: VisitPlanNightDuty;
  slotEffectiveFrom: string | null;
  slotEffectiveTo: string | null;
  oneOffDate: string | null;
  allowBackfillDays: number;
  carerAssignments: VisitPlanSlotCarerAssignmentDto[];
  exceptions: VisitPlanSlotExceptionDto[];
} & VisitPlanSlotSchedulingOptions &
  VisitPlanSlotLinkFields;
