import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BranchStatus, CqcRating, CqcRatingStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLocationZoneDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: '#EAB308' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  markerColorHex?: string;
}

/**
 * CQC registration, structured address and locale fields of a branch (scheduling.ScheduleArea).
 * All optional. On update: omitted = unchanged; null / '' clears a nullable field.
 */
export class LocationBranchDetailsDto {
  @ApiPropertyOptional({ maxLength: 500, description: 'Single-line address shown in lists' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  town?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  county?: string | null;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postcode?: string | null;

  @ApiPropertyOptional({ maxLength: 120, example: 'England' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string | null;

  @ApiPropertyOptional({ example: 'GB', description: 'ISO 3166-1 alpha-2' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'countryCode must be a 2-letter ISO country code' })
  countryCode?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  localAuthority?: string | null;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 320 })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  @Matches(/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be an email address' })
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string | null;

  @ApiPropertyOptional({
    example: '1-115898258',
    description: 'CQC location id (unique across branches)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^$|^\d-\d{4,15}$/, { message: 'cqcLocationId must look like 1-123456789' })
  cqcLocationId?: string | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  officialCqcName?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['Homecare agency'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  serviceTypes?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Personal care'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  regulatedActivities?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  registeredManagers?: string[];

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  nominatedIndividual?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2015-03-01' })
  @IsOptional()
  @IsString()
  @Matches(/^$|^\d{4}-\d{2}-\d{2}$/, { message: 'cqcRegistrationDate must be YYYY-MM-DD' })
  cqcRegistrationDate?: string | null;

  @ApiPropertyOptional({ enum: CqcRating, nullable: true })
  @IsOptional()
  @IsEnum(CqcRating)
  cqcRating?: CqcRating | null;

  @ApiPropertyOptional({ enum: CqcRatingStatus, nullable: true })
  @IsOptional()
  @IsEnum(CqcRatingStatus)
  cqcRatingStatus?: CqcRatingStatus | null;

  @ApiPropertyOptional({ enum: BranchStatus })
  @IsOptional()
  @IsEnum(BranchStatus)
  status?: BranchStatus;

  @ApiPropertyOptional({ example: 'Europe/London' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

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

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'From the Google-resolved address (never guessed)',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'From the Google-resolved address (never guessed)',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}

export class CreateLocationBranchDto extends LocationBranchDetailsDto {
  @ApiProperty({ description: 'Zone lookup id' })
  @IsUUID()
  zoneId!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    maxLength: 80,
    description: 'Schedule area code; auto-generated when omitted',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @ApiPropertyOptional({
    minLength: 3,
    maxLength: 3,
    description: '3-character visit reference branch code',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  @Matches(/^[A-Za-z0-9]{3}$/)
  visitRefCode?: string;
}

/**
 * PATCH /location-management/branches/:id. `code`, `visitRefCode` and `zoneId` are deliberately
 * not editable here: visit references (VIS-[BRANCH]-…) and schedule codes are already issued.
 */
export class UpdateLocationBranchDto extends LocationBranchDetailsDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Display name (ScheduleArea.name)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
