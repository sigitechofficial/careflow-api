import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ServiceUserLoginDto {
  @ApiProperty({ example: 'resident@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}

export class UpsertServiceUserPortalAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class SetServiceUserPortalPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class PatchPortalProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  middleName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preferredName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  genderId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maritalStatusId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateOfBirth?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  town?: string;

  @ApiPropertyOptional()
  @IsOptional()
  county?: string;

  @ApiPropertyOptional()
  @IsOptional()
  postcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  accessInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  keySafeNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  suffix?: string;

  @ApiPropertyOptional()
  @IsOptional()
  maidenName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  placeOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  religion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  ethnicity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  sexualOrientation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  disability?: string;

  @ApiPropertyOptional()
  @IsOptional()
  maternity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  preferredContactMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  emailType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  otherContactMethod?: string;
}

export class PatchPortalAboutMeDto {
  @ApiProperty({ description: 'About Me JSON blob (SU_ABOUT_ME_V1 shape)' })
  @IsObject()
  aboutMe!: Record<string, unknown>;
}

export class CreatePortalContactDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  relationshipTypeId?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isEmergencyContact?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  canReceiveUpdates?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreatePortalAllergyDto {
  @ApiPropertyOptional({ description: 'Pick from allergy catalog when using the dropdown.' })
  @IsOptional()
  @IsUUID()
  allergyCatalogId?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Free-text allergy name when not using catalog.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  allergyName?: string;

  @ApiProperty({ maxLength: 20_000 })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  comment!: string;
}
