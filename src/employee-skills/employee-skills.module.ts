import { Module } from '@nestjs/common';
import { EmployeeSkillsController } from './employee-skills.controller';
import { EmployeeSkillsService } from './employee-skills.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [EmployeeSkillsController],
  providers: [EmployeeSkillsService],
})
export class EmployeeSkillsModule {}

