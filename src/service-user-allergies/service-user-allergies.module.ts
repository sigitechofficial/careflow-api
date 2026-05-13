import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserAllergiesController } from './service-user-allergies.controller';
import { ServiceUserAllergiesService } from './service-user-allergies.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserAllergiesController],
  providers: [ServiceUserAllergiesService],
})
export class ServiceUserAllergiesModule {}
