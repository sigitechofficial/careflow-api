/**
 * The client's real organisation and CQC-registered branches (reference data, all environments).
 * Source: client spec (Companies House 05142064 / CQC provider 1-101656545), 2026-09-29.
 *
 * Deliberately NOT set (unknown until the client confirms): branch email, latitude/longitude
 * (geocode with prisma/scripts/geocode-branches.ts), CQC rating for branches without one.
 */

export type AllforCareBranchSeed = {
  /** Stable upsert key. */
  cqcLocationId: string;
  /** Display name — ScheduleArea.name and lookups.Location.name. */
  name: string;
  /** ScheduleArea.code (unique). */
  code: string;
  /** 3-character visit reference branch code (VIS-[BRANCH]-…). */
  visitRefCode: string;
  sortOrder: number;
  /** lookups.Zone name the branch sits under in Location Management. */
  zoneName: string;
  officialCqcName: string;
  addressLine1: string;
  addressLine2: string | null;
  town: string;
  county: string;
  postcode: string;
  country: string;
  countryCode: string;
  localAuthority: string;
  phone: string;
  email: string | null;
  website: string;
  serviceTypes: string[];
  regulatedActivities: string[];
  registeredManagers: string[];
  nominatedIndividual: string | null;
  /** YYYY-MM-DD */
  cqcRegistrationDate: string | null;
  cqcRating:
    | 'OUTSTANDING'
    | 'GOOD'
    | 'REQUIRES_IMPROVEMENT'
    | 'INADEQUATE'
    | null;
  cqcRatingStatus: 'RATED' | 'NOT_YET_RATED' | null;
  status: 'ACTIVE' | 'INACTIVE' | 'CLOSED';
  timezone: string;
  currency: string;
  locale: string;
};

export const ALLFOR_CARE_ORGANISATION = {
  companyName: 'Allfor Care Services Limited',
  displayName: 'Allfor Care Services Limited',
  legalName: 'ALLFOR CARE SERVICES LIMITED',
  /** Companies House number (CompanyProfile.companyNumber). */
  companyNumber: '05142064',
  cqcProviderId: '1-101656545',
  companyStatus: 'Active',
  companyType: 'Private Limited Company',
  /** YYYY-MM-DD */
  incorporationDate: '2004-06-01',
  /** 86900 — Other human health activities (UK SIC 2007). */
  sicCodes: ['86900'],
  registeredAddressLine1: '15 Maswell Park Road',
  registeredAddressLine2: null as string | null,
  registeredTown: 'Hounslow',
  registeredCounty: null as string | null,
  registeredPostcode: 'TW3 2DL',
  registeredCountry: 'England',
  countryCode: 'GB',
  currency: 'GBP',
  locale: 'en-GB',
  companyWebsite: 'https://www.allforcare.co.uk',
  /** OrganisationGeneralSettings.timezone */
  timezone: 'Europe/London',
} as const;

const PROVIDER_DEFAULTS = {
  addressLine2: null,
  country: 'England',
  countryCode: 'GB',
  email: null,
  website: 'https://www.allforcare.co.uk',
  status: 'ACTIVE',
  timezone: 'Europe/London',
  currency: 'GBP',
  locale: 'en-GB',
} as const;

const SUZETTE_THOMAS = 'Mrs Suzette Lisa Ann Marie Thomas';

