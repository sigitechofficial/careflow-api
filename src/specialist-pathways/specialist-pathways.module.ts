import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SpecialistPathwaysController } from './specialist-pathways.controller';
import { SpecialistPathwaysService } from './specialist-pathways.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SpecialistPathwaysController],
  providers: [SpecialistPathwaysService],
  exports: [SpecialistPathwaysService],
})
export class SpecialistPathwaysModule {}
