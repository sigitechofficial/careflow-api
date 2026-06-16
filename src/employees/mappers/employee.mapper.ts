export function mapEmployeeListRow(row: any) {
  const pd = row.personalDetail;
  const emp = row.employment;
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
    isInCountry: emp?.isInCountry ?? true,
    locationId: emp?.locationId ?? null,
    location: emp?.location ?? null,
    baseLocationIds:
      emp?.baseLocations
        ?.map((row: { locationId?: string }) => row.locationId)
        .filter((id: string | undefined): id is string => Boolean(id)) ?? [],
  };
}

