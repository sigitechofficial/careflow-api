import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../decorators/current-user.decorator';
import { OrgScopeService } from '../org-scope/org-scope.service';

/**
 * Branch scope for pay data (SI-10).
 *
 * Permissions say WHAT a user may do; this guard says WHERE. It uses the organisation's existing
 * scope model (one company per deployment, users assigned to branches):
 *
 *  - A user whose role is company-wide (no branch restriction), or who holds
 *    `payroll.scope.organisation`, may work with pay for every branch.
 *  - Any other user is limited to employees and visits of the branches they are assigned to, and
 *    cannot open or act on records that span the organisation (pay runs, UK payroll runs, payout
 *    batches, pay items, payroll settings).
 *
 * A user with no branch assignment and no organisation-wide grant sees no pay data at all.
 * There is no legal-employer model in the system; if the client has more than one PAYE scheme,
 * that needs a decision before it can be enforced (D-07).
 */
export const PAYROLL_ORGANISATION_SCOPE_PERMISSION = 'payroll.scope.organisation';

export type PayrollScopeRule =
  /** The record covers every branch (pay run, UK run, payout batch, settings). */
  | { kind: 'organisation' }
  /** The route names one employee: `source` says where the id is. */
  | { kind: 'employee'; source: 'params' | 'query' | 'body'; key: string }
  /** A list that is filtered by `locationId`: a branch user must name one of their branches. */
  | { kind: 'branchList' }
  /** A visit reconciliation by id: scoped through its service user's branch. */
  | { kind: 'reconciliation'; param: string }
  /** A failed pay calculation by id: scoped through its service user's branch. */
  | { kind: 'evaluationFailure'; param: string }
  /** A pay agreement by id: scoped through its employee. */
  | { kind: 'payAgreement'; param: string }
  /** A UK payroll run employee row by id (payslip download): scoped through its employee. */
  | { kind: 'runEmployee'; param: string }
  /** A service user by id (pay and charge totals for their visits): scoped through their branch. */
  | { kind: 'serviceUser'; param: string };

export const PAYROLL_SCOPE_KEY = 'payrollScope';
export const PayrollScope = (rule: PayrollScopeRule) => SetMetadata(PAYROLL_SCOPE_KEY, rule);

export const ORGANISATION_SCOPE_MESSAGE =
  'This pay record covers every branch. Your access is limited to your own branches; an administrator can grant organisation-wide payroll access.';

export function hasOrganisationPayrollScope(user: RequestUser): boolean {
  return (
    (user.assignedLocationIds ?? null) === null ||
    (user.permissions ?? []).includes(PAYROLL_ORGANISATION_SCOPE_PERMISSION)
  );
}

@Injectable()
export class PayrollScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly orgScope: OrgScopeService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<PayrollScopeRule | undefined>(PAYROLL_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;
    // Authentication and account kind are the business of the guards that run before this one.
    if (!user || user.accountKind === 'employee' || user.accountKind === 'service_user') return true;
    if (hasOrganisationPayrollScope(user)) return true;

    const scope = this.orgScope.fromRequestUser(user);
    switch (rule.kind) {
      case 'organisation':
        throw new ForbiddenException(ORGANISATION_SCOPE_MESSAGE);

      case 'employee': {
        const employeeId = req[rule.source]?.[rule.key];
        if (typeof employeeId !== 'string' || !employeeId) {
          throw new ForbiddenException('Name the employee: your access is limited to your own branches.');
        }
        await this.orgScope.assertEmployeeInScope(scope, employeeId);
        return true;
      }

      case 'branchList': {
        const locationId = req.query?.locationId;
        if (typeof locationId !== 'string' || !locationId) {
          throw new ForbiddenException('Choose one of your branches: your access is limited to your own branches.');
        }
        this.orgScope.assertLocationAccess(scope, locationId);
        return true;
      }

      case 'reconciliation': {
        const row = await this.prisma.visitReconciliation.findUnique({
          where: { id: String(req.params?.[rule.param] ?? '') },
          select: { serviceUserId: true },
        });
        if (!row) throw new NotFoundException('Visit reconciliation not found');
        await this.orgScope.assertServiceUserInScope(scope, row.serviceUserId);
        return true;
      }

      case 'evaluationFailure': {
        const row = await this.prisma.payEvaluationFailure.findUnique({
          where: { id: String(req.params?.[rule.param] ?? '') },
          select: { serviceUserId: true },
        });
        if (!row) throw new NotFoundException('Pay calculation failure not found');
        // Without a service user there is no branch to judge by: organisation-wide access only.
        if (!row.serviceUserId) throw new ForbiddenException(ORGANISATION_SCOPE_MESSAGE);
        await this.orgScope.assertServiceUserInScope(scope, row.serviceUserId);
        return true;
      }

      case 'payAgreement': {
        const row = await this.prisma.employeePayAgreement.findFirst({
          where: { id: String(req.params?.[rule.param] ?? ''), deletedAt: null },
          select: { employeeId: true },
        });
        if (!row) throw new NotFoundException('Pay agreement not found');
        await this.orgScope.assertEmployeeInScope(scope, row.employeeId);
        return true;
      }

      case 'runEmployee': {
        const row = await this.prisma.ukPayrollRunEmployee.findUnique({
          where: { id: String(req.params?.[rule.param] ?? '') },
          select: { employeeId: true },
        });
        if (!row) throw new NotFoundException('Payslip not found');
        await this.orgScope.assertEmployeeInScope(scope, row.employeeId);
        return true;
      }

      case 'serviceUser': {
        await this.orgScope.assertServiceUserInScope(scope, String(req.params?.[rule.param] ?? ''));
        return true;
      }
    }
  }
}
