import { Prisma } from '@prisma/client';
import { electionsFromLegacyFlags } from './uk-deduction-elections.util';
import { gatewayCredentialsPublicFlags } from './payroll-gateway-credentials.util';

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

export function mapTaxCode(row: {
  id: string;
  code: string;
  label: string;
  description: string | null;
  group: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    description: row.description,
    group: row.group,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function decimalNum(value: Prisma.Decimal | number): number {
  return typeof value === 'number' ? value : Number(value);
}

export function mapStatutoryRateSet(row: {
  id: string;
  taxYearId: string;
  nation: string;
  version: number;
  isActive: boolean;
  personalAllowanceAnnual: Prisma.Decimal | number;
  basicRateBandAnnual: Prisma.Decimal | number;
  higherRateThresholdAnnual: Prisma.Decimal | number;
  additionalRateThresholdAnnual: Prisma.Decimal | number;
  basicRatePercent: Prisma.Decimal | number;
  higherRatePercent: Prisma.Decimal | number;
  additionalRatePercent: Prisma.Decimal | number;
  niLelWeekly: Prisma.Decimal | number;
  niPtWeekly: Prisma.Decimal | number;
  niStWeekly: Prisma.Decimal | number;
  niUelWeekly: Prisma.Decimal | number;
  niLelMonthly: Prisma.Decimal | number;
  niPtMonthly: Prisma.Decimal | number;
  niStMonthly: Prisma.Decimal | number;
  niUelMonthly: Prisma.Decimal | number;
  niEmployeeRateMainPercent: Prisma.Decimal | number;
  niEmployeeRateUpperPercent: Prisma.Decimal | number;
  niEmployerRatePercent: Prisma.Decimal | number;
  sourceNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  taxYear?: { id: string; code: string; label: string; isCurrent: boolean } | null;
}) {
  return {
    id: row.id,
    taxYearId: row.taxYearId,
    nation: row.nation,
    version: row.version,
    isActive: row.isActive,
    personalAllowanceAnnual: decimalNum(row.personalAllowanceAnnual),
    basicRateBandAnnual: decimalNum(row.basicRateBandAnnual),
    higherRateThresholdAnnual: decimalNum(row.higherRateThresholdAnnual),
    additionalRateThresholdAnnual: decimalNum(row.additionalRateThresholdAnnual),
    basicRatePercent: decimalNum(row.basicRatePercent),
    higherRatePercent: decimalNum(row.higherRatePercent),
    additionalRatePercent: decimalNum(row.additionalRatePercent),
    niLelWeekly: decimalNum(row.niLelWeekly),
    niPtWeekly: decimalNum(row.niPtWeekly),
    niStWeekly: decimalNum(row.niStWeekly),
    niUelWeekly: decimalNum(row.niUelWeekly),
    niLelMonthly: decimalNum(row.niLelMonthly),
    niPtMonthly: decimalNum(row.niPtMonthly),
    niStMonthly: decimalNum(row.niStMonthly),
    niUelMonthly: decimalNum(row.niUelMonthly),
    niEmployeeRateMainPercent: decimalNum(row.niEmployeeRateMainPercent),
    niEmployeeRateUpperPercent: decimalNum(row.niEmployeeRateUpperPercent),
    niEmployerRatePercent: decimalNum(row.niEmployerRatePercent),
    sourceNote: row.sourceNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    taxYear: row.taxYear
      ? {
          id: row.taxYear.id,
          code: row.taxYear.code,
          label: row.taxYear.label,
          isCurrent: row.taxYear.isCurrent,
        }
      : null,
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
  hoursNormallyWorked?: string | null;
  p45Received?: boolean;
  studentLoanPlan1: boolean;
  studentLoanPlan2: boolean;
  studentLoanPlan4: boolean;
  studentLoanPlan5?: boolean;
  postgraduateLoan: boolean;
  pensionOptedIn: boolean;
  pensionSchemeRef: string | null;
  apprenticeshipStartDate?: Date | null;
  isDirector?: boolean | null;
  directorAppointedOn?: Date | null;
  directorNicMethod?: string | null;
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
    hoursNormallyWorked: row.hoursNormallyWorked ?? null,
    p45Received: Boolean(row.p45Received),
    studentLoanPlan1: row.studentLoanPlan1,
    studentLoanPlan2: row.studentLoanPlan2,
    studentLoanPlan4: row.studentLoanPlan4,
    studentLoanPlan5: row.studentLoanPlan5 ?? false,
    postgraduateLoan: row.postgraduateLoan,
    pensionOptedIn: row.pensionOptedIn,
    pensionSchemeRef: row.pensionSchemeRef,
    apprenticeshipStartDate: dateToIsoDate(row.apprenticeshipStartDate ?? null),
    isDirector: row.isDirector ?? null,
    directorAppointedOn: dateToIsoDate(row.directorAppointedOn ?? null),
    directorNicMethod: row.directorNicMethod ?? null,
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
  salaryEntryPeriod?: string | null;
  salaryEntryAmount?: Prisma.Decimal | null;
  salaryProrationMethod?: string | null;
  salaryCoverage?: string | null;
  guaranteedWeeklyHours?: Prisma.Decimal | null;
  guaranteeTopUp?: string | null;
  guaranteeQualifyingTime?: string | null;
  guaranteeLeaveTreatment?: string | null;
  approvedById?: string | null;
  approvedAt?: Date | null;
  createdById?: string | null;
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
    salaryEntryPeriod: row.salaryEntryPeriod ?? null,
    salaryEntryAmount: decimalToNumber(row.salaryEntryAmount ?? null),
    salaryProrationMethod: row.salaryProrationMethod ?? null,
    salaryCoverage: row.salaryCoverage ?? null,
    guaranteedWeeklyHours: decimalToNumber(row.guaranteedWeeklyHours ?? null),
    guaranteeTopUp: row.guaranteeTopUp ?? null,
    guaranteeQualifyingTime: row.guaranteeQualifyingTime ?? null,
    guaranteeLeaveTreatment: row.guaranteeLeaveTreatment ?? null,
    createdById: row.createdById ?? null,
    approvedById: row.approvedById ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    currency: row.currency,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapEmployerSettings(row: {
  id: string;
  hmrcOfficeNumber: string | null;
  employerPayeReference: string | null;
  accountsOfficeReference: string | null;
  taxDistrict: string | null;
  employerTradingName: string | null;
  notes: string | null;
  activeHmrcEnvironment?: string | null;
  gatewayTestUserId?: string | null;
  gatewayTestPasswordEnc?: string | null;
  gatewayLiveUserId?: string | null;
  gatewayLivePasswordEnc?: string | null;
  gatewayCredentialsUpdatedAt?: Date | null;
  employmentAllowanceClaimed?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const office = row.hmrcOfficeNumber?.trim() || null;
  const paye = row.employerPayeReference?.trim() || null;
  const gateway = gatewayCredentialsPublicFlags({
    activeHmrcEnvironment: row.activeHmrcEnvironment ?? 'TEST',
    gatewayTestUserId: row.gatewayTestUserId ?? null,
    gatewayTestPasswordEnc: row.gatewayTestPasswordEnc ?? null,
    gatewayLiveUserId: row.gatewayLiveUserId ?? null,
    gatewayLivePasswordEnc: row.gatewayLivePasswordEnc ?? null,
    gatewayCredentialsUpdatedAt: row.gatewayCredentialsUpdatedAt ?? null,
  });
  return {
    id: row.id,
    hmrcOfficeNumber: office,
    employerPayeReference: paye,
    accountsOfficeReference: row.accountsOfficeReference?.trim() || null,
    taxDistrict: row.taxDistrict?.trim() || null,
    employerTradingName: row.employerTradingName?.trim() || null,
    notes: row.notes?.trim() || null,
    fullPayeReference: office && paye ? `${office}/${paye}` : null,
    isComplete: Boolean(office && paye && row.accountsOfficeReference?.trim()),
    employmentAllowanceClaimed: Boolean(row.employmentAllowanceClaimed),
    ...gateway,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
