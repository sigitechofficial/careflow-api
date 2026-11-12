import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { openfdaConfig } from './config/openfda.config';
import { mailConfig } from './config/mail.config';
import { azureCostConfig } from './config/azure-cost.config';
import { jobsConfig } from './config/jobs.config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { OrgScopeModule } from './common/org-scope/org-scope.module';
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
import { SupervisionModule } from './supervision/supervision.module';
import { EmployeeNonCoreActivitiesModule } from './employee-non-core-activities/employee-non-core-activities.module';
import { SpecialVisitsModule } from './special-visits/special-visits.module';
import { EmployeeAllocationsModule } from './employee-allocations/employee-allocations.module';
import { FeedbackModule } from './feedback/feedback.module';
import { ServiceUserReferralsModule } from './service-user-referrals/service-user-referrals.module';
import { EmployeeWorkingPatternsModule } from './employee-working-patterns/employee-working-patterns.module';
import { EmployeeComplianceModule } from './employee-compliance/employee-compliance.module';
import { EmployeeReportsModule } from './employee-reports/employee-reports.module';
import { EmployeeHoursModule } from './employee-hours/employee-hours.module';
import { EmployeeAbsencesModule } from './employee-absences/employee-absences.module';
import { ServiceUserHoursModule } from './service-user-hours/service-user-hours.module';
import { ComplianceTypesModule } from './compliance-types/compliance-types.module';
import { ComplianceRequirementsModule } from './compliance-requirements/compliance-requirements.module';
import { ComplianceReportsModule } from './compliance-reports/compliance-reports.module';
import { FilesModule } from './files/files.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { LookupsModule } from './lookups/lookups.module';
import { EmployeeHolidaysModule } from './employee-holidays/employee-holidays.module';
import { EmployeeLeavingRecordsModule } from './employee-leaving-records/employee-leaving-records.module';
import { HrModule } from './hr/hr.module';
import { RecruitmentModule } from './hr/recruitment/recruitment.module';
import { TemporaryInspectorsModule } from './temporary-inspectors/temporary-inspectors.module';
import { ServiceUsersModule } from './service-users/service-users.module';
import { ServiceUserPortalModule } from './service-user-portal/service-user-portal.module';
import { ServiceUserContactsModule } from './service-user-contacts/service-user-contacts.module';
import { ServiceUserAddressesModule } from './service-user-addresses/service-user-addresses.module';
import { ServiceUserAssignmentsModule } from './service-user-assignments/service-user-assignments.module';
import { ServiceUserPhotosModule } from './service-user-photos/service-user-photos.module';
import { ServiceUserLookupsModule } from './service-user-lookups/service-user-lookups.module';
import { ServiceUserInventoryModule } from './service-user-inventory/service-user-inventory.module';
import { ServiceUserAllergiesModule } from './service-user-allergies/service-user-allergies.module';
import { ServiceUserPrivacyModule } from './service-user-privacy/service-user-privacy.module';
import { ServiceUserNfcTagsModule } from './service-user-nfc-tags/service-user-nfc-tags.module';
import { ServiceUsersMedicalModule } from './service-users-medical/service-users-medical.module';
import { ObservationLookupsModule } from './observation-lookups/observation-lookups.module';
import { ServiceUserObservationsModule } from './service-user-observations/service-user-observations.module';
import { ServiceUserFlashMessagesModule } from './service-user-flash-messages/service-user-flash-messages.module';
import { ServiceUserDocumentsModule } from './service-user-documents/service-user-documents.module';
import { ServiceUserAbsencesModule } from './service-user-absences/service-user-absences.module';
import { ServiceUserDomCareModule } from './service-user-dom-care/service-user-dom-care.module';
import { ServiceUserVisitPlansModule } from './service-user-visit-plans/service-user-visit-plans.module';
import { ServiceUserVisitTasksModule } from './service-user-visit-tasks/service-user-visit-tasks.module';
import { TaskCatalogueModule } from './task-catalogue/task-catalogue.module';
import { VisitPlanJobsModule } from './visit-plan-jobs/visit-plan-jobs.module';
import { ServiceUserInitialAssessmentModule } from './service-user-initial-assessment/service-user-initial-assessment.module';
import { ServiceUserAssessmentsModule } from './service-user-assessments/service-user-assessments.module';
import { ServiceUserCarePlansModule } from './service-user-care-plans/service-user-care-plans.module';
import { FundingTypesModule } from './funding-types/funding-types.module';
import { FundersModule } from './funders/funders.module';
import { ServiceUserFundingModule } from './service-user-funding/service-user-funding.module';
import { LiveInLookupsModule } from './live-in-lookups/live-in-lookups.module';
import { ServiceUserLiveInProfilesModule } from './service-user-live-in-profiles/service-user-live-in-profiles.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MedicationLookupsModule } from './medication-lookups/medication-lookups.module';
import { OpenFdaModule } from './openfda/openfda.module';
import { ServiceUserMedicationsModule } from './service-user-medications/service-user-medications.module';
import { MedicationPacksModule } from './medication-packs/medication-packs.module';
import { MedicationAllergiesModule } from './medication-allergies/medication-allergies.module';
import { MedicationSupportProfilesModule } from './medication-support-profiles/medication-support-profiles.module';
import { MedicationSchedulesModule } from './medication-schedules/medication-schedules.module';
import { MedicationAdministrationModule } from './medication-administration/medication-administration.module';
import { MedicationChartsModule } from './medication-charts/medication-charts.module';
import { MedicationReportsModule } from './medication-reports/medication-reports.module';
import { MedicationReviewsModule } from './medication-reviews/medication-reviews.module';
import { MedicationStatusCodesModule } from './medication-status-codes/medication-status-codes.module';
import { MedicationAdministrationRoundsModule } from './medication-administration-rounds/medication-administration-rounds.module';
import { MedicationSupplyModule } from './medication-supply/medication-supply.module';
import { CalendarEventTypesModule } from './calendar-event-types/calendar-event-types.module';
import { ServiceUserCalendarModule } from './service-user-calendar/service-user-calendar.module';
import { InitialAssessmentTemplatesModule } from './initial-assessment-templates/initial-assessment-templates.module';
import { InitialAssessmentsModule } from './initial-assessments/initial-assessments.module';
import { ScheduleAreasModule } from './schedule-areas/schedule-areas.module';
import { SchedulesModule } from './schedules/schedules.module';
import { ScheduledJobsModule } from './scheduled-jobs/scheduled-jobs.module';
import { ScheduledVisitsModule } from './scheduled-visits/scheduled-visits.module';
import { ScheduleRunsModule } from './schedule-runs/schedule-runs.module';
import { VisitActionsModule } from './visit-actions/visit-actions.module';
import { JobAllocationsModule } from './job-allocations/job-allocations.module';
import { ScheduleTimelinesModule } from './schedule-timelines/schedule-timelines.module';
import { ScheduleFiltersModule } from './schedule-filters/schedule-filters.module';
import { ScheduledJobsHousekeepingModule } from './scheduled-jobs-housekeeping/scheduled-jobs-housekeeping.module';
import { CallOffVisitsModule } from './call-off-visits/call-off-visits.module';
import { ScheduleReportsModule } from './schedule-reports/schedule-reports.module';
import { CompanyProfileModule } from './company-profile/company-profile.module';
import { OrganisationGeneralSettingsModule } from './organisation-general-settings/organisation-general-settings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { LocationManagementModule } from './location-management/location-management.module';
import { CarePathwayModule } from './care-pathway/care-pathway.module';
import { FormSelectionModule } from './form-selection/form-selection.module';
import { FormBuilderModule } from './form-builder/form-builder.module';
import { CarePlanTextModule } from './care-plan-text/care-plan-text.module';
import { PathwayChecklistsModule } from './pathway-checklists/pathway-checklists.module';
import { PathwayActionsModule } from './pathway-actions/pathway-actions.module';
import { PictureGalleryModule } from './picture-gallery/picture-gallery.module';
import { BodyMapModule } from './body-map/body-map.module';
import { IncidentsModule } from './incidents/incidents.module';
import { SurveysModule } from './surveys/surveys.module';
import { CqcEvidenceModule } from './cqc-evidence/cqc-evidence.module';
import { SpecialistPathwaysModule } from './specialist-pathways/specialist-pathways.module';
import { SafeguardingModule } from './safeguarding/safeguarding.module';
import { CrmModule } from './crm/crm.module';
import { ReferralMailboxModule } from './referral-mailbox/referral-mailbox.module';
import { CarerMessagesModule } from './carer-messages/carer-messages.module';
import { OnCallModule } from './on-call/on-call.module';
import { EmployeeHoursApprovalsModule } from './employee-hours-approvals/employee-hours-approvals.module';
import { DevToolsModule } from './dev-tools/dev-tools.module';
import { BillingModule } from './billing/billing.module';
import { EmployeeAppModule } from './employee-app/employee-app.module';
import { EcmModule } from './ecm/ecm.module';
import { PayrollModule } from './payroll/payroll.module';
import { OfficeSalariesModule } from './office-salaries/office-salaries.module';
import { SetupChecklistModule } from './setup-checklist/setup-checklist.module';
import { RoleTasksModule } from './role-tasks/role-tasks.module';
import { ScriptsModule } from './scripts/scripts.module';
import { RoleResponsibilitiesModule } from './role-responsibilities/role-responsibilities.module';
import { LearningModule } from './learning/learning.module';
import { PoliciesModule } from './policies/policies.module';
import { PlatformCostsModule } from './platform-costs/platform-costs.module';
import { MessageDeliveryModule } from './message-delivery/message-delivery.module';
import { ServiceUserCommunicationNotesModule } from './service-user-communication-notes/service-user-communication-notes.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, databaseConfig, openfdaConfig, mailConfig, azureCostConfig, jobsConfig],
      validate: validateEnv,
    }),
    // Register once here only: importing forRoot() in several feature modules made
    // every @Cron handler fire once per import (3x duplicate alerts/jobs).
    ScheduleModule.forRoot(),
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
    HealthModule,
    MailModule,
    OrgScopeModule,
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
    SupervisionModule,
    EmployeeNonCoreActivitiesModule,
    SpecialVisitsModule,
    EmployeeAllocationsModule,
    FeedbackModule,
    ServiceUserReferralsModule,
    EmployeeWorkingPatternsModule,
    EmployeeComplianceModule,
    ComplianceTypesModule,
    ComplianceRequirementsModule,
    ComplianceReportsModule,
    EmployeeReportsModule,
    EmployeeHoursModule,
    EmployeeAbsencesModule,
    EmployeeHolidaysModule,
    EmployeeLeavingRecordsModule,
    HrModule,
    RecruitmentModule,
    FilesModule,
    AuditLogsModule,
    LookupsModule,
    TemporaryInspectorsModule,
    ServiceUsersModule,
    ServiceUserHoursModule,
    ServiceUserPortalModule,
    ServiceUserContactsModule,
    ServiceUserAddressesModule,
    ServiceUserAssignmentsModule,
    ServiceUserPhotosModule,
    ServiceUserLookupsModule,
    ServiceUserInventoryModule,
    ServiceUserAllergiesModule,
    ServiceUserPrivacyModule,
    ServiceUserNfcTagsModule,
    ServiceUsersMedicalModule,
    ObservationLookupsModule,
    ServiceUserObservationsModule,
    ServiceUserFlashMessagesModule,
    ServiceUserDocumentsModule,
    ServiceUserAbsencesModule,
    CalendarEventTypesModule,
    ServiceUserCalendarModule,
    ServiceUserDomCareModule,
    ServiceUserVisitPlansModule,
    ServiceUserVisitTasksModule,
    TaskCatalogueModule,
    VisitPlanJobsModule,
    ServiceUserInitialAssessmentModule,
    ServiceUserAssessmentsModule,
    ServiceUserCarePlansModule,
    InitialAssessmentTemplatesModule,
    InitialAssessmentsModule,
    FundingTypesModule,
    FundersModule,
    ServiceUserFundingModule,
    LiveInLookupsModule,
    ServiceUserLiveInProfilesModule,
    NotificationsModule,
    MedicationLookupsModule,
    OpenFdaModule,
    ServiceUserMedicationsModule,
    MedicationPacksModule,
    MedicationAllergiesModule,
    MedicationSupportProfilesModule,
    MedicationSchedulesModule,
    MedicationAdministrationModule,
    MedicationChartsModule,
    MedicationReportsModule,
    MedicationReviewsModule,
    MedicationStatusCodesModule,
    MedicationAdministrationRoundsModule,
    MedicationSupplyModule,
    ScheduleAreasModule,
    SchedulesModule,
    ScheduledJobsModule,
    ScheduledVisitsModule,
    ScheduleRunsModule,
    VisitActionsModule,
    JobAllocationsModule,
    ScheduleTimelinesModule,
    ScheduleFiltersModule,
    ScheduledJobsHousekeepingModule,
    CallOffVisitsModule,
    ScheduleReportsModule,
    CompanyProfileModule,
    OrganisationGeneralSettingsModule,
    DashboardModule,
    LocationManagementModule,
    CarePathwayModule,
    FormSelectionModule,
    FormBuilderModule,
    CarePlanTextModule,
    PathwayChecklistsModule,
    PathwayActionsModule,
    PictureGalleryModule,
    BodyMapModule,
    IncidentsModule,
    SurveysModule,
    CqcEvidenceModule,
    SpecialistPathwaysModule,
    SafeguardingModule,
    CrmModule,
    ReferralMailboxModule,
    CarerMessagesModule,
    OnCallModule,
    EmployeeHoursApprovalsModule,
    DevToolsModule,
    BillingModule,
    EmployeeAppModule,
    EcmModule,
    PayrollModule,
    OfficeSalariesModule,
    SetupChecklistModule,
    RoleTasksModule,
    ScriptsModule,
    RoleResponsibilitiesModule,
    LearningModule,
    PoliciesModule,
    PlatformCostsModule,
    MessageDeliveryModule,
    ServiceUserCommunicationNotesModule,
    JobsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
