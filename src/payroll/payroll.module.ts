import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollEmployeesController } from './payroll-employees.controller';
import { PayrollEmployeesService } from './payroll-employees.service';
import { PayrollHmrcEpsSubmissionsService } from './payroll-hmrc-eps-submissions.service';
import { PayrollHmrcRtiClient } from './payroll-hmrc-rti.client';
import { PayrollHmrcSubmissionsService } from './payroll-hmrc-submissions.service';
import { PayrollPayslipsController } from './payroll-payslips.controller';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollSettingsController } from './payroll-settings.controller';
import { PayrollSettingsService } from './payroll-settings.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [
    PayrollSettingsController,
    PayrollEmployeesController,
    PayrollRunsController,
    PayrollPayslipsController,
  ],
  providers: [
    PayrollSettingsService,
    PayrollEmployeesService,
    PayrollRunsService,
    PayrollHmrcRtiClient,
    PayrollHmrcSubmissionsService,
    PayrollHmrcEpsSubmissionsService,
  ],
  exports: [PayrollSettingsService, PayrollEmployeesService, PayrollRunsService],
})
export class PayrollModule {}
