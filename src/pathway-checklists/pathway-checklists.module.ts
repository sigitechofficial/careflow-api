import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PathwayChecklistsController } from './pathway-checklists.controller';
import { PathwayChecklistsService } from './pathway-checklists.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [PathwayChecklistsController],
  providers: [PathwayChecklistsService],
  exports: [PathwayChecklistsService],
})
export class PathwayChecklistsModule {}
