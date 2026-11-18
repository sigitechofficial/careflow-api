import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StaffAccessService } from './staff-access.service';

/** Staff whose end date has passed lose their office login and Care app access (checked hourly). */
@Injectable()
export class StaffLeaversAccessJob {
  private readonly logger = new Logger(StaffLeaversAccessJob.name);

  constructor(private readonly access: StaffAccessService) {}

  @Cron('15 * * * *', { timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      const ended = await this.access.endAccessForLeavers();
      if (ended > 0) this.logger.log(`Ended sign-in access for ${ended} leaver(s)`);
    } catch (err) {
      this.logger.error(`Leavers sign-in check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
