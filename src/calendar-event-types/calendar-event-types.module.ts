import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CalendarEventTypesController } from './calendar-event-types.controller';
import { CalendarEventTypesService } from './calendar-event-types.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CalendarEventTypesController],
  providers: [CalendarEventTypesService],
  exports: [CalendarEventTypesService],
})
export class CalendarEventTypesModule {}
