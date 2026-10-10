import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicyAcknowledgementsController } from './policy-acknowledgements.controller';
import { PolicyAcknowledgementsService } from './policy-acknowledgements.service';
import { PolicyCategoriesController } from './policy-categories.controller';
import { PolicyCategoriesService } from './policy-categories.service';
import { PolicyTagsController } from './policy-tags.controller';
import { PolicyTagsService } from './policy-tags.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PolicyCategoriesController, PolicyTagsController, PolicyAcknowledgementsController, PoliciesController],
  providers: [PoliciesService, PolicyCategoriesService, PolicyTagsService, PolicyAcknowledgementsService],
  exports: [PoliciesService, PolicyAcknowledgementsService],
})
export class PoliciesModule {}
