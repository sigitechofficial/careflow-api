import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServiceUserVisitTasksController } from './service-user-visit-tasks.controller';
import { ServiceUserVisitTasksService } from './service-user-visit-tasks.service';

@Module({
  imports: [PrismaModule],
  controllers: [ServiceUserVisitTasksController],
  providers: [ServiceUserVisitTasksService],
  exports: [ServiceUserVisitTasksService],
})
export class ServiceUserVisitTasksModule {}
