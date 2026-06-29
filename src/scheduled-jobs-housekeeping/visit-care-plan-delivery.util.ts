import type { CarePlanFormFieldRef } from '../service-user-care-plans/compose/compose-context.types';

export const DELIVERED_TASK_STATUSES = [
  'DELIVERED',
  'PARTIAL',
  'NOT_DELIVERED',
  'NOT_APPLICABLE',
  'REFUSED',
] as const;

export type DeliveredTaskStatus = (typeof DELIVERED_TASK_STATUSES)[number];

export type CarePlanDeliveryTaskTemplate = {
  fieldKey: string;
  label: string;
  fieldType: string;
  expectedValue: string | boolean | null;
  expectedDisplay: string;
};

export type CarePlanDeliveryPlanTemplate = {
  carePathwayFormId: string;
  formName: string;
  pictureUrl: string | null;
  instanceId: string | null;
  publishedVersionId: string | null;
  publishedVersionNumber: number | null;
  isPublished: boolean;
  tasks: CarePlanDeliveryTaskTemplate[];
};

export type DeliveredCarePlanTaskPayload = {
  fieldKey: string;
  label: string;
  fieldType: string;
  expectedValue?: string | boolean | null;
  status: DeliveredTaskStatus;
  notes?: string;
};

export type DeliveredCarePlanDetailPayload = {
  carePathwayFormId: string;
  carePlanInstanceId?: string;
  publishedVersionId?: string;
  publishedVersionNumber?: number;
  formName: string;
  planDelivered: boolean;
  planNotes?: string;
  extraCareNotes?: string;
  tasks: DeliveredCarePlanTaskPayload[];
};

const NON_DELIVERABLE_FIELD_TYPES = new Set([
  'SECTION_TEXT',
  'RICH_TEXT',
  'SUMMERNOTE',
  'FILE_UPLOAD',
  'PHOTO',
  'SIGNATURE',
]);

export function isDeliverableCarePlanField(field: Pick<CarePlanFormFieldRef, 'key' | 'fieldType'>): boolean {
  if (field.key.startsWith('__')) return false;
  if (NON_DELIVERABLE_FIELD_TYPES.has(field.fieldType)) return false;
  return true;
}

export function formatCarePlanFieldDisplayValue(value: string | boolean | null | undefined): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value == null) return '';
  const text = String(value).trim();
  return text;
}

function fieldIsPlannedTask(
  field: CarePlanFormFieldRef,
  publishedValues: Record<string, string | boolean>,
): boolean {
  if (!isDeliverableCarePlanField(field)) return false;
  const expected = publishedValues[field.key];
  if (field.fieldType === 'CHECKBOX' || field.fieldType === 'YES_NO') {
    return expected === true || expected === 'true';
  }
  const display = formatCarePlanFieldDisplayValue(expected);
  return display.length > 0;
}

export function buildCarePlanDeliveryTasks(
  fields: CarePlanFormFieldRef[],
  publishedValues: Record<string, string | boolean>,
): CarePlanDeliveryTaskTemplate[] {
  return fields
    .filter((field) => fieldIsPlannedTask(field, publishedValues))
    .map((field) => {
      const expectedValue = publishedValues[field.key] ?? null;
      return {
        fieldKey: field.key,
        label: field.label,
        fieldType: field.fieldType,
        expectedValue,
        expectedDisplay: formatCarePlanFieldDisplayValue(expectedValue),
      };
    });
}

export function parsePublishedValuesJson(raw: unknown): Record<string, string | boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = value;
    else if (value != null) out[key] = String(value);
  }
  return out;
}

export function deriveDeliveredCarePlanFormIds(details: DeliveredCarePlanDetailPayload[]): string[] {
  return details
    .filter((plan) => plan.planDelivered)
    .map((plan) => plan.carePathwayFormId);
}

export function validateDeliveredCarePlanDetails(
  details: DeliveredCarePlanDetailPayload[],
  linkedFormIds: string[],
  allowedFieldKeysByFormId: Map<string, Set<string>>,
): string | null {
  const linked = new Set(linkedFormIds);
  for (const plan of details) {
    if (!linked.has(plan.carePathwayFormId)) {
      return `Care plan ${plan.formName} is not linked to this visit slot`;
    }
    const allowedKeys = allowedFieldKeysByFormId.get(plan.carePathwayFormId);
    if (!allowedKeys) continue;
    for (const task of plan.tasks) {
      if (!allowedKeys.has(task.fieldKey)) {
        return `Invalid task field for ${plan.formName}`;
      }
      if (!DELIVERED_TASK_STATUSES.includes(task.status)) {
        return `Invalid task status for ${task.label}`;
      }
    }
  }
  return null;
}
