import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';
import { TransformUuidArrayQuery } from '../../common/transformers/uuid-array-query.transform';

export class EmployeeDocumentsRegistryQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Branch / location ids — documents for employees on those branches (primary, floor, or access-all-zones)',
  })
  @IsOptional()
  @TransformUuidArrayQuery()
  @IsArray()
  @IsUUID('4', { each: true })
  locationIds?: string[];
}
