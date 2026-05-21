import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LocationManagementController } from './location-management.controller';
import { LocationManagementService } from './location-management.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [LocationManagementController],
  providers: [LocationManagementService],
  exports: [LocationManagementService],
})
export class LocationManagementModule {}
