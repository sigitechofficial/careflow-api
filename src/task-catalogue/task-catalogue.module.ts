import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TaskCatalogueController } from './task-catalogue.controller';
import { TaskCatalogueService } from './task-catalogue.service';

@Module({
  imports: [PrismaModule],
  controllers: [TaskCatalogueController],
  providers: [TaskCatalogueService],
  exports: [TaskCatalogueService],
})
export class TaskCatalogueModule {}
