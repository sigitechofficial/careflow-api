type EmploymentLike = {
  endDate?: Date | null;
  isBankStaff?: boolean;
  isAgencyStaff?: boolean;
  contractType?: { name: string } | null;
} | null;

/** Maps operational employment data to Careflow HR employment-type labels. */
export function deriveHrEmploymentTypeLabel(employment: EmploymentLike): string | null {
  if (!employment) return null;
  if (employment.isBankStaff) return 'Bank';
  if (employment.isAgencyStaff) return 'Agency';

  const contractName = employment.contractType?.name;
  if (contractName === 'Voluntary') return 'Volunteer';
  if (contractName === 'Bank staff') return 'Bank';
  if (contractName === 'Agency') return 'Agency';
  if (contractName === 'Salaried' || contractName === 'Hourly paid') {
    return employment.endDate ? 'Fixed-term' : 'Permanent';
  }
  return contractName ?? null;
}
