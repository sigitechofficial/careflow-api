import { Module } from '@nestjs/common';
import { SpecialVisitsController } from './special-visits.controller';
import { SpecialVisitsService } from './special-visits.service';

@Module({
  controllers: [SpecialVisitsController],
  providers: [SpecialVisitsService],
})
export class SpecialVisitsModule {}
