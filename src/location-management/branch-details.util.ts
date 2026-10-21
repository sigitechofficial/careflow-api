import { BadRequestException } from '@nestjs/common';
import { CqcRatingStatus, Prisma } from '@prisma/client';
import type { BranchStatus, CqcRating } from '@prisma/client';
import {
  cleanStringList,
  dateOnlyToIso,
  optionalText,
  parseDateOnly,
} from '../common/utils/date-only.util';
import { isOrganisationTimezone } from '../organisation-general-settings/organisation-timezone';
import type { LocationBranchDetailsDto } from './dto/create-location-zone-branch.dto';

/** ScheduleArea columns carrying branch CQC / address / locale details. */
export type BranchDetailsRow = {
  cqcLocationId: string | null;
  officialCqcName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
  country: string | null;
  countryCode: string;
  localAuthority: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  serviceTypes: string[];
  regulatedActivities: string[];
  registeredManagers: string[];
  nominatedIndividual: string | null;
  cqcRegistrationDate: Date | null;
  cqcRating: CqcRating | null;
  cqcRatingStatus: CqcRatingStatus | null;
  status: BranchStatus;
  timezone: string;
  currency: string;
  locale: string;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
};

function decimalToNumber(
  value: Prisma.Decimal | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/** API shape of the branch details (dates as YYYY-MM-DD, coordinates as numbers). */
export function branchDetailsResponse(row: BranchDetailsRow) {
  return {
    cqcLocationId: row.cqcLocationId,
    officialCqcName: row.officialCqcName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    town: row.town,
    county: row.county,
    postcode: row.postcode,
    country: row.country,
    countryCode: row.countryCode,
    localAuthority: row.localAuthority,
    phone: row.phone,
    email: row.email,
    website: row.website,
    serviceTypes: row.serviceTypes ?? [],
    regulatedActivities: row.regulatedActivities ?? [],
    registeredManagers: row.registeredManagers ?? [],
    nominatedIndividual: row.nominatedIndividual,
    cqcRegistrationDate: dateOnlyToIso(row.cqcRegistrationDate),
    cqcRating: row.cqcRating,
    cqcRatingStatus: row.cqcRatingStatus,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    locale: row.locale,
    latitude: decimalToNumber(row.latitude),
    longitude: decimalToNumber(row.longitude),
  };
}

/**
 * Rating + rating status must agree: a rating implies RATED; NOT_YET_RATED clears the rating.
 * Returns only the keys to write (omitted = unchanged).
 */
export function resolveCqcRatingFields(
  dto: Pick<LocationBranchDetailsDto, 'cqcRating' | 'cqcRatingStatus'>,
): {
  cqcRating?: CqcRating | null;
  cqcRatingStatus?: CqcRatingStatus | null;
} {
  const out: {
    cqcRating?: CqcRating | null;
    cqcRatingStatus?: CqcRatingStatus | null;
  } = {};
  if (dto.cqcRating !== undefined) out.cqcRating = dto.cqcRating;
  if (dto.cqcRatingStatus !== undefined)
    out.cqcRatingStatus = dto.cqcRatingStatus;

  if (out.cqcRating) {
    if (out.cqcRatingStatus === CqcRatingStatus.NOT_YET_RATED) {
      throw new BadRequestException(
        'A branch with a CQC rating cannot be "not yet rated"',
      );
    }
    if (out.cqcRatingStatus === undefined || out.cqcRatingStatus === null) {
      out.cqcRatingStatus = CqcRatingStatus.RATED;
    }
  } else if (
    out.cqcRatingStatus === CqcRatingStatus.NOT_YET_RATED &&
    out.cqcRating === undefined
  ) {
    out.cqcRating = null;
  }
  return out;
}

/**
 * Prisma write data for the branch details. Keys the client omitted stay undefined (unchanged);
 * nullable text accepts null / '' to clear. Non-null columns (countryCode, currency, locale,
 * timezone, status) ignore blanks.
 */
export function branchDetailsWriteData(dto: LocationBranchDetailsDto) {
  const timezone = dto.timezone?.trim() || undefined;
  if (timezone && !isOrganisationTimezone(timezone)) {
    throw new BadRequestException(`Unsupported timezone: ${timezone}`);
  }
  const postcode = optionalText(dto.postcode);
  const cqcLocationId = optionalText(dto.cqcLocationId);
  return {
    address: optionalText(dto.address),
    addressLine1: optionalText(dto.addressLine1),
    addressLine2: optionalText(dto.addressLine2),
    town: optionalText(dto.town),
    county: optionalText(dto.county),
    postcode: postcode ? postcode.toUpperCase() : postcode,
    country: optionalText(dto.country),
    countryCode: dto.countryCode?.trim().toUpperCase() || undefined,
    localAuthority: optionalText(dto.localAuthority),
    phone: optionalText(dto.phone),
    email: optionalText(dto.email),
    website: optionalText(dto.website),
    cqcLocationId,
    officialCqcName: optionalText(dto.officialCqcName),
    serviceTypes: cleanStringList(dto.serviceTypes),
    regulatedActivities: cleanStringList(dto.regulatedActivities),
    registeredManagers: cleanStringList(dto.registeredManagers),
    nominatedIndividual: optionalText(dto.nominatedIndividual),
    cqcRegistrationDate: parseDateOnly(
      dto.cqcRegistrationDate,
      'cqcRegistrationDate',
    ),
    ...resolveCqcRatingFields(dto),
    status: dto.status ?? undefined,
    timezone,
    currency: dto.currency?.trim().toUpperCase() || undefined,
    locale: dto.locale?.trim() || undefined,
    latitude: dto.latitude === undefined ? undefined : dto.latitude,
    longitude: dto.longitude === undefined ? undefined : dto.longitude,
  } satisfies Prisma.ScheduleAreaUncheckedUpdateInput;
}

/**
 * Keep lookups.Location.name in step with a renamed branch, for both naming conventions in use:
 * the seeded real branches use the branch name itself; branches added in the admin use
 * "<Zone> - <Branch>". Any other (custom) location name is left alone → null.
 */
export function renamedBranchLocationName(params: {
  locationName: string | null | undefined;
  oldBranchName: string;
  newBranchName: string;
  zoneName: string | null | undefined;
}): string | null {
  const { locationName, oldBranchName, newBranchName, zoneName } = params;
  if (!locationName || oldBranchName === newBranchName) return null;
  if (locationName === oldBranchName) return newBranchName;
  const zone = zoneName?.trim();
  if (zone && locationName === `${zone} - ${oldBranchName}`)
    return `${zone} - ${newBranchName}`;
  return null;
}
