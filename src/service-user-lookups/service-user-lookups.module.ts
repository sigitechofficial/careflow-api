import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServiceUserLookupsController } from './service-user-lookups.controller';
import { ServiceUserLookupsService } from './service-user-lookups.service';

@Module({
  imports: [PrismaModule],
  controllers: [ServiceUserLookupsController],
  providers: [ServiceUserLookupsService],
})
export class ServiceUserLookupsModule {}
