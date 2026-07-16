import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

/** Restricts routes to employee (carer) mobile app sessions only. */
@Injectable()
export class EmployeeAppAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.accountKind !== 'employee' || !user.employeeId) {
      throw new ForbiddenException('Employee app access required');
    }
    return true;
  }
}
