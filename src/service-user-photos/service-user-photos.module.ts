import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserPhotosController } from './service-user-photos.controller';
import { ServiceUserPhotosService } from './service-user-photos.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, ConfigModule],
  controllers: [ServiceUserPhotosController],
  providers: [ServiceUserPhotosService],
})
export class ServiceUserPhotosModule {}
