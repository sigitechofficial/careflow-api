import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { IncidentsModule } from '../incidents/incidents.module';

/** Complaints & compliments register (Accident & Incident menu). */
@Module({
  imports: [AuditLogsModule, IncidentsModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
