import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VisitAttendanceModule } from '../visit-attendance/visit-attendance.module';
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
import { EcmHealthService } from './ecm-health.service';
import { EcmMissedTriageService } from './ecm-missed-triage.service';
import { EcmMissedVisitDetectionJob } from './ecm-missed-visit.job';

@Module({
  imports: [
    PrismaModule,
    VisitAttendanceModule,
    ScheduleModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [EcmVisitsController],
  providers: [
    EcmAuditService,
    EcmScheduleVersionService,
    EcmAlertService,
    EcmExceptionsService,
    EcmEvaluationService,
    EcmVisitsService,
    EcmManualAttendanceService,
    EcmNotificationEvidenceService,
    EcmReportsService,
    EcmHealthService,
    EcmMissedTriageService,
    EcmMissedVisitDetectionJob,
  ],
  exports: [
    EcmEvaluationService,
    EcmVisitsService,
    EcmExceptionsService,
    EcmScheduleVersionService,
    EcmAuditService,
    EcmAlertService,
    EcmManualAttendanceService,
  ],
})
export class EcmModule {}
