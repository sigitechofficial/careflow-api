import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicyCategoriesController } from './policy-categories.controller';
import { PolicyCategoriesService } from './policy-categories.service';
import { PolicyTagsController } from './policy-tags.controller';
import { PolicyTagsService } from './policy-tags.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PolicyCategoriesController, PolicyTagsController, PoliciesController],
  providers: [PoliciesService, PolicyCategoriesService, PolicyTagsService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
