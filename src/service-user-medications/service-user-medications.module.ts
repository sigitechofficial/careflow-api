import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserMedicationsController } from './service-user-medications.controller';
import { ServiceUserMedicationsService } from './service-user-medications.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserMedicationsController],
  providers: [ServiceUserMedicationsService],
  exports: [ServiceUserMedicationsService],
})
export class ServiceUserMedicationsModule {}
