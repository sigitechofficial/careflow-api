import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { MailModule } from '../mail/mail.module';
import { TravelRoutesModule } from '../travel-routes/travel-routes.module';
import { PayCardsController } from './pay-cards.controller';
import { ChargeCardsController } from './charge-cards.controller';
import { FundingContractsController } from './funding-contracts.controller';
import { VisitReconciliationsController } from './visit-reconciliations.controller';
import { PayrollRunsController } from './payroll-runs.controller';
import { InvoiceRunsController } from './invoice-runs.controller';
import { PaymentsController } from './payments.controller';
import { EmployeePayoutsController } from './employee-payouts.controller';
import { PayCardsService, ChargeCardsService } from './billing-cards.service';
import { FundingContractsService } from './funding-contracts.service';
import { VisitReconciliationsService } from './visit-reconciliations.service';
import { PayrollRunsService } from './payroll-runs.service';
import { InvoiceRunsService } from './invoice-runs.service';
import { PaymentsService } from './payments.service';
import { EmployeePayoutsService } from './employee-payouts.service';
import { EmployeePayoutAutoJob } from './employee-payout-auto.job';

import { BankHolidaysController, WageTypesController } from './wage-types.controller';
import { WageTypesService } from './wage-types.service';
import { PayItemsService } from './pay-items.service';
import { PayItemsController } from './pay-items.controller';
import { TravelIntervalsService } from './travel-intervals.service';
import { TravelIntervalsController } from './travel-intervals.controller';
import { VisitDisruptionsService } from './visit-disruptions.service';
import { VisitDisruptionsController } from './visit-disruptions.controller';
import { WageRecoveriesService } from './wage-recoveries.service';
import { WageRecoveriesController } from './wage-recoveries.controller';
import { BankHolidaysService } from './bank-holidays.service';
import { MileageRatesController } from './mileage-rates.controller';
import { FundingUsageController } from './funding-usage.controller';
import { FundingUsageService } from './funding-usage.service';
import { MileageRatesService } from './mileage-rates.service';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule,
    OrganisationGeneralSettingsModule,
    MailModule,
    AuditLogsModule,
    TravelRoutesModule,
  ],
  controllers: [
    PayCardsController,
    ChargeCardsController,
    FundingContractsController,
    FundingUsageController,
    VisitReconciliationsController,
    PayrollRunsController,
    InvoiceRunsController,
    PaymentsController,
    EmployeePayoutsController,
    WageTypesController,
    BankHolidaysController,
    MileageRatesController,
    PayItemsController,
    TravelIntervalsController,
    VisitDisruptionsController,
    WageRecoveriesController,
  ],
  providers: [
    PayCardsService,
    ChargeCardsService,
    FundingContractsService,
    FundingUsageService,
    VisitReconciliationsService,
    PayrollRunsService,
    InvoiceRunsService,
    PaymentsService,
    EmployeePayoutsService,
    EmployeePayoutAutoJob,
    WageTypesService,
    BankHolidaysService,
    MileageRatesService,
    PayItemsService,
    TravelIntervalsService,
    VisitDisruptionsService,
    WageRecoveriesService,
  ],
  exports: [
    PayCardsService,
    ChargeCardsService,
    FundingContractsService,
    VisitReconciliationsService,
    PayrollRunsService,
    InvoiceRunsService,
    PaymentsService,
    EmployeePayoutsService,
  ],
})
export class BillingModule {}
