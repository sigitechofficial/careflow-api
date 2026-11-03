import { Module } from '@nestjs/common';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { ServiceUserHoursController } from './service-user-hours.controller';
import { ServiceUserHoursService } from './service-user-hours.service';
import { ServiceUserTimebankService } from './service-user-timebank.service';
import { ServiceUserTimebankLedgerService } from './service-user-timebank-ledger.service';

@Module({
  imports: [OrganisationGeneralSettingsModule],
  controllers: [ServiceUserHoursController],
  providers: [ServiceUserHoursService, ServiceUserTimebankService, ServiceUserTimebankLedgerService],
  exports: [ServiceUserTimebankLedgerService],
})
export class ServiceUserHoursModule {}
