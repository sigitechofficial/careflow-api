import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SurveysController } from './surveys.controller';
import { SurveysPublicController } from './surveys-public.controller';
import { SurveysService } from './surveys.service';
import { SurveyDistributionJob } from './survey-distribution.job';

@Module({
  imports: [PrismaModule, AuditLogsModule, ScheduleModule],
  controllers: [SurveysController, SurveysPublicController],
  providers: [SurveysService, SurveyDistributionJob],
  exports: [SurveysService],
})
export class SurveysModule {}
