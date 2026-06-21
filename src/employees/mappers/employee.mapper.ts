import {
  labelForVisaTypeId,
  parseEmployeeVisaTypes,
  type EmployeeVisaType,
} from '../../organisation-general-settings/employee-visa-types.util';

import type { EmployeeListHolidaySnapshot } from '../employee-list-enrichment.util';

export function mapEmployeeListRow(
  row: any,
  visaTypes?: EmployeeVisaType[],
  holiday?: EmployeeListHolidaySnapshot | null,
) {
  const pd = row.personalDetail;
  const emp = row.employment;
  const floorLocationIds = (emp?.floorLocations ?? [])
    .map((entry: { location?: { id: string } | null }) => entry.location?.id)
    .filter((id: string | undefined): id is string => Boolean(id));
  return {
    id: row.id,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    fullName: pd ? `${pd.firstName} ${pd.lastName}` : null,
    firstName: pd?.firstName ?? null,
    lastName: pd?.lastName ?? null,
    photoUrl: pd?.photoUrl ?? null,
    status: pd?.status ?? null,
    jobTitle: emp?.jobTitle ?? null,
    role: emp?.role ?? null,
    grade: emp?.grade ?? null,
    contractType: emp?.contractType ?? null,
    visaTypeId: emp?.visaTypeId ?? null,
    visaTypeLabel: labelForVisaTypeId(visaTypes ?? [], emp?.visaTypeId ?? null),
    isInCountry: emp?.isInCountry ?? true,
    locationId: emp?.locationId ?? null,
    location: emp?.location ? { id: emp.location.id, name: emp.location.name } : null,
    baseLocationIds: floorLocationIds,
    accessAllZones: emp?.accessAllZones ?? false,
    employmentEndDate: emp?.endDate ?? null,
    leavingReason: emp?.leavingReason
      ? { id: emp.leavingReason.id, name: emp.leavingReason.name }
      : null,
    onHolidayToday: holiday?.onHolidayToday ?? false,
    holidayEndDate: holiday?.holidayEndDate ?? null,
  };
}
