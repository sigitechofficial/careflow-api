import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DrivingTravelService } from './driving-travel.service';

@Module({
  imports: [PrismaModule],
  providers: [DrivingTravelService],
  exports: [DrivingTravelService],
})
export class TravelRoutesModule {}
