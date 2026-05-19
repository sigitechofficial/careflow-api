import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserObservationsController } from './service-user-observations.controller';
import { ServiceUserObservationsService } from './service-user-observations.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [ServiceUserObservationsController],
  providers: [ServiceUserObservationsService],
})
export class ServiceUserObservationsModule {}
