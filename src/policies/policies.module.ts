import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicyCategoriesController } from './policy-categories.controller';
import { PolicyCategoriesService } from './policy-categories.service';
import { PolicyTagsController } from './policy-tags.controller';
import { PolicyTagsService } from './policy-tags.service';
import { PolicyLibraryController } from './policy-library.controller';
import { PolicyLibraryService } from './policy-library.service';
import { PolicyExportService } from './policy-export.service';
import { PolicyAcknowledgementsController } from './policy-acknowledgements.controller';
import { PolicyAcknowledgementsService } from './policy-acknowledgements.service';
import { PolicyAcknowledgementNotificationsService } from './policy-acknowledgement-notifications.service';
import { PolicyAcknowledgementRemindersJob } from './policy-acknowledgement-reminders.job';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    UsersModule,
    OrganisationGeneralSettingsModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [
    PolicyCategoriesController,
    PolicyTagsController,
    PolicyLibraryController,
    PolicyAcknowledgementsController,
    PoliciesController,
  ],
  providers: [
    PoliciesService,
    PolicyCategoriesService,
    PolicyTagsService,
    PolicyLibraryService,
    PolicyExportService,
    PolicyAcknowledgementsService,
    PolicyAcknowledgementNotificationsService,
    PolicyAcknowledgementRemindersJob,
  ],
  exports: [PoliciesService, PolicyAcknowledgementsService],
})
export class PoliciesModule {}
