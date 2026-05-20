import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

async function main() {
  const dto = {
    enhancedRegularActionChecks: true,
    showRegularActionsInDailyList: true,
    allocateEmployeeBy: 'ZONE' as const,
    shiftAccessMinutesBefore: 4,
    shiftAccessMinutesAfter: 3,
  };

  try {
    const row = await prisma.organisationGeneralSettings.update({
      where: { id: DEFAULT_SETTINGS_ID },
      data: {
        reviewCarePlanAfterDays: undefined,
        handoverReportLastHours: undefined,
        archiveServiceUserAfterMonths: undefined,
        timeDisplayFormat: undefined,
        defaultCarerStatus: undefined,
        sendEmailWhenEmployeeActive: undefined,
        allowMultipleRoles: undefined,
        allowWeekendDaysInHoliday: undefined,
        mandateComplianceForNewEmployees: undefined,
        defaultHolidaysUnit: undefined,
        recruitmentFunctionalityRequired: undefined,
        complianceRequiredBy: undefined,
        complianceApprovalForNewEmployee: undefined,
        calculateSicknessBradfordScale: undefined,
        recordServiceUserWellbeing: undefined,
        recordEmployeeWellbeing: undefined,
        wellbeingRegularity: undefined,
        wellbeingLabel1: undefined,
        wellbeingLabel2: undefined,
        wellbeingLabel3: undefined,
        wellbeingLabel4: undefined,
        wellbeingLabel5: undefined,
        enhancedRegularActionChecks: dto.enhancedRegularActionChecks,
        showRegularActionsInDailyList: dto.showRegularActionsInDailyList,
        allowFastAction: undefined,
        actionsDefaultView: undefined,
        appDefaultToObservationsTab: undefined,
        allocateEmployeeBy: dto.allocateEmployeeBy,
        restrictCarerToAllocatedServiceUsers: undefined,
        restrictLoginToShiftTimes: undefined,
        preventCarerWebLogin: undefined,
        shiftAccessMinutesBefore: dto.shiftAccessMinutesBefore,
        shiftAccessMinutesAfter: dto.shiftAccessMinutesAfter,
        updatedById: '00000000-0000-4000-8000-000000000099',
      } as Record<string, unknown>,
    });
    console.log('OK', row.allocateEmployeeBy);
  } catch (e) {
    console.error('FAIL', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
