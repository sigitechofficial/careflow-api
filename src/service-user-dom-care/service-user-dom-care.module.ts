import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserDomCareController } from './service-user-dom-care.controller';
import { ServiceUserDomCareService } from './service-user-dom-care.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserDomCareController],
  providers: [ServiceUserDomCareService],
})
export class ServiceUserDomCareModule {}
