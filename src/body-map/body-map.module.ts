import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { BodyMapController } from './body-map.controller';
import { BodyMapService } from './body-map.service';
import { BodyMapMedicationSiteService } from './body-map-medication-site.service';
import { BodyMapAlertsService } from './body-map-alerts.service';
import { ServiceUserBodyMapController } from './service-user-body-map.controller';
import { ServiceUserMedicationBodyMapController } from './service-user-medication-body-map.controller';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [
    BodyMapController,
    ServiceUserBodyMapController,
    ServiceUserMedicationBodyMapController,
  ],
  providers: [BodyMapService, BodyMapMedicationSiteService, BodyMapAlertsService],
  exports: [BodyMapService, BodyMapMedicationSiteService, BodyMapAlertsService],
})
export class BodyMapModule {}
