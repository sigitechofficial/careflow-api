import { Module, forwardRef } from '@nestjs/common';
import { EmployeeComplianceController } from './employee-compliance.controller';
import { EmployeeComplianceService } from './employee-compliance.service';
import { AllocationComplianceService } from './allocation-compliance.service';
import { ComplianceExpiryRemindersService } from './compliance-expiry-reminders.service';
import { ComplianceExpiryRemindersJob } from './compliance-expiry-reminders.job';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';

@Module({
  imports: [AuditLogsModule, OrganisationGeneralSettingsModule, MailModule, forwardRef(() => NotificationsModule)],
  controllers: [EmployeeComplianceController],
  providers: [
    EmployeeComplianceService,
    AllocationComplianceService,
    ComplianceExpiryRemindersService,
    ComplianceExpiryRemindersJob,
  ],
  exports: [EmployeeComplianceService, AllocationComplianceService],
})
export class EmployeeComplianceModule {}
