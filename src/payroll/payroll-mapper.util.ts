import { Prisma } from '@prisma/client';
import { electionsFromLegacyFlags } from './uk-deduction-elections.util';

export function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === 'number' ? value : Number(value);
}

export function dateToIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function mapTaxYear(row: {
  id: string;
  code: string;
  label: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    startDate: dateToIsoDate(row.startDate),
    endDate: dateToIsoDate(row.endDate),
    isCurrent: row.isCurrent,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapSchedule(row: {
  id: string;
  name: string;
  code: string;
  frequency: string;
  anchorDay: number;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    frequency: row.frequency,
    anchorDay: row.anchorDay,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapPeriod(row: {
  id: string;
  scheduleId: string;
  taxYearId: string;
  sequence: number;
  label: string;
  periodStart: Date;
  periodEnd: Date;
  paymentDate: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    taxYearId: row.taxYearId,
    sequence: row.sequence,
    label: row.label,
    periodStart: dateToIsoDate(row.periodStart),
    periodEnd: dateToIsoDate(row.periodEnd),
    paymentDate: dateToIsoDate(row.paymentDate),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapProfile(row: {
  id: string;
  employeeId: string;
  scheduleId: string | null;
  status: string;
  taxCode: string | null;
  taxCodeWeek1Month1: boolean;
  niCategory: string | null;
  starterDeclaration: string;
  studentLoanPlan1: boolean;
  studentLoanPlan2: boolean;
  studentLoanPlan4: boolean;
  studentLoanPlan5?: boolean;
  postgraduateLoan: boolean;
  pensionOptedIn: boolean;
  pensionSchemeRef: string | null;
  deductionElections?: unknown;
  bankSortCode: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const deductionElections = electionsFromLegacyFlags({
    studentLoanPlan1: row.studentLoanPlan1,
    studentLoanPlan2: row.studentLoanPlan2,
    studentLoanPlan4: row.studentLoanPlan4,
    studentLoanPlan5: row.studentLoanPlan5,
    postgraduateLoan: row.postgraduateLoan,
    pensionOptedIn: row.pensionOptedIn,
    deductionElections: row.deductionElections,
  });
  return {
    id: row.id,
    employeeId: row.employeeId,
    scheduleId: row.scheduleId,
    status: row.status,
    taxCode: row.taxCode,
    taxCodeWeek1Month1: row.taxCodeWeek1Month1,
    niCategory: row.niCategory,
    starterDeclaration: row.starterDeclaration,
    studentLoanPlan1: row.studentLoanPlan1,
    studentLoanPlan2: row.studentLoanPlan2,
    studentLoanPlan4: row.studentLoanPlan4,
    studentLoanPlan5: row.studentLoanPlan5 ?? false,
    postgraduateLoan: row.postgraduateLoan,
    pensionOptedIn: row.pensionOptedIn,
    pensionSchemeRef: row.pensionSchemeRef,
    deductionElections,
    bankSortCode: row.bankSortCode,
    bankAccountNumber: row.bankAccountNumber,
    bankAccountName: row.bankAccountName,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapAgreement(row: {
  id: string;
  employeeId: string;
  scheduleId: string | null;
  basis: string;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  payCardId: string | null;
  annualSalary: Prisma.Decimal | null;
  contractedHours: Prisma.Decimal | null;
  hourlyRateOverride: Prisma.Decimal | null;
  currency: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    scheduleId: row.scheduleId,
    basis: row.basis,
    status: row.status,
    effectiveFrom: dateToIsoDate(row.effectiveFrom),
    effectiveTo: dateToIsoDate(row.effectiveTo),
    payCardId: row.payCardId,
    annualSalary: decimalToNumber(row.annualSalary),
    contractedHours: decimalToNumber(row.contractedHours),
    hourlyRateOverride: decimalToNumber(row.hourlyRateOverride),
    currency: row.currency,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
