import { Module } from '@nestjs/common';
import { EmployeeReviewsController } from './employee-reviews.controller';
import { EmployeeReviewsOverviewController } from './employee-reviews-overview.controller';
import { EmployeeReviewsService } from './employee-reviews.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeReviewsController, EmployeeReviewsOverviewController],
  providers: [EmployeeReviewsService],
})
export class EmployeeReviewsModule {}

