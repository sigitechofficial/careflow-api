import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AccountKind = 'user' | 'temporary_inspector';

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
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);

