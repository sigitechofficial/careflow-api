import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserInitialAssessmentController } from './service-user-initial-assessment.controller';
import { ServiceUserInitialAssessmentService } from './service-user-initial-assessment.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserInitialAssessmentController],
  providers: [ServiceUserInitialAssessmentService],
})
export class ServiceUserInitialAssessmentModule {}
