import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServiceUserPhotosModule } from '../service-user-photos/service-user-photos.module';
import { ServiceUserAllergiesModule } from '../service-user-allergies/service-user-allergies.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ServiceUserPortalAccountsService } from './service-user-portal-accounts.service';
import { ServiceUserPortalService } from './service-user-portal.service';
import { ServiceUserPortalController } from './service-user-portal.controller';
import { PortalAuthGuard } from './guards/portal-auth.guard';

@Module({
  imports: [
    PrismaModule,
    ServiceUserPhotosModule,
    ServiceUserAllergiesModule,
    OrganisationGeneralSettingsModule,
  ],
  controllers: [ServiceUserPortalController],
  providers: [ServiceUserPortalAccountsService, ServiceUserPortalService, PortalAuthGuard],
  exports: [ServiceUserPortalAccountsService],
})
export class ServiceUserPortalModule {}
