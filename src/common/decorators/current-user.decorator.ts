import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OrgScopeType } from '../org-scope/org-scope.types';

export type AccountKind = 'user' | 'temporary_inspector' | 'service_user' | 'employee';

export type RequestUser = {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  accountKind: AccountKind;
  /** Populated for `temporary_inspector` sessions (for `/auth/me` and audits). */
  firstName?: string;
  lastName?: string;
  username?: string;
  /** Populated for `service_user` portal sessions. */
  serviceUserId?: string;
  /** Populated for `employee` app sessions. */
  employeeId?: string;
  preferredName?: string | null;
  profilePhotoUrl?: string | null;
  /**
   * null/undefined = unrestricted header locations (company/platform scope).
   * string[] = restrict picker and server-side list/detail queries.
   */
  assignedLocationIds?: string[] | null;
  /** Display names for assigned branches (header); null when unrestricted. */
  assignedLocations?: Array<{ id: string; name: string }> | null;
  /** Organizational scope type derived from identity roles. */
  scopeType?: OrgScopeType;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
