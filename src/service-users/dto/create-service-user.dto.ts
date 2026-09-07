import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsOnOrAfterDate } from '../../common/validators/date-order.validator';
import { ServiceUserReferenceItemDto } from './service-user-reference-item.dto';

/** Empty / whitespace optional dates → undefined so @IsOptional skips @IsDateString. */
function emptyDateToUndefined({ value }: { value: unknown }): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateServiceUserDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  preferredName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyDateToUndefined)
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

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

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nhsNumber?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  socialServicesRef?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nationalInsuranceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyDateToUndefined)
  @IsDateString()
  serviceStartDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyDateToUndefined)
  @IsDateString()
  @IsOnOrAfterDate('serviceStartDate')
  serviceEndDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  titleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  genderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  maritalStatusId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  careTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fundingTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  riskLevelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Service user area under a branch (also sets locationId)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  serviceUserAreaId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  keyWorkerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  namedNurseId?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  defaultChargeCardId?: string | null;

  @ApiPropertyOptional({ type: [ServiceUserReferenceItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceUserReferenceItemDto)
  references?: ServiceUserReferenceItemDto[];

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  serviceUserNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  residentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  residentGuid?: string;
}
