import { Injectable, Logger } from '@nestjs/common';

/**
 * Placeholder for future CSV/Excel/PDF export generation.
 * Reports currently return structured JSON; pass `export=true` to record export intent in audit logs.
 */
@Injectable()
export class ScheduleReportExportHook {
  private readonly logger = new Logger(ScheduleReportExportHook.name);

  async generateExportFile(_params: {
    reportType: string;
    format: 'CSV' | 'EXCEL' | 'PDF';
    rows: unknown[];
  }): Promise<{ supported: false; message: string }> {
    this.logger.debug(
      `[TODO] Schedule report export (${_params.reportType}, ${_params.format}, ${_params.rows.length} rows) — file generation not implemented`,
    );
    return {
      supported: false,
      message: 'Export file generation is not yet implemented. Use JSON response data.',
    };
  }

  /** Placeholder for async/long-running report notifications. */
  notifyReportReady(_userId: string, _reportType: string): void {
    this.logger.debug('[TODO] Long-running schedule report ready notification not implemented');
  }
}
