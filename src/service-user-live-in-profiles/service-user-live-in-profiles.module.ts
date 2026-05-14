import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserLiveInProfilesController } from './service-user-live-in-profiles.controller';
import { ServiceUserLiveInProfilesService } from './service-user-live-in-profiles.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserLiveInProfilesController],
  providers: [ServiceUserLiveInProfilesService],
  exports: [ServiceUserLiveInProfilesService],
})
export class ServiceUserLiveInProfilesModule {}
