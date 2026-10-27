import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  OnCallCallCategory,
  OnCallCallerType,
  OnCallCallStatus,
  OnCallTier,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** Empty strings from optional form fields become undefined. */
const trimOrUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};

export class CreateOnCallShiftDto {
  @ApiProperty() @IsUUID() employeeId!: string;

  @ApiPropertyOptional({ description: 'Branch; omit to cover every branch' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsUUID()
  locationId?: string;

  @ApiProperty({ enum: OnCallTier }) @IsEnum(OnCallTier) tier!: OnCallTier;

  @ApiProperty({ description: 'ISO instant' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ description: 'ISO instant, after startsAt' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateOnCallShiftDto extends PartialType(CreateOnCallShiftDto) {}

export class ListOnCallShiftsQueryDto {
  @ApiProperty({ description: 'ISO instant — shifts ending after this' })
  @IsDateString()
  from!: string;
  @ApiProperty({ description: 'ISO instant — shifts starting before this' })
  @IsDateString()
  to!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsUUID()
  locationId?: string;
}

export class CreateOnCallCallDto {
  @ApiProperty({ description: 'When the call came in (ISO instant)' })
  @IsDateString()
  receivedAt!: string;

  @ApiProperty({ enum: OnCallCallerType })
  @IsEnum(OnCallCallerType)
  callerType!: OnCallCallerType;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  callerName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(40)
  callerPhone?: string;

  @ApiPropertyOptional({
    description: 'The carer who called, when the caller is a carer',
  })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsUUID()
  callerEmployeeId?: string;

  @ApiPropertyOptional({ description: 'The service user the call is about' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsUUID()
  locationId?: string;

  @ApiProperty({ enum: OnCallCallCategory })
  @IsEnum(OnCallCallCategory)
  category!: OnCallCallCategory;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  summary!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(2000)
  actionTaken?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() followUpRequired?: boolean;
}

export class UpdateOnCallCallDto extends PartialType(CreateOnCallCallDto) {}

export class CloseOnCallCallDto {
  @ApiProperty({ description: 'What was done to close it' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  closingNote!: string;
}

export class ListOnCallCallsQueryDto {
  @ApiPropertyOptional({ enum: OnCallCallStatus })
  @IsOptional()
  @IsEnum(OnCallCallStatus)
  status?: OnCallCallStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsUUID()
  serviceUserId?: string;
}
