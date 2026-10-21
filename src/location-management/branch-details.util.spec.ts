import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  branchDetailsResponse,
  branchDetailsWriteData,
  renamedBranchLocationName,
  resolveCqcRatingFields,
} from './branch-details.util';
import {
  CreateLocationBranchDto,
  UpdateLocationBranchDto,
} from './dto/create-location-zone-branch.dto';

async function errorsFor<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(cls, body) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('UpdateLocationBranchDto validation', () => {
  it('accepts a full CQC payload', async () => {
    expect(
      await errorsFor(UpdateLocationBranchDto, {
        name: 'Allfor Care Hounslow',
        cqcLocationId: '1-115898258',
        officialCqcName: 'Allfor Care Hounslow',
        addressLine1: '15 Maswell Park Road',
        town: 'Hounslow',
        postcode: 'TW3 2DL',
        localAuthority: 'Hounslow',
        email: 'office@example.test',
        serviceTypes: ['Homecare agency'],
        regulatedActivities: ['Personal care'],
        registeredManagers: ['A Manager', 'B Manager'],
        cqcRegistrationDate: '2015-03-01',
        cqcRating: 'GOOD',
        cqcRatingStatus: 'RATED',
        status: 'ACTIVE',
        countryCode: 'GB',
        currency: 'GBP',
        locale: 'en-GB',
        latitude: 51.4676,
        longitude: -0.3613,
      }),
    ).toEqual([]);
  });

  it('allows null / empty to clear nullable fields', async () => {
    expect(
      await errorsFor(UpdateLocationBranchDto, {
        cqcLocationId: '',
        email: '',
        cqcRegistrationDate: null,
        cqcRating: null,
        cqcRatingStatus: null,
        latitude: null,
      }),
    ).toEqual([]);
  });

  it('rejects bad enums, dates, arrays and ids', async () => {
    const props = await errorsFor(UpdateLocationBranchDto, {
      cqcRating: 'EXCELLENT',
      cqcRatingStatus: 'MAYBE',
      status: 'OPEN',
      cqcRegistrationDate: '01/03/2015',
      registeredManagers: 'Jane Doe',
      serviceTypes: [1, 2],
      cqcLocationId: 'ABC',
      email: 'not-an-email',
      latitude: 123,
    });
    expect(props.sort()).toEqual(
      [
        'cqcLocationId',
        'cqcRating',
        'cqcRatingStatus',
        'cqcRegistrationDate',
        'email',
        'latitude',
        'registeredManagers',
        'serviceTypes',
        'status',
      ].sort(),
    );
  });

  it('keeps visitRefCode / code / zoneId read-only on update', async () => {
    expect(
      (
        await errorsFor(UpdateLocationBranchDto, {
          visitRefCode: 'ABC',
          code: 'X',
          zoneId: 'z',
        })
      ).sort(),
    ).toEqual(['code', 'visitRefCode', 'zoneId']);
  });

  it('create accepts the Google-resolved structured address + coordinates', async () => {
    expect(
      await errorsFor(CreateLocationBranchDto, {
        zoneId: '7d7b3a3e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
        name: 'Branch',
        address: '15 Maswell Park Rd, Hounslow TW3 2DL, UK',
        addressLine1: '15 Maswell Park Rd',
        town: 'Hounslow',
        county: 'Greater London',
        postcode: 'TW3 2DL',
        country: 'United Kingdom',
        latitude: 51.46,
        longitude: -0.36,
        cqcLocationId: '1-115898258',
      }),
    ).toEqual([]);
  });
});

describe('resolveCqcRatingFields', () => {
  it('a rating implies RATED', () => {
    expect(resolveCqcRatingFields({ cqcRating: 'GOOD' })).toEqual({
      cqcRating: 'GOOD',
      cqcRatingStatus: 'RATED',
    });
  });

  it('NOT_YET_RATED clears the rating', () => {
    expect(
      resolveCqcRatingFields({ cqcRatingStatus: 'NOT_YET_RATED' }),
    ).toEqual({
      cqcRating: null,
      cqcRatingStatus: 'NOT_YET_RATED',
    });
  });

  it('rejects a rating with NOT_YET_RATED', () => {
    expect(() =>
      resolveCqcRatingFields({
        cqcRating: 'GOOD',
        cqcRatingStatus: 'NOT_YET_RATED',
      }),
    ).toThrow(BadRequestException);
  });

  it('leaves both untouched when omitted and clears both when null', () => {
    expect(resolveCqcRatingFields({})).toEqual({});
    expect(
      resolveCqcRatingFields({ cqcRating: null, cqcRatingStatus: null }),
    ).toEqual({
      cqcRating: null,
      cqcRatingStatus: null,
    });
  });
});

