type LookupLite = { id: string; name: string; code: string } | null;

function mapLookup(l: { id: string; name: string; code: string } | null | undefined): LookupLite {
  if (!l) return null;
  return { id: l.id, name: l.name, code: l.code };
}

function mapRiskLevel(l: { id: string; name: string; code: string; color: string | null } | null | undefined) {
  if (!l) return null;
  return { id: l.id, name: l.name, code: l.code, color: l.color };
}

function mapEmployeeBrief(
  e:
    | ({
        id: string;
        personalDetail: { firstName: string; lastName: string } | null;
      } | null)
    | undefined,
) {
  if (!e) return null;
  return {
    id: e.id,
    firstName: e.personalDetail?.firstName ?? null,
    lastName: e.personalDetail?.lastName ?? null,
  };
}

export function mapServiceUserListRow(user: {
  id: string;
  serviceUserNumber: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: Date | null;
  isActive: boolean;
  serviceStartDate: Date | null;
  profilePhotoUrl: string | null;
  title: { id: string; name: string; code: string } | null;
  gender: { id: string; name: string; code: string } | null;
  status: { id: string; name: string; code: string } | null;
  careType: { id: string; name: string; code: string } | null;
  fundingType: { id: string; name: string; code: string } | null;
  riskLevel: { id: string; name: string; code: string; color: string | null } | null;
  location: { id: string; name: string } | null;
  keyWorker: { id: string; personalDetail: { firstName: string; lastName: string } | null } | null;
  namedNurse: { id: string; personalDetail: { firstName: string; lastName: string } | null } | null;
  absences?: { id: string }[];
  flashMessages?: { id: string }[];
}) {
  return {
    id: user.id,
    serviceUserNumber: user.serviceUserNumber,
    firstName: user.firstName,
    lastName: user.lastName,
    preferredName: user.preferredName,
    dateOfBirth: user.dateOfBirth,
    isActive: user.isActive,
    serviceStartDate: user.serviceStartDate,
    profilePhotoUrl: user.profilePhotoUrl,
    title: mapLookup(user.title),
    gender: mapLookup(user.gender),
    status: mapLookup(user.status),
    careType: mapLookup(user.careType),
    fundingType: mapLookup(user.fundingType),
    riskLevel: mapRiskLevel(user.riskLevel),
    location: user.location ? { id: user.location.id, name: user.location.name } : null,
    keyWorker: mapEmployeeBrief(user.keyWorker),
    namedNurse: mapEmployeeBrief(user.namedNurse),
    hasActiveAbsence: (user.absences?.length ?? 0) > 0,
    hasActiveFlashMessage: (user.flashMessages?.length ?? 0) > 0,
  };
}

