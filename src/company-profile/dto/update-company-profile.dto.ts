import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateCompanyProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  odsCsCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  companyWebsite?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  companyNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vatNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankSortCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankAccountNumber?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  activeModules?: string[];

  // ── Legal & regulatory (Companies House number is `companyNumber`). Empty string clears. ──

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalName?: string;

  @ApiPropertyOptional({ maxLength: 50, example: '1-101656545' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  cqcProviderId?: string;

  @ApiPropertyOptional({ maxLength: 100, example: 'Active' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyStatus?: string;

  @ApiPropertyOptional({ maxLength: 200, example: 'Private Limited Company' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyType?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '2004-06-01',
    description: 'YYYY-MM-DD; null clears',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'incorporationDate must be YYYY-MM-DD' })
  incorporationDate?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['86900'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  sicCodes?: string[];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  registeredAddressLine1?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  registeredAddressLine2?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  registeredTown?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  registeredCounty?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  registeredPostcode?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  registeredCountry?: string;

  @ApiPropertyOptional({ example: 'GB', description: 'ISO 3166-1 alpha-2' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'countryCode must be a 2-letter ISO country code' })
  countryCode?: string;

  @ApiPropertyOptional({ example: 'GBP', description: 'ISO 4217' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter ISO currency code' })
  currency?: string;

  @ApiPropertyOptional({ example: 'en-GB', description: 'BCP 47 language tag' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, { message: 'locale must be a BCP 47 tag, e.g. en-GB' })
  locale?: string;
}
