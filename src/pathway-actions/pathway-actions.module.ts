import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PathwayActionsController } from './pathway-actions.controller';
import { PathwayActionsService } from './pathway-actions.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [PathwayActionsController],
  providers: [PathwayActionsService],
  exports: [PathwayActionsService],
})
export class PathwayActionsModule {}
