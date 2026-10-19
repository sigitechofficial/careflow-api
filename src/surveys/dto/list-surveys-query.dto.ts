import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
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

  // Kept as a string ('true' | 'false') so the global ValidationPipe's implicit
  // boolean conversion can't turn 'false' into true; the service interprets it.
  @ApiPropertyOptional({ description: "Filter to templates ('true') or non-template surveys ('false')." })
  @IsOptional()
  @IsIn(['true', 'false'])
  isTemplate?: string;
}
