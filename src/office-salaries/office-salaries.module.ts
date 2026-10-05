import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { OfficeSalariesController } from './office-salaries.controller';
import { OfficeSalariesService } from './office-salaries.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, OrganisationGeneralSettingsModule],
  controllers: [OfficeSalariesController],
  providers: [OfficeSalariesService],
})
export class OfficeSalariesModule {}
