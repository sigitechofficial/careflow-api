import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CarePathwayController } from './care-pathway.controller';
import { CarePathwayService } from './care-pathway.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [CarePathwayController],
  providers: [CarePathwayService],
  exports: [CarePathwayService],
})
export class CarePathwayModule {}
