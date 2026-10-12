/**
 * Dependency-injection smoke test: the application module graph still resolves after the payroll
 * remediation changed constructors and module imports. Providers are constructed; no lifecycle
 * hook runs (no database connection, no scheduled job).
 */
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PayrollRunsService } from '../../src/billing/payroll-runs.service';
import { EmployeePayoutsService } from '../../src/billing/employee-payouts.service';
import { PayItemsService } from '../../src/billing/pay-items.service';
import { VisitReconciliationsService } from '../../src/billing/visit-reconciliations.service';
import { EcmManualAttendanceService } from '../../src/ecm/ecm-manual-attendance.service';
import { PayrollRunsService as UkPayrollRunsService } from '../../src/payroll/payroll-runs.service';

it('resolves the services whose dependencies changed', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  for (const token of [
    PayrollRunsService,
    EmployeePayoutsService,
    PayItemsService,
    VisitReconciliationsService,
    EcmManualAttendanceService,
    UkPayrollRunsService,
  ]) {
    expect(moduleRef.get(token, { strict: false })).toBeInstanceOf(token);
  }
}, 240_000);
