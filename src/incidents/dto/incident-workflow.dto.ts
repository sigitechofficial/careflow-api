import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentSeverity, IncidentStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ChangeIncidentStatusDto {
  @ApiProperty({ enum: IncidentStatus })
  @IsEnum(IncidentStatus)
  status!: IncidentStatus;

  @ApiPropertyOptional({
    description: 'Reason / note for the transition (audited)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Override the "mandatory actions incomplete" block when closing a High/Critical incident (requires incidents.close and an audited reason)',
  })
  @IsOptional()
  @IsBoolean()
  overrideMandatoryActions?: boolean;
}

export class ChangeIncidentSeverityDto {
  @ApiProperty({ enum: IncidentSeverity })
  @IsEnum(IncidentSeverity)
  severity!: IncidentSeverity;

  @ApiPropertyOptional({
    description: 'Reason for the severity change (audited)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class AssignIncidentOwnerDto {
  @ApiProperty({ description: 'User id of the incident owner' })
  @IsUUID()
  ownerId!: string;
}
