import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUsersController } from './service-users.controller';
import { ServiceUsersService } from './service-users.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUsersController],
  providers: [ServiceUsersService],
})
export class ServiceUsersModule {}
