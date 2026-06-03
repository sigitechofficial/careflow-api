import { Module } from '@nestjs/common';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';

/** Registered only when NODE_ENV !== production (see app.module.ts). */
@Module({
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
