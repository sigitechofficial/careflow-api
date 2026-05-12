import { Module } from '@nestjs/common';
import { EmployeeReviewsController } from './employee-reviews.controller';
import { EmployeeReviewsService } from './employee-reviews.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeReviewsController],
  providers: [EmployeeReviewsService],
})
export class EmployeeReviewsModule {}

