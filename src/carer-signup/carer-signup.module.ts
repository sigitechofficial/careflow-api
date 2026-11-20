import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeeComplianceModule } from '../employee-compliance/employee-compliance.module';
import {
  CarerAccountReviewController,
  CarerDeletionRequestController,
  CarerSignupPublicController,
} from './carer-signup.controller';
import { CarerSignupService } from './carer-signup.service';

/** Care app sign-up (with office approval) and carer account delete requests (with manager approval). */
@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule, EmployeesModule, EmployeeComplianceModule],
  controllers: [CarerSignupPublicController, CarerDeletionRequestController, CarerAccountReviewController],
  providers: [CarerSignupService],
  exports: [CarerSignupService],
})
export class CarerSignupModule {}
