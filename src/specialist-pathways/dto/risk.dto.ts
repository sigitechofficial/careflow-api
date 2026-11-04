import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SpecialistPathwayRiskStatus } from '@prisma/client';

export class CreatePathwayRiskDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'e.g. Falls, Choking, Wandering' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  likelihood!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  impact!: number;

  @ApiPropertyOptional({ description: 'What is in place to reduce the risk.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  controls?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsString()
  reviewDate?: string;
}

export class UpdatePathwayRiskDto extends PartialType(CreatePathwayRiskDto) {
  @ApiPropertyOptional({ enum: SpecialistPathwayRiskStatus })
  @IsOptional()
  @IsEnum(SpecialistPathwayRiskStatus)
  status?: SpecialistPathwayRiskStatus;
}
