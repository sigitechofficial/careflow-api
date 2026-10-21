import { app, InvocationContext, Timer } from '@azure/functions';
import { FUNCTION_JOBS } from '../jobs';
import { triggerJob } from '../trigger';

// One timer function per job; the function name equals the job name, so a single job can be
// paused with the app setting `AzureWebJobs.<name>.Disabled = true` (no redeploy).
for (const job of FUNCTION_JOBS) {
  app.timer(job.name, {
    schedule: job.schedule,
    runOnStartup: false,
    useMonitor: true,
    handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
      if (timer.isPastDue) {
        context.warn(`[jobs] job=${job.name} timer is past due (schedule ${job.schedule}, ${job.description}) - running now`);
      }
      await triggerJob(job.name, context);
    },
  });
}
