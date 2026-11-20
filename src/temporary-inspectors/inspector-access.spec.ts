import { inspectorDecision, type InspectorRequest } from './inspector-access';
import { inspectorScopeIds } from './temporary-inspectors.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const req = (over: Partial<InspectorRequest>): InspectorRequest => ({
  method: 'GET',
  routePath: '/service-users/:id',
  params: { id: A },
  serviceUserIds: [A],
  ...over,
});
const allowed = (over: Partial<InspectorRequest>) => inspectorDecision(req(over)).allowed;

describe('inspectorDecision', () => {
  it('reads a chosen service user’s record and its care areas', () => {
    expect(inspectorDecision(req({}))).toEqual({ allowed: true, serviceUserId: A, area: null });
    expect(inspectorDecision(req({ routePath: '/service-users/:id/allergies' }))).toEqual({ allowed: true, serviceUserId: A, area: 'allergies' });
    expect(allowed({ routePath: '/service-users/:serviceUserId/care-plans/:carePlanFormId', params: { serviceUserId: A, carePlanFormId: 'x' } })).toBe(true);
    expect(allowed({ routePath: '/service-users/:id/medications/:medicationId/schedules', params: { id: A, medicationId: 'm' } })).toBe(true);
    expect(allowed({ routePath: '/incidents/service-user/:serviceUserId/history', params: { serviceUserId: A } })).toBe(true);
  });

  it('refuses a service user who was not chosen (as not found)', () => {
    expect(inspectorDecision(req({ params: { id: B } }))).toMatchObject({ allowed: false, status: 404 });
    expect(inspectorDecision(req({ routePath: '/incidents/service-user/:serviceUserId/history', params: { serviceUserId: B } }))).toMatchObject({ allowed: false, status: 404 });
  });

  it('with nobody chosen, reads every service user', () => {
    expect(allowed({ params: { id: B }, serviceUserIds: [] })).toBe(true);
  });

  it('is read-only', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(inspectorDecision(req({ method }))).toMatchObject({ allowed: false, status: 403, message: 'Inspector access is read-only.' });
    }
    expect(allowed({ method: 'POST', routePath: '/auth/change-password', params: {} })).toBe(false);
  });

  it('can still see who they are, stay signed in and sign out', () => {
    expect(allowed({ routePath: '/auth/me', params: {} })).toBe(true);
    expect(allowed({ method: 'POST', routePath: '/auth/refresh', params: {} })).toBe(true);
    expect(allowed({ method: 'POST', routePath: '/auth/logout', params: {} })).toBe(true);
  });

  it('never shows money, portal or sales parts of a record', () => {
    for (const area of ['funding', 'funding-usage', 'invoices', 'quotations', 'referrals', 'portal', 'nfc-tags', 'inventory']) {
      expect(allowed({ routePath: `/service-users/:id/${area}` })).toBe(false);
    }
  });

  it('refuses routes about a service user outside their record (billing, hours)', () => {
    expect(allowed({ routePath: '/billing/invoice-runs/service-user/:serviceUserId', params: { serviceUserId: A } })).toBe(false);
    expect(allowed({ routePath: '/service-user-hours/timebank/:serviceUserId', params: { serviceUserId: A } })).toBe(false);
  });

  it('lists service users, reads reference data, and nothing else', () => {
    expect(allowed({ routePath: '/service-users', params: {} })).toBe(true);
    expect(allowed({ routePath: '/service-user-lookups/care-types', params: {} })).toBe(true);
    expect(allowed({ routePath: '/medication-lookups', params: {} })).toBe(true);
    expect(allowed({ routePath: '/settings/general', params: {} })).toBe(true);
    for (const path of ['/employees', '/service-users/calendar/events', '/dashboard/summary', '/payroll/runs', '/crm', '/audit-logs', '/incidents', '/service-users/portal-accounts']) {
      expect(allowed({ routePath: path, params: {} })).toBe(false);
    }
  });

  it('refuses when the route is unknown', () => {
    expect(allowed({ routePath: '', params: {} })).toBe(false);
  });
});

describe('inspectorScopeIds', () => {
  it('keeps chosen ids, empty means all, and the old sample list means nobody', () => {
    expect(inspectorScopeIds([A, B])).toEqual([A, B]);
    expect(inspectorScopeIds([])).toEqual([]);
    expect(inspectorScopeIds(['1', '4'])).toEqual(['00000000-0000-0000-0000-000000000000']);
  });
});
