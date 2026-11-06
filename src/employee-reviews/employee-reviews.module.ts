import { Module } from '@nestjs/common';
import { EmployeeReviewsController, EmployeeReviewsOverviewController } from './employee-reviews.controller';
import { EmployeeReviewsService } from './employee-reviews.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';

@Module({
  imports: [AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [EmployeeReviewsOverviewController, EmployeeReviewsController],
  providers: [EmployeeReviewsService],
})
export class EmployeeReviewsModule {}

