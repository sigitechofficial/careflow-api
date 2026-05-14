import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationSupportProfilesController } from './medication-support-profiles.controller';
import { MedicationSupportProfilesService } from './medication-support-profiles.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [MedicationSupportProfilesController],
  providers: [MedicationSupportProfilesService],
})
export class MedicationSupportProfilesModule {}
