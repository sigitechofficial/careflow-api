import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserAbsencesController } from './service-user-absences.controller';
import { ServiceUserAbsencesService } from './service-user-absences.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserAbsencesController],
  providers: [ServiceUserAbsencesService],
})
export class ServiceUserAbsencesModule {}