export function mapServiceUserDetail(user: {
  id: string;
  serviceUserNumber: string | null;
  residentId: string | null;
  residentGuid: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: Date | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  nhsNumber: string | null;
  socialServicesRef: string | null;
  nationalInsuranceNumber: string | null;
  serviceStartDate: Date | null;
  serviceEndDate: Date | null;
  profilePhotoUrl: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  title: { id: string; name: string; code: string } | null;
  gender: { id: string; name: string; code: string } | null;
  maritalStatus: { id: string; name: string; code: string } | null;
  status: { id: string; name: string; code: string } | null;
  careType: { id: string; name: string; code: string } | null;
  fundingType: { id: string; name: string; code: string } | null;
  riskLevel: { id: string; name: string; code: string; color: string | null } | null;
  location: { id: string; name: string } | null;
  keyWorker: { id: string; personalDetail: { firstName: string; lastName: string } | null } | null;
  namedNurse: { id: string; personalDetail: { firstName: string; lastName: string } | null } | null;
  address:
    | ({
        id: string;
        addressLine1: string | null;
        addressLine2: string | null;
        town: string | null;
        county: string | null;
        country: string | null;
        postcode: string | null;
        latitude: unknown;
        longitude: unknown;
        accessInstructions: string | null;
        keySafeNumber: string | null;
      } | null)
    | undefined;
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
    mobile: string | null;
    email: string | null;
    address: string | null;
    isPrimary: boolean;
    isEmergencyContact: boolean;
    canReceiveUpdates: boolean;
    notes: string | null;
    relationshipType: { id: string; name: string; code: string } | null;
  }>;
  references: Array<{
    id: string;
    referenceType: string;
    referenceValue: string;
    notes: string | null;
  }>;
  assignments: Array<{
    id: string;
    keyWorkerId: string | null;
    namedNurseId: string | null;
    locationId: string | null;
    startDate: Date | null;
    endDate: Date | null;
    notes: string | null;
    keyWorker: { id: string; personalDetail: { firstName: string; lastName: string } | null } | null;
    namedNurse: { id: string; personalDetail: { firstName: string; lastName: string } | null } | null;
    location: { id: string; name: string } | null;
  }>;
  photos: Array<{
    id: string;
    fileName: string;
    originalName: string;
    fileUrl: string;
    mimeType: string;
    isProfilePhoto: boolean;
    uploadedAt: Date;
  }>;
}) {
  const assignment = user.assignments?.[0] ?? null;
  const profilePhoto = user.photos?.[0] ?? null;
  return {
    id: user.id,
    serviceUserNumber: user.serviceUserNumber,
    residentId: user.residentId,
    residentGuid: user.residentGuid,
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
    preferredName: user.preferredName,
    dateOfBirth: user.dateOfBirth,
    email: user.email,
    phone: user.phone,
    mobile: user.mobile,
    nhsNumber: user.nhsNumber,
    socialServicesRef: user.socialServicesRef,
    nationalInsuranceNumber: user.nationalInsuranceNumber,
    serviceStartDate: user.serviceStartDate,
    serviceEndDate: user.serviceEndDate,
    profilePhotoUrl: user.profilePhotoUrl,
    notes: user.notes,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    title: mapLookup(user.title),
    gender: mapLookup(user.gender),
    maritalStatus: mapLookup(user.maritalStatus),
    status: mapLookup(user.status),
    careType: mapLookup(user.careType),
    fundingType: mapLookup(user.fundingType),
    riskLevel: mapRiskLevel(user.riskLevel),
    location: user.location ? { id: user.location.id, name: user.location.name } : null,
    keyWorker: mapEmployeeBrief(user.keyWorker),
    namedNurse: mapEmployeeBrief(user.namedNurse),
    address: user.address
      ? {
          id: user.address.id,
          addressLine1: user.address.addressLine1,
          addressLine2: user.address.addressLine2,
          town: user.address.town,
          county: user.address.county,
          country: user.address.country,
          postcode: user.address.postcode,
          latitude: user.address.latitude,
          longitude: user.address.longitude,
          accessInstructions: user.address.accessInstructions,
          keySafeNumber: user.address.keySafeNumber,
        }
      : null,
    contacts: user.contacts.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      mobile: c.mobile,
      email: c.email,
      address: c.address,
      isPrimary: c.isPrimary,
      isEmergencyContact: c.isEmergencyContact,
      canReceiveUpdates: c.canReceiveUpdates,
      notes: c.notes,
      relationshipType: mapLookup(c.relationshipType),
    })),
    references: user.references.map((r) => ({
      id: r.id,
      referenceType: r.referenceType,
      referenceValue: r.referenceValue,
      notes: r.notes,
    })),
    assignment: assignment
      ? {
          id: assignment.id,
          keyWorkerId: assignment.keyWorkerId,
          namedNurseId: assignment.namedNurseId,
          locationId: assignment.locationId,
          startDate: assignment.startDate,
          endDate: assignment.endDate,
          notes: assignment.notes,
          keyWorker: mapEmployeeBrief(assignment.keyWorker),
          namedNurse: mapEmployeeBrief(assignment.namedNurse),
          location: assignment.location ? { id: assignment.location.id, name: assignment.location.name } : null,
        }
      : null,
    profilePhoto: profilePhoto
      ? {
          id: profilePhoto.id,
          fileName: profilePhoto.fileName,
          originalName: profilePhoto.originalName,
          fileUrl: profilePhoto.fileUrl,
          mimeType: profilePhoto.mimeType,
          isProfilePhoto: profilePhoto.isProfilePhoto,
          uploadedAt: profilePhoto.uploadedAt,
        }
      : null,
  };
}
