/**
 * Hard-delete all service users and their related transactional data.
 * Keeps lookup/catalog rows (status codes, medication types, assessment templates, etc.).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/clear-service-users-data.ts
 *   npx ts-node --transpile-only prisma/scripts/clear-service-users-data.ts --dry-run
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function count(label: string, fn: () => Promise<number>): Promise<number> {
  const n = await fn();
  console.log(`  ${label}: ${n}`);
  return n;
}

async function main() {
  const before = await prisma.serviceUser.count();
  console.log(`Service users before: ${before}`);
  if (before === 0) {
    console.log('Nothing to clear.');
    return;
  }

  if (DRY_RUN) {
    console.log('\nDry run — counts only (no deletes).\n');
    await count('visitAction', () => prisma.visitAction.count());
    await count('jobAllocation', () => prisma.jobAllocation.count());
    await count('callOffVisit', () => prisma.callOffVisit.count());
    await count('scheduledVisit', () => prisma.scheduledVisit.count());
    await count('scheduledJob', () => prisma.scheduledJob.count());
    await count('medicationAdministrationEvent', () =>
      prisma.medicationAdministrationEvent.count(),
    );
    await count('medicationStockRecord', () => prisma.medicationStockRecord.count());
    await count('medicationSupplyDelivery', () => prisma.medicationSupplyDelivery.count());
    await count('medicationSupplyProfile', () => prisma.medicationSupplyProfile.count());
    await count('medicationSchedule', () => prisma.medicationSchedule.count());
    await count('medicationPackDeliveryLine', () => prisma.medicationPackDeliveryLine.count());
    await count('medicationPackDelivery', () => prisma.medicationPackDelivery.count());
    await count('medicationPackContentsSnapshotLine', () =>
      prisma.medicationPackContentsSnapshotLine.count(),
    );
    await count('medicationPackContentsSnapshot', () =>
      prisma.medicationPackContentsSnapshot.count(),
    );
    await count('medicationPackMember', () => prisma.medicationPackMember.count());
    await count('medicationPackCompartment', () => prisma.medicationPackCompartment.count());
    await count('medicationPackItem', () => prisma.medicationPackItem.count());
    await count('serviceUserMedication', () => prisma.serviceUserMedication.count());
    await count('medicationPack', () => prisma.medicationPack.count());
    await count('medicationAllergy', () => prisma.medicationAllergy.count());
    await count('medicationSupportProfile', () => prisma.medicationSupportProfile.count());
    await count('medicationReview', () => prisma.medicationReview.count());
    await count('initialAssessmentSubmission', () =>
      prisma.initialAssessmentSubmission.count(),
    );
    await count('serviceUserObservation', () => prisma.serviceUserObservation.count());
    await count('serviceUserFlashMessage', () => prisma.serviceUserFlashMessage.count());
    await count('serviceUserCalendarEvent', () => prisma.serviceUserCalendarEvent.count());
    await count('serviceUserLiveInContractDocument', () =>
      prisma.serviceUserLiveInContractDocument.count(),
    );
    await count('serviceUserLiveInPreferredCarer', () =>
      prisma.serviceUserLiveInPreferredCarer.count(),
    );
    await count('serviceUserLiveInBlockedCarer', () =>
      prisma.serviceUserLiveInBlockedCarer.count(),
    );
    await count('serviceUserLiveInProfile', () => prisma.serviceUserLiveInProfile.count());
    await count('serviceUserDomCarePreferredCarer', () =>
      prisma.serviceUserDomCarePreferredCarer.count(),
    );
    await count('serviceUserDomCareBlockedCarer', () =>
      prisma.serviceUserDomCareBlockedCarer.count(),
    );
    await count('serviceUserDomCare', () => prisma.serviceUserDomCare.count());
    await count('serviceUserInitialAssessment', () =>
      prisma.serviceUserInitialAssessment.count(),
    );
    await count('serviceUserAbsence', () => prisma.serviceUserAbsence.count());
    await count('serviceUserDolsRecord', () => prisma.serviceUserDolsRecord.count());
    await count('serviceUserLegalDocument', () => prisma.serviceUserLegalDocument.count());
    await count('serviceUserAllergy', () => prisma.serviceUserAllergy.count());
    await count('serviceUserInventoryItem', () => prisma.serviceUserInventoryItem.count());
    await count('serviceUserPhoto', () => prisma.serviceUserPhoto.count());
    await count('serviceUserAssignment', () => prisma.serviceUserAssignment.count());
    await count('serviceUserReference', () => prisma.serviceUserReference.count());
    await count('serviceUserAddress', () => prisma.serviceUserAddress.count());
    await count('serviceUserContact', () => prisma.serviceUserContact.count());
    await count('serviceUserFunding', () => prisma.serviceUserFunding.count());
    await count('bodyMapAlert', () => prisma.bodyMapAlert.count());
    await count('bodyMapRecord', () => prisma.bodyMapRecord.count());
    await count('serviceUser', () => prisma.serviceUser.count());
    console.log('\nRe-run without --dry-run to apply.');
    return;
  }

  console.log('\nClearing service user data…\n');

  await prisma.$transaction(
    async (tx) => {
      // Scheduling (Restrict FK on serviceUserId)
      await tx.visitAction.deleteMany();
      await tx.jobAllocation.deleteMany();
      await tx.callOffVisit.deleteMany();
      await tx.scheduledVisit.deleteMany();
      await tx.scheduledJob.deleteMany();

      // Body map — must run before medications (BodyMapMedicationSite → ServiceUserMedication RESTRICT)
      await tx.bodyMapAlert.deleteMany();
      await tx.bodyMapRecord.deleteMany();

      // Medication — deepest children first
      await tx.medicationAdministrationEvent.deleteMany();
      await tx.medicationStockRecord.deleteMany();
      await tx.medicationSupplyDelivery.deleteMany();
      await tx.medicationSupplyProfile.deleteMany();
      await tx.medicationSchedule.deleteMany();
      await tx.medicationPackDeliveryLine.deleteMany();
      await tx.medicationPackDelivery.deleteMany();
      await tx.medicationPackContentsSnapshotLine.deleteMany();
      await tx.medicationPackContentsSnapshot.deleteMany();
      await tx.medicationPackMember.deleteMany();
      await tx.medicationPackCompartment.deleteMany();
      await tx.medicationPackItem.deleteMany();

      await tx.medicationPack.updateMany({ data: { supersededByPackId: null } });
      await tx.serviceUserMedication.updateMany({ data: { medicationPackId: null } });
      await tx.serviceUser.updateMany({ data: { currentFundingId: null } });

      await tx.serviceUserMedication.deleteMany();
      await tx.medicationPack.deleteMany();
      await tx.medicationAllergy.deleteMany();
      await tx.medicationSupportProfile.deleteMany();
      await tx.medicationReview.deleteMany();

      // Assessments & observations
      await tx.initialAssessmentSubmission.deleteMany();
      await tx.serviceUserObservation.deleteMany();
      await tx.serviceUserFlashMessage.deleteMany();
      await tx.serviceUserCalendarEvent.deleteMany();

      // Live-in & dom care
      await tx.serviceUserLiveInContractDocument.deleteMany();
      await tx.serviceUserLiveInPreferredCarer.deleteMany();
      await tx.serviceUserLiveInBlockedCarer.deleteMany();
      await tx.serviceUserLiveInProfile.deleteMany();
      await tx.serviceUserDomCarePreferredCarer.deleteMany();
      await tx.serviceUserDomCareBlockedCarer.deleteMany();
      await tx.serviceUserDomCare.deleteMany();

      // Profile & records
      await tx.serviceUserInitialAssessment.deleteMany();
      await tx.serviceUserAbsence.deleteMany();
      await tx.serviceUserDolsRecord.deleteMany();
      await tx.serviceUserLegalDocument.deleteMany();
      await tx.serviceUserAllergy.deleteMany();
      await tx.serviceUserInventoryItem.deleteMany();
      await tx.serviceUserPhoto.deleteMany();
      await tx.serviceUserAssignment.deleteMany();
      await tx.serviceUserReference.deleteMany();
      await tx.serviceUserAddress.deleteMany();
      await tx.serviceUserContact.deleteMany();
      await tx.serviceUserFunding.deleteMany();

      const deleted = await tx.serviceUser.deleteMany();
      console.log(`  Deleted ${deleted.count} service user(s)`);
    },
    { timeout: 120_000 },
  );

  await prisma.companyProfile.updateMany({ data: { numberOfServiceUsers: 0 } });
  await prisma.temporaryInspector.updateMany({ data: { serviceUserKeys: [] } });

  const after = await prisma.serviceUser.count();
  console.log(`\nService users after: ${after}`);
  console.log('Done — lookups, employees, and users were kept.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
