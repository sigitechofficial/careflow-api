import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class SyncScheduleRunCarerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unallocateEmployeeId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'On single-carer visits, take off whoever is allocated so the run carer can take the visit.',
  })
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}
