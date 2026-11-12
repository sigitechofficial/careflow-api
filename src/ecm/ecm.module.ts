import { OfficeTestAlertsController } from './office-test-alerts.controller';
import { OfficeTestAlertsService } from './office-test-alerts.service';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VisitAttendanceModule } from '../visit-attendance/visit-attendance.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { EcmEvaluationService } from './ecm-evaluation.service';
import { EcmVisitsService } from './ecm-visits.service';
import { EcmVisitsController } from './ecm-visits.controller';
import { EcmExceptionsService } from './ecm-exceptions.service';
import { EcmAuditService } from './ecm-audit.service';
import { EcmScheduleVersionService } from './ecm-schedule-version.service';
import { EcmAlertService } from './ecm-alert.service';
import { EcmManualAttendanceService } from './ecm-manual-attendance.service';
import { EcmNotificationEvidenceService } from './ecm-notification-evidence.service';
import { EcmReportsService } from './ecm-reports.service';
import { EcmGraphAnalyticsService } from './ecm-graph-analytics.service';
import { EcmHealthService } from './ecm-health.service';
import { EcmMissedTriageService } from './ecm-missed-triage.service';
import { BillingModule } from '../billing/billing.module';
import { EcmMissedVisitDetectionJob } from './ecm-missed-visit.job';
import { EcmMissingCheckoutDetectionJob } from './ecm-missing-checkout.job';
import { EcmThresholdLookupsService } from './ecm-threshold-lookups.service';
import { VisitAreaLockService } from './visit-area-lock.service';
import { VisitCheckInMethodGrantService } from './visit-check-in-method-grant.service';

@Module({
  imports: [
    PrismaModule,
    VisitAttendanceModule,
    ScheduleModule,
    OrganisationGeneralSettingsModule,
    forwardRef(() => NotificationsModule),
    // Office attendance corrections are carried into carer pay (VisitReconciliationsService).
    BillingModule,
  ],
  controllers: [EcmVisitsController, OfficeTestAlertsController],
  providers: [
    EcmAuditService,
    EcmScheduleVersionService,
    EcmAlertService,
    OfficeTestAlertsService,
    EcmExceptionsService,
    EcmThresholdLookupsService,
    VisitAreaLockService,
    VisitCheckInMethodGrantService,
    EcmEvaluationService,
    EcmVisitsService,
    EcmManualAttendanceService,
    EcmNotificationEvidenceService,
    EcmReportsService,
    EcmGraphAnalyticsService,
    EcmHealthService,
    EcmMissedTriageService,
    EcmMissedVisitDetectionJob,
    EcmMissingCheckoutDetectionJob,
  ],
  exports: [
    EcmEvaluationService,
    EcmVisitsService,
    EcmExceptionsService,
    EcmScheduleVersionService,
    EcmAuditService,
    EcmAlertService,
    EcmManualAttendanceService,
    EcmThresholdLookupsService,
    VisitAreaLockService,
    VisitCheckInMethodGrantService,
  ],
})
export class EcmModule {}
