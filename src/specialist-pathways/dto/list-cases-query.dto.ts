import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  SpecialistPathwayStatus,
  SpecialistPathwayType,
} from '@prisma/client';

export class ListSpecialistPathwayCasesQueryDto {
  @ApiPropertyOptional({ enum: SpecialistPathwayType })
  @IsOptional()
  @IsEnum(SpecialistPathwayType)
  type?: SpecialistPathwayType;

  @ApiPropertyOptional({ enum: SpecialistPathwayStatus })
  @IsOptional()
  @IsEnum(SpecialistPathwayStatus)
  status?: SpecialistPathwayStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Header branch filter (service user location).' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
