import { Module } from '@nestjs/common';
import { TemporaryInspectorsController } from './temporary-inspectors.controller';
import { TemporaryInspectorsService } from './temporary-inspectors.service';

@Module({
  controllers: [TemporaryInspectorsController],
  providers: [TemporaryInspectorsService],
  exports: [TemporaryInspectorsService],
})
export class TemporaryInspectorsModule {}
