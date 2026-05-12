import { Module } from '@nestjs/common';
import { EmployeeEmergencyContactsController } from './employee-emergency-contacts.controller';
import { EmployeeEmergencyContactsService } from './employee-emergency-contacts.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeEmergencyContactsController],
  providers: [EmployeeEmergencyContactsService],
})
export class EmployeeEmergencyContactsModule {}