export const ALLFOR_CARE_BRANCHES: AllforCareBranchSeed[] = [
  {
    ...PROVIDER_DEFAULTS,
    cqcLocationId: '1-115898258',
    name: 'Allfor Care Hounslow',
    code: 'ALLFOR_HOUNSLOW',
    visitRefCode: 'HOU',
    sortOrder: 10,
    zoneName: 'London',
    officialCqcName:
      'Allfor Care Alpha Care Recruitment West and Home Care Service Limited',
    addressLine1: '15 Maswell Park Road',
    town: 'Hounslow',
    county: 'Middlesex',
    postcode: 'TW3 2DL',
    localAuthority: 'Hounslow',
    phone: '020 8898 2867',
    serviceTypes: ['Homecare agency'],
    regulatedActivities: ['Personal care'],
    registeredManagers: [SUZETTE_THOMAS],
    nominatedIndividual: SUZETTE_THOMAS,
    cqcRegistrationDate: null,
    cqcRating: null,
    cqcRatingStatus: null,
  },
  {
    ...PROVIDER_DEFAULTS,
    cqcLocationId: '1-4551889312',
    name: 'Allfor Care Hammersmith',
    code: 'ALLFOR_HAMMERSMITH',
    visitRefCode: 'HAM',
    sortOrder: 20,
    zoneName: 'London',
    officialCqcName: 'Hammersmith',
    addressLine1: '239 Kensington High Street',
    town: 'London',
    county: 'Greater London',
    postcode: 'W8 6SN',
    localAuthority: 'Kensington and Chelsea',
    phone: '07903 068899',
    serviceTypes: ['Homecare agency', 'Supported housing', 'Supported living'],
    regulatedActivities: [
      'Personal care',
      'Treatment of disease, disorder or injury',
    ],
    registeredManagers: [SUZETTE_THOMAS],
    nominatedIndividual: SUZETTE_THOMAS,
    cqcRegistrationDate: null,
    cqcRating: null,
    cqcRatingStatus: null,
  },
  {
    ...PROVIDER_DEFAULTS,
    cqcLocationId: '1-2754362586',
    name: 'Allfor Care Harrow',
    code: 'ALLFOR_HARROW',
    visitRefCode: 'HAR',
    sortOrder: 30,
    zoneName: 'London',
    officialCqcName: 'Allfor Care',
    addressLine1: '8D Clifton Road',
    town: 'Harrow',
    county: 'Middlesex',
    postcode: 'HA3 9NS',
    localAuthority: 'Harrow',
    phone: '07903 068899',
    serviceTypes: ['Homecare agency'],
    regulatedActivities: [
      'Personal care',
      'Treatment of disease, disorder or injury',
    ],
    registeredManagers: ['Miss Veron Minott', SUZETTE_THOMAS],
    nominatedIndividual: SUZETTE_THOMAS,
    cqcRegistrationDate: null,
    cqcRating: null,
    cqcRatingStatus: null,
  },
  {
    ...PROVIDER_DEFAULTS,
    cqcLocationId: '1-22151677367',
    name: 'Allfor Care Doncaster',
    code: 'ALLFOR_DONCASTER',
    visitRefCode: 'DON',
    sortOrder: 40,
    zoneName: 'Doncaster',
    officialCqcName: 'Allfor Care Doncaster',
    addressLine1: '50 Nether Hall Road',
    town: 'Doncaster',
    county: 'South Yorkshire',
    postcode: 'DN1 2PZ',
    localAuthority: 'Doncaster',
    phone: '07903 068899',
    serviceTypes: ['Homecare agency'],
    regulatedActivities: ['Personal care'],
    // Spec gives no registered manager / nominated individual for Doncaster.
    registeredManagers: [],
    nominatedIndividual: null,
    cqcRegistrationDate: '2025-03-25',
    cqcRating: null,
    cqcRatingStatus: 'NOT_YET_RATED',
  },
  {
    ...PROVIDER_DEFAULTS,
    cqcLocationId: '1-9322505965',
    name: 'Allfor Care Croydon',
    code: 'ALLFOR_CROYDON',
    visitRefCode: 'CRO',
    sortOrder: 50,
    zoneName: 'London',
    officialCqcName: 'Allfor Care Croydon',
    addressLine1: '5 Green Lane',
    town: 'Thornton Heath',
    county: 'Greater London',
    postcode: 'CR7 8BG',
    localAuthority: 'Croydon',
    phone: '020 8930 3087',
    serviceTypes: ['Homecare agency'],
    regulatedActivities: ['Personal care'],
    registeredManagers: [SUZETTE_THOMAS],
    nominatedIndividual: SUZETTE_THOMAS,
    cqcRegistrationDate: null,
    cqcRating: 'GOOD',
    cqcRatingStatus: 'RATED',
  },
];

/** lookups.Zone rows the real branches need (London is also in the generic city list). */
export const ALLFOR_CARE_ZONES: Array<{
  name: string;
  country: string;
  city: string;
}> = [
  { name: 'London', country: 'United Kingdom', city: 'London' },
  { name: 'Doncaster', country: 'United Kingdom', city: 'Doncaster' },
];

/** Single-line address kept in ScheduleArea.address (what the admin UI shows today). */
export function formatBranchAddress(
  b: Pick<
    AllforCareBranchSeed,
    'addressLine1' | 'addressLine2' | 'town' | 'county' | 'postcode'
  >,
): string {
  return [b.addressLine1, b.addressLine2, b.town, b.county, b.postcode]
    .filter((part) => part && part.trim())
    .join(', ');
}
