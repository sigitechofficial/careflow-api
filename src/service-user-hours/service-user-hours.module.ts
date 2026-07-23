import { Module } from '@nestjs/common';
import { ServiceUserHoursController } from './service-user-hours.controller';
import { ServiceUserHoursService } from './service-user-hours.service';

@Module({
  controllers: [ServiceUserHoursController],
  providers: [ServiceUserHoursService],
})
export class ServiceUserHoursModule {}