describe('branchDetailsWriteData', () => {
  it('only writes provided keys; blanks clear nullable text; lists are cleaned', () => {
    const data = branchDetailsWriteData({
      postcode: ' tw3 2dl ',
      email: '',
      registeredManagers: [' Jane Doe ', '', 'Jane Doe', 'John Roe'],
      cqcRegistrationDate: '2015-03-01',
      countryCode: 'gb',
      currency: ' ',
    });
    expect(data.postcode).toBe('TW3 2DL');
    expect(data.email).toBeNull();
    expect(data.registeredManagers).toEqual(['Jane Doe', 'John Roe']);
    expect(data.cqcRegistrationDate).toEqual(
      new Date('2015-03-01T00:00:00.000Z'),
    );
    expect(data.countryCode).toBe('GB');
    expect(data.currency).toBeUndefined();
    expect(data.town).toBeUndefined();
    expect(data.serviceTypes).toBeUndefined();
    expect(data.status).toBeUndefined();
    expect(data.latitude).toBeUndefined();
  });

  it('rejects an impossible date and an unsupported timezone', () => {
    expect(() =>
      branchDetailsWriteData({ cqcRegistrationDate: '2015-02-30' }),
    ).toThrow(BadRequestException);
    expect(() => branchDetailsWriteData({ timezone: 'Mars/Olympus' })).toThrow(
      BadRequestException,
    );
    expect(branchDetailsWriteData({ timezone: 'Europe/London' }).timezone).toBe(
      'Europe/London',
    );
  });
});

describe('branchDetailsResponse', () => {
  it('serialises dates and decimals', () => {
    const out = branchDetailsResponse({
      cqcLocationId: '1-1',
      officialCqcName: null,
      addressLine1: null,
      addressLine2: null,
      town: null,
      county: null,
      postcode: null,
      country: null,
      countryCode: 'GB',
      localAuthority: null,
      phone: null,
      email: null,
      website: null,
      serviceTypes: [],
      regulatedActivities: [],
      registeredManagers: ['A'],
      nominatedIndividual: null,
      cqcRegistrationDate: new Date('2015-03-01T00:00:00.000Z'),
      cqcRating: null,
      cqcRatingStatus: 'NOT_YET_RATED',
      status: 'ACTIVE',
      timezone: 'Europe/London',
      currency: 'GBP',
      locale: 'en-GB',
      latitude: new Prisma.Decimal('51.4676000'),
      longitude: null,
    });
    expect(out.cqcRegistrationDate).toBe('2015-03-01');
    expect(out.latitude).toBe(51.4676);
    expect(out.longitude).toBeNull();
    expect(out.registeredManagers).toEqual(['A']);
  });
});

describe('renamedBranchLocationName', () => {
  it('follows the "branch name" convention (seeded real branches)', () => {
    expect(
      renamedBranchLocationName({
        locationName: 'Allfor Care Hounslow',
        oldBranchName: 'Allfor Care Hounslow',
        newBranchName: 'Allfor Care Hounslow HQ',
        zoneName: 'London',
      }),
    ).toBe('Allfor Care Hounslow HQ');
  });

  it('follows the "Zone - Branch" convention (admin-created branches)', () => {
    expect(
      renamedBranchLocationName({
        locationName: 'London - Croydon 1',
        oldBranchName: 'Croydon 1',
        newBranchName: 'Croydon North',
        zoneName: 'London',
      }),
    ).toBe('London - Croydon North');
  });

  it('leaves custom location names and unchanged names alone', () => {
    expect(
      renamedBranchLocationName({
        locationName: 'Head office',
        oldBranchName: 'Croydon 1',
        newBranchName: 'Croydon North',
        zoneName: 'London',
      }),
    ).toBeNull();
    expect(
      renamedBranchLocationName({
        locationName: 'Croydon 1',
        oldBranchName: 'Croydon 1',
        newBranchName: 'Croydon 1',
        zoneName: 'London',
      }),
    ).toBeNull();
  });
});
