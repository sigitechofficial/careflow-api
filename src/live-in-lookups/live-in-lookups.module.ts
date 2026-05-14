import { Module } from '@nestjs/common';
import { LiveInLookupsController } from './live-in-lookups.controller';
import { LiveInLookupsService } from './live-in-lookups.service';

@Module({
  controllers: [LiveInLookupsController],
  providers: [LiveInLookupsService],
  exports: [LiveInLookupsService],
})
export class LiveInLookupsModule {}
