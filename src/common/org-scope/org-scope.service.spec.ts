import { NotFoundException } from '@nestjs/common';
import {
  andWhereFragment,
  OrgScopeService,
  scheduledJobLocationIdsScope,
} from './org-scope.service';
import type { OrgScope } from './org-scope.types';
import { IDENTITY_ROLE } from './org-scope.types';

function scope(partial: Partial<OrgScope>): OrgScope {
  return {
    platformWide: false,
    companyWide: false,
    locationIds: null,
    scopeType: 'company',
    roles: [IDENTITY_ROLE.ADMIN],
    permissions: [],
    ...partial,
  };
}

describe('OrgScopeService.resolveListLocationIds', () => {
  const service = new OrgScopeService({} as never);

  it('passes through client filter when unrestricted', () => {
    expect(service.resolveListLocationIds(scope({ locationIds: null }), 'a', undefined)).toEqual([
      'a',
    ]);
    expect(
      service.resolveListLocationIds(scope({ locationIds: null }), null, ['a', 'b']),
    ).toEqual(['a', 'b']);
    expect(service.resolveListLocationIds(scope({ locationIds: null }))).toBeUndefined();
  });

  it('forces allowed locations when client omits filter', () => {
    expect(
      service.resolveListLocationIds(scope({ locationIds: ['a', 'b'], scopeType: 'branch' })),
    ).toEqual(['a', 'b']);
  });

  it('intersects client filter with allowed locations', () => {
    expect(
      service.resolveListLocationIds(
        scope({ locationIds: ['a', 'b'], scopeType: 'branch' }),
        'b',
        ['c'],
      ),
    ).toEqual(['b']);
    expect(
      service.resolveListLocationIds(
        scope({ locationIds: ['a'], scopeType: 'branch' }),
        'z',
        undefined,
      ),
    ).toEqual([]);
  });

  it('assertLocationAccess denies out-of-scope ids', () => {
    const branch = scope({ locationIds: ['a'], scopeType: 'branch' });
    expect(() => service.assertLocationAccess(branch, 'a')).not.toThrow();
    expect(() => service.assertLocationAccess(branch, 'z')).toThrow(NotFoundException);
  });
});

describe('scheduling scope helpers', () => {
  it('builds scheduled job location OR filter', () => {
    expect(scheduledJobLocationIdsScope(['loc-1', 'loc-2'])).toEqual({
      OR: [
        { scheduleArea: { locationId: { in: ['loc-1', 'loc-2'] } } },
        { serviceUser: { locationId: { in: ['loc-1', 'loc-2'] } } },
      ],
    });
  });

  it('merges AND fragments without dropping existing filters', () => {
    const where: Record<string, unknown> = { deletedAt: null, OR: [{ a: 1 }] };
    andWhereFragment(where, { scheduleAreaId: 'x' });
    expect(where.AND).toEqual([{ scheduleAreaId: 'x' }]);
    andWhereFragment(where, { status: 'OPEN' });
    expect(where.AND).toEqual([{ scheduleAreaId: 'x' }, { status: 'OPEN' }]);
    expect(where.OR).toEqual([{ a: 1 }]);
  });

  it('returns empty id filter for branch users with no locations', () => {
    const service = new OrgScopeService({} as never);
    const empty = scope({ locationIds: [], scopeType: 'branch' });
    expect(service.scheduledJobScopeWhere(empty)).toEqual({ id: { in: [] } });
    expect(service.jobAllocationScopeWhere(empty)).toEqual({ id: { in: [] } });
    expect(service.scheduleRunScopeWhere(empty)).toEqual({ id: { in: [] } });
  });
});
