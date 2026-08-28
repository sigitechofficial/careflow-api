import { HOME_SUPPORT_PLAN_FORM_NAME } from './home-support-plan.compose';
import { sanitizeComposeText } from './compose-html-sanitize.util';

/** Recursively sanitize string nodes in draft JSON (flat or nested). */
export function sanitizeDraftValueNode(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeComposeText(value);
  if (typeof value === 'boolean' || typeof value === 'number' || value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeDraftValueNode);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, node]) => [
        key,
        sanitizeDraftValueNode(node),
      ]),
    );
  }
  return value;
}

export function sanitizeHomeSupportPlanDraftValues(
  values: Record<string, string | boolean>,
): Record<string, string | boolean> {
  return sanitizeDraftValueNode(values) as Record<string, string | boolean>;
}

/** Sanitize draft values before persistence — Home Support Plan hybrid only. */
export function sanitizeCarePlanDraftValuesForSave(
  formName: string,
  values: Record<string, string | boolean>,
): Record<string, string | boolean> {
  if (formName !== HOME_SUPPORT_PLAN_FORM_NAME) return values;
  return sanitizeHomeSupportPlanDraftValues(values);
}
