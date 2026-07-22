import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollEmployeesController } from './payroll-employees.controller';
import { PayrollEmployeesService } from './payroll-employees.service';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollSettingsController } from './payroll-settings.controller';
import { PayrollSettingsService } from './payroll-settings.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PayrollSettingsController, PayrollEmployeesController, PayrollRunsController],
  providers: [PayrollSettingsService, PayrollEmployeesService, PayrollRunsService],
  exports: [PayrollSettingsService, PayrollEmployeesService, PayrollRunsService],
})
export class PayrollModule {}
