import { Module } from '@nestjs/common';
import { ObservationLookupsController } from './observation-lookups.controller';
import { ObservationLookupsService } from './observation-lookups.service';

@Module({
  controllers: [ObservationLookupsController],
  providers: [ObservationLookupsService],
  exports: [ObservationLookupsService],
})
export class ObservationLookupsModule {}
