import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EmployeesModule } from '../../employees/employees.module';
import { EmployeePersonalDetailsModule } from '../../employee-personal-details/employee-personal-details.module';
import { EmployeeEmploymentModule } from '../../employee-employment/employee-employment.module';
import { EmployeeComplianceModule } from '../../employee-compliance/employee-compliance.module';
import { MailModule } from '../../mail/mail.module';
import { CompanyProfileModule } from '../../company-profile/company-profile.module';
import { CareersController } from './careers/careers.controller';
import { CareersService } from './careers/careers.service';
import { HrModule } from '../hr.module';
import { RecruitmentNotificationHook } from './recruitment-notification.hook';
import { RecruitmentSummaryController } from './recruitment-summary.controller';
import { RecruitmentSummaryService } from './recruitment-summary.service';
import { VacanciesController } from './vacancies/vacancies.controller';
import { VacanciesService } from './vacancies/vacancies.service';
import { CandidatesController } from './candidates/candidates.controller';
import {
  CandidateConversionService,
  CandidatesService,
} from './candidates/candidates.service';
import { CandidateDocumentsService } from './candidates/candidate-documents.service';
import { InterviewEmailService } from './candidates/interview-email.service';
import { CandidateEmailService } from './candidates/candidate-email.service';
import { ApplicationAlertsService } from './application-alerts.service';
import { ApplicationSummaryJob } from './application-summary.job';
import { OrganisationGeneralSettingsModule } from '../../organisation-general-settings/organisation-general-settings.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    EmployeesModule,
    EmployeePersonalDetailsModule,
    EmployeeEmploymentModule,
    EmployeeComplianceModule,
    MailModule,
    CompanyProfileModule,
    OrganisationGeneralSettingsModule,
    forwardRef(() => HrModule),
  ],
  controllers: [
    RecruitmentSummaryController,
    VacanciesController,
    CandidatesController,
    CareersController,
  ],
  providers: [
    RecruitmentSummaryService,
    VacanciesService,
    CandidatesService,
    CandidateConversionService,
    CandidateDocumentsService,
    RecruitmentNotificationHook,
    CareersService,
    InterviewEmailService,
    CandidateEmailService,
    ApplicationAlertsService,
    ApplicationSummaryJob,
  ],
  exports: [CandidatesService, CareersService],
})
export class RecruitmentModule {}
