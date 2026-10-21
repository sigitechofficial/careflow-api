import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ScheduleFiltersController } from './schedule-filters.controller';
import { ScheduleFiltersService } from './schedule-filters.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [ScheduleFiltersController],
  providers: [ScheduleFiltersService],
  exports: [ScheduleFiltersService],
})
export class ScheduleFiltersModule {}
