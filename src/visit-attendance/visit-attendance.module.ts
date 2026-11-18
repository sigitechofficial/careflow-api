import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { VisitTimelineService } from '../employee-app/visit-timeline.service';
import { VisitAttendanceService } from './visit-attendance.service';

@Module({
  imports: [PrismaModule, OrganisationGeneralSettingsModule],
  providers: [VisitAttendanceService, VisitTimelineService],
  exports: [VisitAttendanceService],
})
export class VisitAttendanceModule {}
