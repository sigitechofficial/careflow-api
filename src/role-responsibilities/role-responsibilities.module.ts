import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RoleResponsibilitiesController } from './role-responsibilities.controller';
import { RoleResponsibilitiesService } from './role-responsibilities.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [RoleResponsibilitiesController],
  providers: [RoleResponsibilitiesService],
})
export class RoleResponsibilitiesModule {}
