/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- in-memory Prisma mocks */
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompanyProfileService } from './company-profile.service';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

type Row = Record<string, any>;

function setup() {
  const row: Row = {
    id: '00000000-0000-4000-8000-000000000001',
    groupName: null,
    companyName: 'Allfor Care Services Limited',
    odsCsCode: 'X',
    displayName: 'Allfor Care Services Limited',
    displayLogoUrl: null,
    displayLogoFileName: null,
    companyLogoUrl: null,
    companyLogoFileName: null,
    companyWebsite: null,
    contactName: 'Contact',
    email: 'admin@example.test',
    phoneNumber: '1',
    companyNumber: '05142064',
    vatNumber: null,
    bankName: null,
    bankSortCode: null,
    bankAccountNumber: null,
    activeModules: [],
    legalName: 'ALLFOR CARE SERVICES LIMITED',
    cqcProviderId: '1-101656545',
    companyStatus: 'Active',
    companyType: 'Private Limited Company',
    incorporationDate: new Date('2004-06-01T00:00:00.000Z'),
    sicCodes: ['86900'],
    registeredAddressLine1: '15 Maswell Park Road',
    registeredAddressLine2: null,
    registeredTown: 'Hounslow',
    registeredCounty: null,
    registeredPostcode: 'TW3 2DL',
    registeredCountry: 'England',
    countryCode: 'GB',
    currency: 'GBP',
    locale: 'en-GB',
    updatedAt: new Date('2026-09-29T10:00:00.000Z'),
  };
  const prisma = {
    companyProfile: {
      findUnique: jest.fn(async () => row),
      update: jest.fn(async ({ data }: Row) => {
        for (const [k, v] of Object.entries(data))
          if (v !== undefined) row[k] = v;
        return row;
      }),
    },
    employee: { count: jest.fn(async () => 3) },
    serviceUser: { count: jest.fn(async () => 4) },
  };
  return { service: new CompanyProfileService(prisma as any), prisma, row };
}

describe('CompanyProfileService legal & regulatory fields', () => {
  it('GET exposes the organisation legal / CQC fields', async () => {
    const { service } = setup();
    const { data } = await service.get();
    expect(data).toMatchObject({
      legalName: 'ALLFOR CARE SERVICES LIMITED',
      companyNumber: '05142064',
      cqcProviderId: '1-101656545',
      companyStatus: 'Active',
      companyType: 'Private Limited Company',
      incorporationDate: '2004-06-01',
      sicCodes: ['86900'],
      registeredAddressLine1: '15 Maswell Park Road',
      registeredTown: 'Hounslow',
      registeredPostcode: 'TW3 2DL',
      registeredCountry: 'England',
      countryCode: 'GB',
      currency: 'GBP',
      locale: 'en-GB',
    });
  });

  it('PATCH updates, clears and normalises the new fields', async () => {
    const { service, prisma } = setup();
    const res = await service.update('user-1', {
      legalName: '  ',
      sicCodes: ['86900', ' 87100 ', '86900'],
      incorporationDate: '2004-06-02',
      registeredPostcode: 'tw3 2dl',
      countryCode: 'gb',
      currency: 'gbp',
    });
    const data = prisma.companyProfile.update.mock.calls[0][0].data;
    expect(data.legalName).toBeNull();
    expect(data.cqcProviderId).toBeUndefined();
    expect(data.sicCodes).toEqual(['86900', '87100']);
    expect(data.registeredPostcode).toBe('TW3 2DL');
    expect(data.countryCode).toBe('GB');
    expect(data.currency).toBe('GBP');
    expect(res.data.incorporationDate).toBe('2004-06-02');
  });

  it('PATCH with null incorporationDate clears it; an impossible date is a 400', async () => {
    const { service, prisma } = setup();
    await service.update('user-1', { incorporationDate: null });
    expect(
      prisma.companyProfile.update.mock.calls[0][0].data.incorporationDate,
    ).toBeNull();
    await expect(
      service.update('user-1', { incorporationDate: '2004-02-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UpdateCompanyProfileDto validation', () => {
  const errorsFor = async (body: Record<string, unknown>) =>
    (
      await validate(plainToInstance(UpdateCompanyProfileDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('accepts the real organisation payload', async () => {
    expect(
      await errorsFor({
        legalName: 'ALLFOR CARE SERVICES LIMITED',
        cqcProviderId: '1-101656545',
        incorporationDate: '2004-06-01',
        sicCodes: ['86900'],
        countryCode: 'GB',
        currency: 'GBP',
        locale: 'en-GB',
      }),
    ).toEqual([]);
  });

  it('rejects malformed dates, codes and arrays', async () => {
    expect(
      (
        await errorsFor({
          incorporationDate: '01/06/2004',
          sicCodes: '86900',
          countryCode: 'GBR',
          currency: 'POUND',
          locale: 'english',
        })
      ).sort(),
    ).toEqual([
      'countryCode',
      'currency',
      'incorporationDate',
      'locale',
      'sicCodes',
    ]);
  });
});
