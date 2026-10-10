import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

/** Complaints & compliments register (Accident & Incident menu). */
@Module({
  imports: [AuditLogsModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
