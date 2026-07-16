import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VisitAttendanceService } from './visit-attendance.service';

@Module({
  imports: [PrismaModule],
  providers: [VisitAttendanceService],
  exports: [VisitAttendanceService],
})
export class VisitAttendanceModule {}
