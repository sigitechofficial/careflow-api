import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SurveyStatus, SurveyTargetKind } from '@prisma/client';

export class ListSurveysQueryDto {
  @ApiPropertyOptional({ enum: SurveyStatus })
  @IsOptional()
  @IsEnum(SurveyStatus)
  status?: SurveyStatus;

  @ApiPropertyOptional({ enum: SurveyTargetKind })
  @IsOptional()
  @IsEnum(SurveyTargetKind)
  targetKind?: SurveyTargetKind;
}
