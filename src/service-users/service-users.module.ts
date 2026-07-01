import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserPortalModule } from '../service-user-portal/service-user-portal.module';
import { ServiceUsersController } from './service-users.controller';
import { ServiceUsersService } from './service-users.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, ServiceUserPortalModule],
  controllers: [ServiceUsersController],
  providers: [ServiceUsersService],
})
export class ServiceUsersModule {}
