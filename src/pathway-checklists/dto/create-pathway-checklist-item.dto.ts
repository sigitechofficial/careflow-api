import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePathwayChecklistItemBodyDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  itemText!: string;

  @ApiPropertyOptional()
  @IsOptional()
  sortOrder?: number;
}
