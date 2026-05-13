import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserAddressesController } from './service-user-addresses.controller';
import { ServiceUserAddressesService } from './service-user-addresses.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserAddressesController],
  providers: [ServiceUserAddressesService],
})
export class ServiceUserAddressesModule {}
