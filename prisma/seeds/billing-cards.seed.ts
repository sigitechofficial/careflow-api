import { PrismaClient } from '@prisma/client';

export async function seedBillingCards(prisma: PrismaClient) {
  const payCards = [
    {
      name: 'Standard Carer Pay — London',
      code: 'PAY-LON-2026',
      assignmentLevel: 'BRANCH' as const,
      assignmentLabel: 'Branch: London',
      status: 'ACTIVE' as const,
      effectiveFrom: new Date('2026-04-01'),
      rules: [
        {
          label: 'Weekday morning',
          dayType: 'WEEKDAY' as const,
          startTime: '06:00',
          endTime: '12:00',
          rateType: 'HOURLY' as const,
          amount: 12,
          sortOrder: 0,
        },
        {
          label: 'Weekday evening',
          dayType: 'WEEKDAY' as const,
          startTime: '18:00',
          endTime: '22:00',
          rateType: 'HOURLY' as const,
          amount: 13,
          sortOrder: 1,
        },
        {
          label: 'Night',
          dayType: 'ANY' as const,
          startTime: '22:00',
          endTime: '07:00',
          rateType: 'HOURLY' as const,
          amount: 15,
          sortOrder: 2,
        },
      ],
    },
    {
      name: 'Agency Worker Pay',
      code: 'PAY-AGY-2026',
      assignmentLevel: 'WORKER_TYPE' as const,
      assignmentLabel: 'Worker type: Agency',
      status: 'ACTIVE' as const,
      effectiveFrom: new Date('2026-01-01'),
      rules: [
        {
          label: 'Standard hourly',
          dayType: 'ANY' as const,
          rateType: 'HOURLY' as const,
          amount: 11.5,
          sortOrder: 0,
        },
      ],
    },
  ];

  for (const card of payCards) {
    const { rules, ...data } = card;
    await prisma.payCard.upsert({
      where: { code: data.code },
      update: {},
      create: {
        ...data,
        rules: { create: rules },
      },
    });
  }

  const chargeCards = [
    {
      name: 'London Council 2026 Rates',
      code: 'CHG-LA-LON-26',
      assignmentLevel: 'FUNDER' as const,
      assignmentLabel: 'Funder: London Council',
      billingFrequency: 'FOUR_WEEKLY' as const,
      status: 'ACTIVE' as const,
      effectiveFrom: new Date('2026-04-01'),
      effectiveTo: new Date('2027-03-31'),
      rules: [
        {
          label: 'Personal care weekday',
          serviceType: 'Personal care',
          dayType: 'WEEKDAY' as const,
          chargeMethod: 'HOURLY_PRO_RATA' as const,
          rateType: 'HOURLY' as const,
          amount: 25,
          minimumMinutes: 30,
          sortOrder: 0,
        },
        {
          label: 'Waking night',
          dayType: 'ANY' as const,
          chargeMethod: 'WAKING_NIGHT' as const,
          rateType: 'FIXED' as const,
          amount: 180,
          sortOrder: 1,
        },
      ],
    },
    {
      name: 'Private Client — Default',
      code: 'CHG-PVT-DEF',
      assignmentLevel: 'ORGANISATION_DEFAULT' as const,
      assignmentLabel: 'Organisation default',
      billingFrequency: 'WEEKLY' as const,
      status: 'ACTIVE' as const,
      effectiveFrom: new Date('2026-01-01'),
      rules: [
        {
          label: 'Hourly pro-rata',
          chargeMethod: 'HOURLY_PRO_RATA' as const,
          rateType: 'HOURLY' as const,
          amount: 28,
          minimumMinutes: 30,
          sortOrder: 0,
        },
      ],
    },
  ];

  for (const card of chargeCards) {
    const { rules, ...data } = card;
    await prisma.chargeCard.upsert({
      where: { code: data.code },
      update: {},
      create: {
        ...data,
        rules: { create: rules },
      },
    });
  }
}
