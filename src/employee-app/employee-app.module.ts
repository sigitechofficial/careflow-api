import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmployeesModule } from '../employees/employees.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BillingModule } from '../billing/billing.module';
import { ServiceUserObservationsModule } from '../service-user-observations/service-user-observations.module';
import { EmployeeAppAuthController } from './employee-app-auth.controller';
import { EmployeeAppAuthService } from './employee-app-auth.service';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppHomeController } from './employee-app-home.controller';
import { EmployeeAppHomeService } from './employee-app-home.service';
import { EmployeeAppScheduleController } from './employee-app-schedule.controller';
import { EmployeeAppScheduleService } from './employee-app-schedule.service';
import { EmployeeAppClientsController } from './employee-app-clients.controller';
import { EmployeeAppClientsService } from './employee-app-clients.service';
import { EmployeeAppClientDetailService } from './employee-app-client-detail.service';
import { EmployeeAppVisitsController } from './employee-app-visits.controller';
import { EmployeeAppVisitsService } from './employee-app-visits.service';
import { EmployeeAppSalaryController } from './employee-app-salary.controller';
import { EmployeeAppSalaryService } from './employee-app-salary.service';
import { VisitTimelineService } from './visit-timeline.service';
import { ScheduledJobsHousekeepingModule } from '../scheduled-jobs-housekeeping/scheduled-jobs-housekeeping.module';
import { BodyMapModule } from '../body-map/body-map.module';
import { VisitAttendanceModule } from '../visit-attendance/visit-attendance.module';
import { EcmModule } from '../ecm/ecm.module';

@Module({
  imports: [
    EmployeesModule,
    AuditLogsModule,
    BillingModule,
    ServiceUserObservationsModule,
    ScheduledJobsHousekeepingModule,
    BodyMapModule,
    VisitAttendanceModule,
    EcmModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_TOKEN_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_TOKEN_EXPIRES_IN', '15m') as any,
        },
      }),
    }),
  ],
  controllers: [
    EmployeeAppAuthController,
    EmployeeAppHomeController,
    EmployeeAppScheduleController,
    EmployeeAppClientsController,
    EmployeeAppVisitsController,
    EmployeeAppSalaryController,
  ],
  providers: [
    EmployeeAppAuthService,
    EmployeeAppAuthGuard,
    EmployeeAppHomeService,
    EmployeeAppScheduleService,
    EmployeeAppClientsService,
    EmployeeAppClientDetailService,
    EmployeeAppVisitsService,
    VisitTimelineService,
    EmployeeAppSalaryService,
  ],
  exports: [EmployeeAppAuthService, EmployeeAppAuthGuard],
})
export class EmployeeAppModule {}
