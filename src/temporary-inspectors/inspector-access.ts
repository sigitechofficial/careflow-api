/**
 * What a Temporary Inspector session may reach: read-only, the chosen service users' care records, and reference
 * data the screens need. Checked in JwtAuthGuard for every request of a `temporary_inspector` session, after the
 * session itself was checked (valid window, not deleted) by the JWT strategy.
 */

/** Read permissions an inspector session carries (the routes below still decide what it can reach). */
export const INSPECTOR_READ_PERMISSIONS = [
  'temporary_inspector.session',
  'service_users.read',
  'service_users.absences.read',
  'service_users.address.read',
  'service_users.allergies.read',
  'service_users.assessments.read',
  'service_users.assignments.read',
  'service_users.body_map.read',
  'service_users.calendar.read',
  'service_users.calendar_event_types.read',
  'service_users.contacts.read',
  'service_users.documents.read',
  'service_users.dom_care.read',
  'service_users.flash_message.read',
  'service_users.initial_assessment.read',
  'service_users.live_in_profile.read',
  'service_users.live_in_profile.lookups.read',
  'service_users.lookups.read',
  'service_users.medical_adjustments.read',
  'service_users.medical_alerts.read',
  'service_users.medical_conditions.read',
  'service_users.medical_history.read',
  'service_users.medical_monitoring.read',
  'service_users.medical_usual_parameters.read',
  'service_users.medications.allergies.read',
  'service_users.medications.chart.read',
  'service_users.medications.events.read',
  'service_users.medications.lookups.read',
  'service_users.medications.prn.read',
  'service_users.medications.read',
  'service_users.medications.reviews.read',
  'service_users.medications.support_profile.read',
  'service_users.observations.lookups.read',
  'service_users.observations.read',
  'service_users.visit_plan.read',
  'service_users.visit_tasks.read',
  'incidents.read',
] as const;

/** Parts of a service user's record an inspector never sees (money, portal and sales). */
const HIDDEN_AREAS = new Set([
  'funding',
  'funding-usage',
  'invoices',
  'quotations',
  'referrals',
  'referral-history',
  'portal',
  'portal-account',
  'nfc-tags',
  'inventory',
]);

/**
 * Reference data and settings the screens load (no one's personal data). Only these: many other routes need no
 * permission (dashboards, payroll, CRM…) and are not for inspectors.
 */
const REFERENCE_PREFIXES = [
  '/settings/general',
  '/settings/company/branding',
  '/medication-status-codes',
  '/specialist-pathways',
  '/service-user-lookups',
  '/service-user-document-types',
  '/medication-lookups',
  '/observation-lookups',
  '/live-in-lookups',
  '/body-map/lookups',
  '/calendar-event-types',
  '/initial-assessment-templates',
  '/care-plan-templates',
  '/task-catalogue',
  '/lookups',
];

export type InspectorRequest = {
  method: string;
  /** The matched route pattern, e.g. `/service-users/:id/allergies` (Express `req.route.path`). */
  routePath: string;
  params: Record<string, string | undefined>;
  /** The chosen service users; empty = all service users. */
  serviceUserIds: string[];
};

export type InspectorDecision =
  | { allowed: true; serviceUserId: string | null; area: string | null }
  | { allowed: false; status: 403 | 404; message: string };

const READ_ONLY = 'Inspector access is read-only.';
const NOT_AVAILABLE = 'This is not available with inspector access.';
const NOT_IN_SCOPE = 'Service user not found';

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** The service user a route is about: `/service-users/:id…`, `/service-users/:serviceUserId…` or a `:serviceUserId` param. */
function serviceUserOf(path: string, params: InspectorRequest['params']): { id: string; area: string | null } | null {
  const m = path.match(/^\/service-users\/:(id|serviceUserId)(?:\/([^/]+))?/);
  if (m) {
    const id = params[m[1]!];
    return id ? { id, area: m[2] ?? null } : null;
  }
  if (params.serviceUserId && /:serviceUserId\b/.test(path)) {
    return { id: params.serviceUserId, area: path.split('/')[1] ?? null };
  }
  return null;
}

export function inspectorDecision(req: InspectorRequest): InspectorDecision {
  const path = trimSlash(req.routePath || '');
  const method = req.method.toUpperCase();

  // Their own session: who am I, keep alive, sign out.
  if (path.startsWith('/auth/')) {
    if (method === 'GET' || ['/auth/logout', '/auth/refresh'].includes(path)) {
      return { allowed: true, serviceUserId: null, area: null };
    }
    return { allowed: false, status: 403, message: READ_ONLY };
  }
  if (method !== 'GET' && method !== 'HEAD') return { allowed: false, status: 403, message: READ_ONLY };

  // A service user's record: one of theirs, and not a hidden area.
  const su = serviceUserOf(path, req.params);
  if (su) {
    if (req.serviceUserIds.length && !req.serviceUserIds.includes(su.id)) {
      return { allowed: false, status: 404, message: NOT_IN_SCOPE };
    }
    if (su.area && HIDDEN_AREAS.has(su.area)) return { allowed: false, status: 403, message: NOT_AVAILABLE };
    if (path.startsWith('/service-users/') || path.startsWith('/incidents/service-user/')) {
      return { allowed: true, serviceUserId: su.id, area: su.area };
    }
    return { allowed: false, status: 403, message: NOT_AVAILABLE };
  }

  // The service user list (filtered to theirs by the list itself).
  if (path === '/service-users') return { allowed: true, serviceUserId: null, area: null };

  // Reference data and the display settings every screen reads.
  if (REFERENCE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return { allowed: true, serviceUserId: null, area: null };
  }

  return { allowed: false, status: 403, message: NOT_AVAILABLE };
}
