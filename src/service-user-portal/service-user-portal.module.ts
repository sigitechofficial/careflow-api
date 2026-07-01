import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServiceUserPhotosModule } from '../service-user-photos/service-user-photos.module';
import { ServiceUserPortalAccountsService } from './service-user-portal-accounts.service';
import { ServiceUserPortalService } from './service-user-portal.service';
import { ServiceUserPortalController } from './service-user-portal.controller';
import { PortalAuthGuard } from './guards/portal-auth.guard';

@Module({
  imports: [PrismaModule, ServiceUserPhotosModule],
  controllers: [ServiceUserPortalController],
  providers: [ServiceUserPortalAccountsService, ServiceUserPortalService, PortalAuthGuard],
  exports: [ServiceUserPortalAccountsService],
})
export class ServiceUserPortalModule {}
