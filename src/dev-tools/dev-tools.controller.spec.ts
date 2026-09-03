import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { DevToolsGuard } from '../common/guards/dev-tools.guard';
import { IaQaDemoGuard } from '../common/guards/ia-qa-demo.guard';
import { VisitPlanGovernanceController } from '../service-user-visit-plans/visit-plan-governance.controller';
import { DevToolsController } from './dev-tools.controller';

describe('DevToolsController authorization', () => {
  it('requires JWT + permissions on the controller, and IaQaDemoGuard on generate-ia-section only', () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, DevToolsController) as unknown[];
    expect(classGuards).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(classGuards).not.toContain(DevToolsGuard);

    const methodGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      DevToolsController.prototype.generateIaSection,
    ) as unknown[];
    expect(methodGuards).toEqual([IaQaDemoGuard]);
    expect(methodGuards).not.toContain(DevToolsGuard);

    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      DevToolsController.prototype.generateIaSection,
    ) as string[];
    expect(permissions).toEqual(['service_users.initial_assessment.update']);
  });

  it('does not use DevToolsGuard, so ENABLE_DEV_TOOLS is not required and does not unlock this route', () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, DevToolsController) as unknown[];
    const methodGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      DevToolsController.prototype.generateIaSection,
    ) as unknown[];
    expect([...classGuards, ...methodGuards]).not.toContain(DevToolsGuard);
  });

  it('does not attach IaQaDemoGuard to unrelated /dev endpoints (visit-plans/dev stays independent)', () => {
    const classGuards =
      (Reflect.getMetadata(GUARDS_METADATA, VisitPlanGovernanceController) as unknown[]) ?? [];
    const methodGuards =
      (Reflect.getMetadata(
        GUARDS_METADATA,
        VisitPlanGovernanceController.prototype.clearVisitPlansAndRota,
      ) as unknown[]) ?? [];
    expect([...classGuards, ...methodGuards]).not.toContain(IaQaDemoGuard);
  });
});
