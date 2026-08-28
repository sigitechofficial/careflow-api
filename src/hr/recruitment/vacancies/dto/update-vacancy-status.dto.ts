import { ApiProperty } from '@nestjs/swagger';
import { VacancyStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateVacancyStatusDto {
  @ApiProperty({ enum: VacancyStatus })
  @IsEnum(VacancyStatus)
  status!: VacancyStatus;
}
