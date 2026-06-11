/**
 * Seed: demo service-user data
 *
 * Populates the first ServiceUser in the database with realistic demo data for:
 *   - Medications (regular + PRN)
 *   - Observations (blood pressure, weight, pulse, temperature, O2, blood sugar)
 *   - Allergies
 *   - Inventory items
 *   - Flash message
 *   - Initial assessment
 *   - Legal documents (DNACPR flag)
 *
 * Safe to run multiple times — uses upsert/skipDuplicates where available.
 */

import type { PrismaClient } from '@prisma/client';

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

export type SeedDemoServiceUserOptions = {
  /** Target a specific service user; otherwise the oldest non-deleted row is used. */
  serviceUserId?: string;
  /** Skip basic medication rows (use API realistic seed for full MAR instead). */
  skipMedications?: boolean;
  /** Skip observation inserts when this service user already has observations. */
  skipObservationsIfAny?: boolean;
};

export async function seedDemoServiceUserData(
  prisma: PrismaClient,
  options: SeedDemoServiceUserOptions = {},
): Promise<void> {
  // ─── Target service user ──────────────────────────────────────────────────
  const serviceUser = options.serviceUserId
    ? await prisma.serviceUser.findFirst({
        where: { id: options.serviceUserId, deletedAt: null },
      })
    : await prisma.serviceUser.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
  if (!serviceUser) {
    console.log('  ⚠  No service user found — skipping demo data seed');
    return;
  }
  const suId = serviceUser.id;
  console.log(`  → Seeding demo data for service user: ${serviceUser.firstName} ${serviceUser.lastName} (${suId})`);

  // ─── Medication lookups (resolve IDs by code) ─────────────────────────────
  const [
    medTypeTablet,
    routeOral,
    catBloodPressure,
    catDiabetes,
    catPainRelief,
    catGeneral,
    freqOnceDaily,
    freqTwiceDaily,
    freqFourTimesDaily,
    freqAsRequired,
  ] = await Promise.all([
    prisma.medicationType.findUnique({ where: { code: 'TABLET' } }),
    prisma.medicationRoute.findUnique({ where: { code: 'ORAL' } }),
    prisma.medicationCategory.findUnique({ where: { code: 'BLOOD_PRESSURE' } }),
    prisma.medicationCategory.findUnique({ where: { code: 'DIABETES' } }),
    prisma.medicationCategory.findUnique({ where: { code: 'PAIN_RELIEF' } }),
    prisma.medicationCategory.findUnique({ where: { code: 'GENERAL' } }),
    prisma.medicationFrequency.findUnique({ where: { code: 'ONCE_DAILY' } }),
    prisma.medicationFrequency.findUnique({ where: { code: 'TWICE_DAILY' } }),
    prisma.medicationFrequency.findUnique({ where: { code: 'FOUR_TIMES_DAILY' } }),
    prisma.medicationFrequency.findUnique({ where: { code: 'AS_REQUIRED' } }),
  ]);

  // ─── Medications ──────────────────────────────────────────────────────────
  if (options.skipMedications) {
    console.log('    ⊘ Medications (skipped — use API realistic medication seed)');
  } else {
  const medications = [
    {
      medicationName: 'Atorvastatin',
      dose: '1 tablet',
      strength: '20mg',
      startDate: daysAgo(90),
      medicationTypeId: medTypeTablet?.id,
      routeId: routeOral?.id,
      categoryId: catBloodPressure?.id,
      frequencyId: freqOnceDaily?.id,
      frequencyText: 'Once daily at night',
      instructions: 'Take at the same time each evening.',
      notes: 'Monitor liver function annually.',
      medicationKind: 'REGULAR' as const,
      isControlledMedication: false,
    },
    {
      medicationName: 'Amlodipine',
      dose: '1 tablet',
      strength: '5mg',
      startDate: daysAgo(120),
      medicationTypeId: medTypeTablet?.id,
      routeId: routeOral?.id,
      categoryId: catBloodPressure?.id,
      frequencyId: freqOnceDaily?.id,
      frequencyText: 'Once daily in the morning',
      instructions: 'Take with or without food.',
      notes: 'Monitor for ankle swelling.',
      medicationKind: 'REGULAR' as const,
      isControlledMedication: false,
    },
    {
      medicationName: 'Metformin',
      dose: '1 tablet',
      strength: '500mg',
      startDate: daysAgo(180),
      medicationTypeId: medTypeTablet?.id,
      routeId: routeOral?.id,
      categoryId: catDiabetes?.id,
      frequencyId: freqTwiceDaily?.id,
      frequencyText: 'Twice daily with meals',
      instructions: 'Take with breakfast and evening meal to reduce GI side-effects.',
      notes: 'Monitor blood glucose levels. HbA1c check every 3 months.',
      medicationKind: 'REGULAR' as const,
      isControlledMedication: false,
    },
    {
      medicationName: 'Paracetamol',
      dose: '2 tablets',
      strength: '500mg',
      startDate: daysAgo(60),
      medicationTypeId: medTypeTablet?.id,
      routeId: routeOral?.id,
      categoryId: catPainRelief?.id,
      frequencyId: freqFourTimesDaily?.id,
      frequencyText: 'Four times daily — max 8 tablets in 24 hrs',
      instructions: 'Do not give with other paracetamol-containing products.',
      notes: 'Regular analgesia for chronic knee pain.',
      medicationKind: 'REGULAR' as const,
      isControlledMedication: false,
    },
    {
      medicationName: 'Ibuprofen',
      dose: '1 tablet',
      strength: '400mg',
      startDate: daysAgo(30),
      medicationTypeId: medTypeTablet?.id,
      routeId: routeOral?.id,
      categoryId: catPainRelief?.id,
      frequencyId: freqAsRequired?.id,
      frequencyText: 'As required — max 3 doses in 24 hrs',
      instructions: 'Give only with food. Do not give if GI upset present.',
      notes: 'PRN only — check with senior carer before administering.',
      medicationKind: 'PRN' as const,
      isControlledMedication: false,
    },
    {
      medicationName: 'Aspirin',
      dose: '1 tablet',
      strength: '75mg',
      startDate: daysAgo(200),
      medicationTypeId: medTypeTablet?.id,
      routeId: routeOral?.id,
      categoryId: catGeneral?.id,
      frequencyId: freqOnceDaily?.id,
      frequencyText: 'Once daily in the morning',
      instructions: 'Give with or after food.',
      notes: 'Low-dose antiplatelet. Do not stop without GP advice.',
      medicationKind: 'REGULAR' as const,
      isControlledMedication: false,
    },
  ];

  for (const med of medications) {
    const existing = await prisma.serviceUserMedication.findFirst({
      where: {
        serviceUserId: suId,
        medicationName: med.medicationName,
        strength: med.strength,
        deletedAt: null,
      },
    });
    if (!existing) {
      await prisma.serviceUserMedication.create({
        data: {
          serviceUserId: suId,
          ...med,
          status: 'ACTIVE',
          isActive: true,
        },
      });
    }
  }
  console.log('    ✓ Medications');
  }

  // ─── Observation types (resolve IDs by code) ──────────────────────────────
  const obsTypes = await prisma.observationType.findMany({
    where: {
      code: { in: ['BLOOD_PRESSURE', 'WEIGHT', 'PULSE', 'TEMPERATURE', 'OXYGEN_SATURATION', 'BLOOD_SUGAR', 'RESPIRATION'] },
    },
  });
  const obsById = Object.fromEntries(obsTypes.map(t => [t.code, t]));

  // ─── Observations ─────────────────────────────────────────────────────────
  const observations: Array<{
    observationTypeCode: string;
    recordedAt: Date;
    numericValue?: number;
    payload?: Record<string, string | number>;
    notes?: string;
  }> = [
    // Blood pressure — composite (systolic + diastolic)
    { observationTypeCode: 'BLOOD_PRESSURE', recordedAt: hoursAgo(2),   payload: { systolic: '128', diastolic: '82' }, notes: 'Slightly elevated — service user reports mild headache.' },
    { observationTypeCode: 'BLOOD_PRESSURE', recordedAt: daysAgo(1),    payload: { systolic: '134', diastolic: '88' } },
    { observationTypeCode: 'BLOOD_PRESSURE', recordedAt: daysAgo(3),    payload: { systolic: '122', diastolic: '78' }, notes: 'Good reading after morning medication.' },
    { observationTypeCode: 'BLOOD_PRESSURE', recordedAt: daysAgo(7),    payload: { systolic: '138', diastolic: '92' }, notes: 'Reported feeling dizzy. GP notified.' },
    { observationTypeCode: 'BLOOD_PRESSURE', recordedAt: daysAgo(14),   payload: { systolic: '126', diastolic: '80' } },
    // Weight
    { observationTypeCode: 'WEIGHT', recordedAt: daysAgo(1),  numericValue: 68.4, notes: 'Weighed after breakfast.' },
    { observationTypeCode: 'WEIGHT', recordedAt: daysAgo(8),  numericValue: 68.9 },
    { observationTypeCode: 'WEIGHT', recordedAt: daysAgo(15), numericValue: 69.1 },
    { observationTypeCode: 'WEIGHT', recordedAt: daysAgo(22), numericValue: 69.5, notes: 'Slight weight loss noted — GP review requested.' },
    // Pulse
    { observationTypeCode: 'PULSE', recordedAt: hoursAgo(3),  numericValue: 74 },
    { observationTypeCode: 'PULSE', recordedAt: daysAgo(1),   numericValue: 78, notes: 'Slightly elevated after short walk.' },
    { observationTypeCode: 'PULSE', recordedAt: daysAgo(4),   numericValue: 71 },
    { observationTypeCode: 'PULSE', recordedAt: daysAgo(9),   numericValue: 69 },
    // Temperature
    { observationTypeCode: 'TEMPERATURE', recordedAt: hoursAgo(4),  numericValue: 36.8 },
    { observationTypeCode: 'TEMPERATURE', recordedAt: daysAgo(2),   numericValue: 37.1 },
    { observationTypeCode: 'TEMPERATURE', recordedAt: daysAgo(5),   numericValue: 37.4, notes: 'Slightly raised — monitored closely.' },
    { observationTypeCode: 'TEMPERATURE', recordedAt: daysAgo(10),  numericValue: 36.6 },
    // Oxygen saturation
    { observationTypeCode: 'OXYGEN_SATURATION', recordedAt: hoursAgo(5), numericValue: 97 },
    { observationTypeCode: 'OXYGEN_SATURATION', recordedAt: daysAgo(2),  numericValue: 96, notes: 'Slightly low — sat upright, rechecked at 98%.' },
    { observationTypeCode: 'OXYGEN_SATURATION', recordedAt: daysAgo(6),  numericValue: 98 },
    // Blood sugar
    { observationTypeCode: 'BLOOD_SUGAR', recordedAt: hoursAgo(6),  numericValue: 6.8, notes: 'Pre-meal reading.' },
    { observationTypeCode: 'BLOOD_SUGAR', recordedAt: daysAgo(1),   numericValue: 7.4, notes: 'Post-breakfast — within target.' },
    { observationTypeCode: 'BLOOD_SUGAR', recordedAt: daysAgo(3),   numericValue: 8.1, notes: 'Slightly high after birthday cake at lunch.' },
    { observationTypeCode: 'BLOOD_SUGAR', recordedAt: daysAgo(7),   numericValue: 6.2 },
    // Respiration
    { observationTypeCode: 'RESPIRATION', recordedAt: hoursAgo(4),  numericValue: 16 },
    { observationTypeCode: 'RESPIRATION', recordedAt: daysAgo(2),   numericValue: 17 },
    { observationTypeCode: 'RESPIRATION', recordedAt: daysAgo(6),   numericValue: 15 },
  ];

  const existingObsCount = await prisma.serviceUserObservation.count({
    where: { serviceUserId: suId, deletedAt: null },
  });
  if (options.skipObservationsIfAny && existingObsCount > 0) {
    console.log(`    ⊘ Observations (${existingObsCount} already exist)`);
  } else {
    for (const obs of observations) {
      const obsType = obsById[obs.observationTypeCode];
      if (!obsType) continue;
      await prisma.serviceUserObservation.create({
        data: {
          serviceUserId: suId,
          observationTypeId: obsType.id,
          recordedAt: obs.recordedAt,
          numericValue: obs.numericValue ?? null,
          payload: obs.payload ?? undefined,
          notes: obs.notes ?? null,
          unit: obsType.unitLabel,
          isActive: true,
        },
      });
    }
    console.log('    ✓ Observations');
  }

  // ─── Allergies ────────────────────────────────────────────────────────────
  const allergyCatalogEntries = await prisma.allergyCatalog.findMany({
    where: {
      code: {
        in: ['MEDICATION_PENICILLIN', 'MEDICATION_IBUPROFEN_NSAIDS', 'FOOD_SHELLFISH_GENERAL'],
      },
    },
  });
  const allergyCatalogMap = Object.fromEntries(allergyCatalogEntries.map(a => [a.code, a]));

  const allergies = [
    {
      allergyCatalogId: allergyCatalogMap['MEDICATION_PENICILLIN']?.id ?? null,
      allergyName: 'Penicillin',
      comment: 'Causes anaphylactic reaction — adrenaline auto-injector to be kept on site at all times.',
    },
    {
      allergyCatalogId: allergyCatalogMap['MEDICATION_IBUPROFEN_NSAIDS']?.id ?? null,
      allergyName: 'Ibuprofen',
      comment: 'Causes gastric irritation and mild rash. NSAIDs to be avoided.',
    },
    {
      allergyCatalogId: allergyCatalogMap['FOOD_SHELLFISH_GENERAL']?.id ?? null,
      allergyName: 'Shellfish',
      comment: 'Causes hives and breathing difficulty. No shellfish in diet plan.',
    },
  ];

  for (const allergy of allergies) {
    const existing = await prisma.serviceUserAllergy.findFirst({
      where: { serviceUserId: suId, allergyName: allergy.allergyName, deletedAt: null },
    });
    if (!existing) {
      await prisma.serviceUserAllergy.create({
        data: { serviceUserId: suId, ...allergy, isActive: true },
      });
    }
  }
  console.log('    ✓ Allergies');

  // ─── Inventory items ──────────────────────────────────────────────────────
  const inventoryItems = [
    {
      itemName: 'Gold Wedding Ring',
      quantity: 1,
      itemValue: '£350',
      description: 'Yellow gold band with small diamond inset. Worn daily — kept in bedroom drawer overnight.',
      location: 'Bedroom drawer (bedside cabinet)',
      dateDeposited: daysAgo(365),
    },
    {
      itemName: 'Samsung Television 32"',
      quantity: 1,
      itemValue: '£280',
      description: 'Smart TV with remote control. No damage present on arrival.',
      location: 'Bedroom — wall-mounted',
      dateDeposited: daysAgo(300),
    },
    {
      itemName: 'Leather Handbag',
      quantity: 1,
      itemValue: '£120',
      description: 'Brown leather handbag containing purse and personal documents. Kept in wardrobe.',
      location: 'Bedroom wardrobe',
      dateDeposited: daysAgo(280),
    },
    {
      itemName: 'Electric Wheelchair',
      quantity: 1,
      itemValue: '£2,400',
      description: 'Quantum 6 electric wheelchair, black frame. Charger included. Serial: QT6-44821.',
      location: 'Hallway — charged overnight',
      dateDeposited: daysAgo(200),
    },
    {
      itemName: 'Pearl Necklace',
      quantity: 1,
      itemValue: '£180',
      description: 'Freshwater pearl necklace, silver clasp. Kept in jewellery box on dresser.',
      location: 'Bedroom dresser',
      dateDeposited: daysAgo(365),
    },
  ];

  for (const item of inventoryItems) {
    const existing = await prisma.serviceUserInventoryItem.findFirst({
      where: { serviceUserId: suId, itemName: item.itemName, deletedAt: null },
    });
    if (!existing) {
      await prisma.serviceUserInventoryItem.create({
        data: { serviceUserId: suId, ...item, isActive: true },
      });
    }
  }
  console.log('    ✓ Inventory items');

  // ─── Flash message ────────────────────────────────────────────────────────
  const existingFlash = await prisma.serviceUserFlashMessage.findFirst({
    where: { serviceUserId: suId, isCurrent: true, deletedAt: null },
  });
  if (!existingFlash) {
    await prisma.serviceUserFlashMessage.create({
      data: {
        serviceUserId: suId,
        message: 'DNACPR is in place — signed copy is in the red folder in the bedroom. Do not attempt resuscitation. Contact manager immediately if there is any concern.',
        displayUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
        status: 'ACTIVE',
        isCurrent: true,
        isActive: true,
      },
    });
  }
  console.log('    ✓ Flash message');

  // ─── Initial assessment ───────────────────────────────────────────────────
  const existingAssessment = await prisma.serviceUserInitialAssessment.findUnique({
    where: { serviceUserId: suId },
  });
  if (!existingAssessment) {
    await prisma.serviceUserInitialAssessment.create({
      data: {
        serviceUserId: suId,
        numberOfCarers: 2,
        likesToBeKnownAs: 'Betty',
        doorCode: '1234#',
        accessRisks: 'Two steps at front door — no ramp. Loose carpet edge at bedroom doorway (flagged to maintenance). Wet room floor can be slippery after bathing.',
        accessInstruction: 'Key safe on left of front door (code: 1234#). Alarm panel in hallway — code is 5678. Ring doorbell before entering.',
        reasonForAdmission: 'Progressive vascular dementia diagnosed 2019. Requires 24-hour support with all personal care, medication management, and meal preparation. Family unable to provide full-time care.',
        previousMedicalHistory: 'Vascular dementia (2019), Type 2 Diabetes (2015), Hypertension (2012), Osteoarthritis of both knees (2018), Mild heart failure — stable on current medication.',
        careInstructions: 'Assist with all personal care including washing, dressing, and continence. Encourage fluids throughout the day — minimum 1.5 litres. Service user prefers shower in the morning. Enjoys radio in background during care. Speak clearly and calmly — short sentences work best. Do not rush.',
        culturalReligiousNotes: 'Church of England. Attends Sunday service when health allows. Keeps a small bible on bedside table — important to her.',
        hydrationComment: 'Tends to forget to drink. Offer fluids every 2 hours. Prefers warm tea with one sugar and a little milk. Cold water acceptable in summer.',
        nutritionComment: 'No dietary restrictions beyond shellfish allergy. Soft diet preferred — some difficulty chewing. Enjoys porridge for breakfast and soft cooked vegetables. Monitor weight weekly.',
        additionalRisksNotes: 'Falls risk — refer to falls risk assessment. Unsettled at night — may attempt to get out of bed unassisted. Night sensor mat in use.',
        environmentAccessHazardsNotes: 'Loose carpet edge at bedroom door. Poor lighting in bathroom — additional nightlight fitted. Floor-level plug sockets in living room covered.',
        careCarerNumbersNote: '2 carers required for: all transfers, hoisting, personal care. 1 carer for: medication, meals, social engagement.',
        checklist: {},
        isActive: true,
      },
    });
  }
  console.log('    ✓ Initial assessment');

  // ─── Legal documents (DNACPR) ─────────────────────────────────────────────
  const existingLegal = await prisma.serviceUserLegalDocument.findUnique({
    where: { serviceUserId: suId },
  });
  if (!existingLegal) {
    await prisma.serviceUserLegalDocument.create({
      data: {
        serviceUserId: suId,
        dnacprInPlace: true,
        dnacprStartDate: daysAgo(120),
        isActive: true,
      },
    });
  } else if (!existingLegal.dnacprInPlace) {
    await prisma.serviceUserLegalDocument.update({
      where: { serviceUserId: suId },
      data: { dnacprInPlace: true, dnacprStartDate: daysAgo(120) },
    });
  }
  console.log('    ✓ Legal documents (DNACPR)');

  // ─── DOLS record ──────────────────────────────────────────────────────────
  const existingDols = await prisma.serviceUserDolsRecord.findFirst({
    where: { serviceUserId: suId, isCurrent: true, deletedAt: null },
  });
  if (!existingDols) {
    await prisma.serviceUserDolsRecord.create({
      data: {
        serviceUserId: suId,
        applicationDate: daysAgo(180),
        issueDate: daysAgo(150),
        renewalDate: new Date(Date.now() + 185 * 24 * 60 * 60 * 1000), // ~6 months ahead
        isCurrent: true,
        reportedToChc: true,
        notes: 'Standard DoLS authorisation approved by local authority. Renewal due. Remind manager 30 days before renewal date.',
        isActive: true,
      },
    });
  }
  console.log('    ✓ DOLS record');

  console.log(`  ✅ Demo data seeded for ${serviceUser.firstName} ${serviceUser.lastName}`);
}
