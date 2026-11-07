import { Module } from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { SupervisionController } from './supervision.controller';
import { SupervisionService } from './supervision.service';
import { SupervisionRemindersService } from './supervision-reminders.service';
import { SupervisionRemindersJob } from './supervision-reminders.job';

/** Supervision & appraisals (docs/SUPERVISION_MODULE_PLAN.md). */
@Module({
  imports: [AuditLogsModule, OrganisationGeneralSettingsModule, MailModule, forwardRef(() => NotificationsModule)],
  controllers: [SupervisionController],
  providers: [SupervisionService, SupervisionRemindersService, SupervisionRemindersJob],
  exports: [SupervisionService, SupervisionRemindersService],
})
export class SupervisionModule {}
