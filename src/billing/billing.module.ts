import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { MailModule } from '../mail/mail.module';
import { PayCardsController } from './pay-cards.controller';
import { ChargeCardsController } from './charge-cards.controller';
import { FundingContractsController } from './funding-contracts.controller';
import { InvoiceTemplatesController } from './invoice-templates.controller';
import { VisitReconciliationsController } from './visit-reconciliations.controller';
import { PayrollRunsController } from './payroll-runs.controller';
import { InvoiceRunsController } from './invoice-runs.controller';
import { PaymentsController } from './payments.controller';
import { EmployeePayoutsController } from './employee-payouts.controller';
import { PayCardsService, ChargeCardsService } from './billing-cards.service';
import { FundingContractsService } from './funding-contracts.service';
import { InvoiceTemplatesService } from './invoice-templates.service';
import { VisitReconciliationsService } from './visit-reconciliations.service';
import { PayrollRunsService } from './payroll-runs.service';
import { InvoiceRunsService } from './invoice-runs.service';
import { PaymentsService } from './payments.service';
import { EmployeePayoutsService } from './employee-payouts.service';
import { EmployeePayoutAutoJob } from './employee-payout-auto.job';

@Module({
  imports: [PrismaModule, ScheduleModule, OrganisationGeneralSettingsModule, MailModule, AuditLogsModule],
  controllers: [
    PayCardsController,
    ChargeCardsController,
    FundingContractsController,
    InvoiceTemplatesController,
    VisitReconciliationsController,
    PayrollRunsController,
    InvoiceRunsController,
    PaymentsController,
    EmployeePayoutsController,
  ],
  providers: [
    PayCardsService,
    ChargeCardsService,
    FundingContractsService,
    InvoiceTemplatesService,
    VisitReconciliationsService,
    PayrollRunsService,
    InvoiceRunsService,
    PaymentsService,
    EmployeePayoutsService,
    EmployeePayoutAutoJob,
  ],
  exports: [
    PayCardsService,
    ChargeCardsService,
    FundingContractsService,
    InvoiceTemplatesService,
    VisitReconciliationsService,
    PayrollRunsService,
    InvoiceRunsService,
    PaymentsService,
    EmployeePayoutsService,
  ],
})
export class BillingModule {}
