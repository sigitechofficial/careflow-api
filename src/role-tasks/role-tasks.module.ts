import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { RoleTasksController } from './role-tasks.controller';
import { RoleTasksService } from './role-tasks.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [RoleTasksController],
  providers: [RoleTasksService],
})
export class RoleTasksModule {}
