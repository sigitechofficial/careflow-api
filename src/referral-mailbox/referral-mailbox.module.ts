import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CrmModule } from '../crm/crm.module';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';
import { ReferralAutomationService } from './referral-automation.service';
import {
  ReferralMailboxCallbackController,
  ReferralMailboxController,
  ReferralMailboxInboundController,
  ReferralMailboxMicrosoftCallbackController,
} from './referral-mailbox.controller';
import { ReferralMailboxService } from './referral-mailbox.service';
import { ReferralExtractionService } from './referral-extraction.service';
import { ReferralConnectorsService } from './connectors/referral-connectors.service';
import { RecruitmentInboxModule } from '../hr/recruitment/inbox/recruitment-inbox.module';

/**
 * Reads referral emails from connected mailboxes (Gmail, Microsoft 365, IMAP/SMTP, or posted by an email service),
 * has Claude read them, and turns them into enquiries.
 */
@Module({
  imports: [PrismaModule, CrmModule, ServiceUserVisitPlansModule, RecruitmentInboxModule],
  controllers: [
    ReferralMailboxController,
    ReferralMailboxCallbackController,
    ReferralMailboxMicrosoftCallbackController,
    ReferralMailboxInboundController,
  ],
  providers: [ReferralMailboxService, ReferralExtractionService, ReferralAutomationService, ReferralConnectorsService],
})
export class ReferralMailboxModule {}
