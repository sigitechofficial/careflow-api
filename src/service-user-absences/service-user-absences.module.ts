import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ScheduleLifecycleImpactModule } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.module';
import { ServiceUserVisitPlansModule } from '../service-user-visit-plans/service-user-visit-plans.module';
import { ServiceUserAbsencesController } from './service-user-absences.controller';
import { ServiceUserAbsencesService } from './service-user-absences.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    ScheduleLifecycleImpactModule,
    forwardRef(() => ServiceUserVisitPlansModule),
  ],
  controllers: [ServiceUserAbsencesController],
  providers: [ServiceUserAbsencesService],
})
export class ServiceUserAbsencesModule {}
