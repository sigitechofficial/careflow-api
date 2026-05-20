import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsIn,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DomJobCancellationRuleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiProperty({ minimum: 0, maximum: 9999 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  hoursFrom!: number;

  @ApiProperty({ minimum: 0, maximum: 9999 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  hoursTo!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  chargeServiceUserPercent!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  payEmployeePercent!: number;
}

const ALLOCATION_BEHAVIORS = ['DONT_ALLOW', 'ALWAYS_ALLOW', 'REQUEST_CONFIRMATION'] as const;

export class DomCareAllocationRuleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  key!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: ALLOCATION_BEHAVIORS })
  @IsIn(ALLOCATION_BEHAVIORS)
  behavior!: (typeof ALLOCATION_BEHAVIORS)[number];

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  minutes?: number | null;
}

export class DomCareShiftDefinitionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '06:00' })
  @IsString()
  @MaxLength(5)
  fromTime!: string;

  @ApiProperty({ example: '10:59' })
  @IsString()
  @MaxLength(5)
  toTime!: string;

  @ApiProperty({ example: '#F4D03F' })
  @IsString()
  @MaxLength(7)
  colorHex!: string;

  @ApiProperty()
  @IsBoolean()
  endsNextDay!: boolean;

  @ApiProperty({ minimum: 0, maximum: 999 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder!: number;
}

export class DomLateVisitZoneAlertDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  zoneKey!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string | null;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  emailEmployeeIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationEmployeeIds!: string[];
}
