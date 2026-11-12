import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RecruitmentModule } from '../recruitment.module';
import { RecruitmentInboxController } from './recruitment-inbox.controller';
import { RecruitmentInboxService } from './recruitment-inbox.service';
import { RecruitmentExtractionService } from './recruitment-extraction.service';

/**
 * The recruitment inbox. Mailboxes are connected and checked by the referral mailbox module (purpose RECRUITMENT);
 * it hands each email to RecruitmentInboxService.
 */
@Module({
  imports: [PrismaModule, RecruitmentModule],
  controllers: [RecruitmentInboxController],
  providers: [RecruitmentInboxService, RecruitmentExtractionService],
  exports: [RecruitmentInboxService],
})
export class RecruitmentInboxModule {}
