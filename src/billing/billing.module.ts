import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PayCardsController } from './pay-cards.controller';
import { ChargeCardsController } from './charge-cards.controller';
import { FundingContractsController } from './funding-contracts.controller';
import { InvoiceTemplatesController } from './invoice-templates.controller';
import { PayCardsService, ChargeCardsService } from './billing-cards.service';
import { FundingContractsService } from './funding-contracts.service';
import { InvoiceTemplatesService } from './invoice-templates.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    PayCardsController,
    ChargeCardsController,
    FundingContractsController,
    InvoiceTemplatesController,
  ],
  providers: [PayCardsService, ChargeCardsService, FundingContractsService, InvoiceTemplatesService],
  exports: [PayCardsService, ChargeCardsService, FundingContractsService, InvoiceTemplatesService],
})
export class BillingModule {}
