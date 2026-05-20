import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { INCIDENT_DEFAULT_STATUSES } from '../incident-management.util';

export class IncidentTypeSettingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  key!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty()
  @IsBoolean()
  required!: boolean;
}

export class IncidentManagementFieldsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 10080 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  incidentDetailsEditableMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 8760 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  incidentDisplayHours?: number;

  @ApiPropertyOptional({ enum: INCIDENT_DEFAULT_STATUSES })
  @IsOptional()
  @IsIn([...INCIDENT_DEFAULT_STATUSES])
  incidentDefaultStatus?: (typeof INCIDENT_DEFAULT_STATUSES)[number];

  @ApiPropertyOptional({ type: [IncidentTypeSettingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncidentTypeSettingDto)
  incidentTypeSettings?: IncidentTypeSettingDto[];
}
