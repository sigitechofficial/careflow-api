import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { CqcEvidenceModule } from '../cqc-evidence/cqc-evidence.module';
import { TextMessagesModule } from '../text-messages/text-messages.module';
import { AuthModule } from '../auth/auth.module';
import { SurveyRemindersService } from './survey-reminders.service';
import { SurveyTextRepliesService } from './survey-text-replies.service';
import { SurveyContactRuleService } from './survey-contact-rule.service';
import { SurveyContactRuleController } from './survey-contact-rule.controller';
import { SurveyContactPreferencesController, SurveyRemindersController } from './survey-reminders.controller';
import { SurveysController } from './surveys.controller';
import { SurveysPublicController } from './surveys-public.controller';
import { SurveysPortalController } from './surveys-portal.controller';
import { SurveysEmployeeAppController } from './surveys-employee-app.controller';
import { SurveysMyController } from './surveys-my.controller';
import { SurveyEventTriggersController } from './survey-event-triggers.controller';
import { SurveyEventTriggersService } from './survey-event-triggers.service';
import { SurveyOutsidePeopleController, SurveySendOutsideController } from './survey-outside-people.controller';
import { SurveyOutsidePeopleService } from './survey-outside-people.service';
import { SurveyUnsubscribeController } from './survey-unsubscribe.controller';
import { SurveyUnsubscribeService } from './survey-unsubscribe.service';
import { SurveysService } from './surveys.service';
import { SurveyInsightService } from './survey-insight.service';
import { SurveyInsightController, SurveyInsightOverviewController } from './survey-insight.controller';
import { SurveyDistributionJob } from './survey-distribution.job';
import { SurveyLibraryController } from './survey-library.controller';
import { SurveyLibraryService } from './survey-library.service';
import { SurveyAlertsService } from './survey-alerts.service';
import { SurveyAccessService } from './survey-access.service';
import { SurveyAccessController, SurveyRecipientLinksController, SurveySectionsController, SurveyShareLinksController } from './survey-access.controller';
import { SurveySectionsService } from './survey-sections.service';
import { SurveyManagerCopiesController } from './survey-manager-copies.controller';
import { SurveyManagerCopiesService } from './survey-manager-copies.service';
import { SurveyReviewerGrantsController, SurveyReviewsController } from './survey-reviewers.controller';
import { SurveyReviewersService } from './survey-reviewers.service';
import { SurveyRecipientLinksService } from './survey-recipient-links.service';
import { SurveyLinkGuard } from './survey-link-guard';
import { SurveyShareLinksService } from './survey-share-links.service';
import {
  SurveyAlertRolesController,
  SurveyAlertRulesController,
  SurveyFollowUpsController,
} from './survey-alerts.controller';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    ScheduleModule,
    MailModule,
    NotificationsModule,
    OrganisationGeneralSettingsModule,
    CqcEvidenceModule,
    TextMessagesModule,
    // Reviewer accounts are invited to choose their own password (AuthService.sendAccountInvite).
    AuthModule,
  ],
  controllers: [
    SurveysController,
    SurveysPublicController,
    SurveysPortalController,
    SurveysEmployeeAppController,
    SurveysMyController,
    SurveyLibraryController,
    SurveyAlertRulesController,
    SurveyAlertRolesController,
    SurveyFollowUpsController,
    SurveyAccessController,
    SurveyShareLinksController,
    SurveyRecipientLinksController,
    SurveySectionsController,
    SurveyManagerCopiesController,
    SurveyReviewerGrantsController,
    SurveyReviewsController,
    SurveyRemindersController,
    SurveyContactPreferencesController,
    SurveyContactRuleController,
    SurveyEventTriggersController,
    SurveyOutsidePeopleController,
    SurveySendOutsideController,
    SurveyUnsubscribeController,
    SurveyInsightController,
    SurveyInsightOverviewController,
  ],
  providers: [SurveysService, SurveyDistributionJob, SurveyLibraryService, SurveyAlertsService, SurveyAccessService, SurveyShareLinksService, SurveyRecipientLinksService, SurveyLinkGuard, SurveySectionsService, SurveyRemindersService, SurveyTextRepliesService, SurveyManagerCopiesService, SurveyContactRuleService, SurveyReviewersService, SurveyEventTriggersService, SurveyOutsidePeopleService, SurveyUnsubscribeService, SurveyInsightService],
  exports: [SurveysService, SurveyAlertsService],
})
export class SurveysModule {}
