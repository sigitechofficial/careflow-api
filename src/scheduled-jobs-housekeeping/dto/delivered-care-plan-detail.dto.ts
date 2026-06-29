import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DELIVERED_TASK_STATUSES } from '../visit-care-plan-delivery.util';

export class DeliveredCarePlanTaskDto {
  @ApiProperty()
  @IsString()
  fieldKey!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  label!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  fieldType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  expectedValue?: string | boolean | null;

  @ApiProperty({ enum: DELIVERED_TASK_STATUSES })
  @IsIn([...DELIVERED_TASK_STATUSES])
  status!: (typeof DELIVERED_TASK_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class DeliveredCarePlanDetailDto {
  @ApiProperty()
  @IsUUID('4')
  carePathwayFormId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  carePlanInstanceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  publishedVersionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  publishedVersionNumber?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  formName!: string;

  @ApiProperty()
  @IsBoolean()
  planDelivered!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  planNotes?: string;

  @ApiPropertyOptional({ description: 'Care provided beyond what the plan specifies' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  extraCareNotes?: string;

  @ApiProperty({ type: [DeliveredCarePlanTaskDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveredCarePlanTaskDto)
  tasks!: DeliveredCarePlanTaskDto[];
}
