import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { EmployeesModule } from './employees/employees.module';
import { EmployeePersonalDetailsModule } from './employee-personal-details/employee-personal-details.module';
import { EmployeeEmergencyContactsModule } from './employee-emergency-contacts/employee-emergency-contacts.module';
import { EmployeeEmploymentModule } from './employee-employment/employee-employment.module';
import { EmployeeSkillsModule } from './employee-skills/employee-skills.module';
import { EmployeeCertificationsModule } from './employee-certifications/employee-certifications.module';
import { EmployeeDocumentsModule } from './employee-documents/employee-documents.module';
import { EmployeeReviewsModule } from './employee-reviews/employee-reviews.module';
import { EmployeeNonCoreActivitiesModule } from './employee-non-core-activities/employee-non-core-activities.module';
import { EmployeeWorkingPatternsModule } from './employee-working-patterns/employee-working-patterns.module';
import { EmployeeComplianceModule } from './employee-compliance/employee-compliance.module';
import { EmployeeReportsModule } from './employee-reports/employee-reports.module';
import { FilesModule } from './files/files.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { LookupsModule } from './lookups/lookups.module';
import { EmployeeHolidaysModule } from './employee-holidays/employee-holidays.module';
import { EmployeeLeavingRecordsModule } from './employee-leaving-records/employee-leaving-records.module';
import { TemporaryInspectorsModule } from './temporary-inspectors/temporary-inspectors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, databaseConfig],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('app.throttleTtlMs', 60_000),
            limit: config.get<number>('app.throttleLimit', 200),
          },
        ],
        errorMessage: 'Too many requests. Please slow down and try again shortly.',
        setHeaders: true,
      }),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    EmployeesModule,
    EmployeePersonalDetailsModule,
    EmployeeEmergencyContactsModule,
    EmployeeEmploymentModule,
    EmployeeSkillsModule,
    EmployeeCertificationsModule,
    EmployeeDocumentsModule,
    EmployeeReviewsModule,
    EmployeeNonCoreActivitiesModule,
    EmployeeWorkingPatternsModule,
    EmployeeComplianceModule,
    EmployeeReportsModule,
    EmployeeHolidaysModule,
    EmployeeLeavingRecordsModule,
    FilesModule,
    AuditLogsModule,
    LookupsModule,
    TemporaryInspectorsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
