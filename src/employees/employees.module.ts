import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';

@Module({
  imports: [AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}

