import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** What putting a carer on a run's visits would do (nothing is saved). */
export class PreviewRunCarerDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  /** The run's visits, in run order. */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  visitIds!: string[];

  @ApiPropertyOptional({
    default: false,
    description: 'On single-carer visits, the run carer takes the place of whoever is on it.',
  })
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;

  /** Changing a run's carer: the previous one, taken off the visits first. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  releaseEmployeeId?: string;
}
