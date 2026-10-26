import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduledJobsModule } from '../scheduled-jobs/scheduled-jobs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';
import { BillingModule } from '../billing/billing.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { EmployeeComplianceModule } from '../employee-compliance/employee-compliance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmployeeHoursApprovalsModule } from '../employee-hours-approvals/employee-hours-approvals.module';
import { ServiceUserVisitPlansController } from './service-user-visit-plans.controller';
import { ServiceUserVisitPlansService } from './service-user-visit-plans.service';
import { VisitPlanBulkScheduleController } from './visit-plan-bulk-schedule.controller';
import { VisitPlanBulkScheduleService } from './visit-plan-bulk-schedule.service';
import { VisitPlanAmendmentImpactService } from './visit-plan-amendment-impact.service';
import { VisitPlanGovernanceController } from './visit-plan-governance.controller';
import { ScheduledJobsHousekeepingModule } from '../scheduled-jobs-housekeeping/scheduled-jobs-housekeeping.module';
import { VisitPlanDateChangesController } from './visit-plan-date-changes.controller';
import { VisitPlanDateChangesService } from './visit-plan-date-changes.service';
import { VisitPlanWeeklyHoursService } from './visit-plan-weekly-hours.service';
import { EXTRA_VISIT_CREATOR } from '../employee-hours-approvals/extra-visit-creator';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    ScheduledJobsModule,
    ScheduleLifecycleImpactModule,
    BillingModule,
    OrganisationGeneralSettingsModule,
    EmployeeComplianceModule,
    NotificationsModule,
    EmployeeHoursApprovalsModule,
    forwardRef(() => ScheduledJobsHousekeepingModule),
  ],
  controllers: [
    ServiceUserVisitPlansController,
    VisitPlanBulkScheduleController,
    VisitPlanGovernanceController,
    VisitPlanDateChangesController,
  ],
  providers: [
    ServiceUserVisitPlansService,
    VisitPlanBulkScheduleService,
    VisitPlanAmendmentImpactService,
    VisitPlanDateChangesService,
    VisitPlanWeeklyHoursService,
    // Lets an approved "extra visit over weekly hours" request create the visit.
    { provide: EXTRA_VISIT_CREATOR, useExisting: VisitPlanDateChangesService },
  ],
  exports: [ServiceUserVisitPlansService, VisitPlanBulkScheduleService, VisitPlanAmendmentImpactService],
})
export class ServiceUserVisitPlansModule {}
