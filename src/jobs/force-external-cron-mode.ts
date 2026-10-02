/**
 * Side-effect import for the job CLI: must be imported before AppModule so the in-process
 * @Cron handlers stay idle (CRON_MODE=external) in a one-off Container Apps Job run.
 */
process.env.CRON_MODE = 'external';

export {};
