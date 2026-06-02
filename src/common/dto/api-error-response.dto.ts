import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Standard error body from `HttpExceptionFilter` (400, 404, etc.). */
export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['month must be YYYY-MM'],
    description: 'Validation messages or structured error details',
  })
  errors?: string[] | unknown[];
}

export class ApiDeleteResultDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: true })
  deleted!: boolean;
}

/** Flat delete body returned by many medication endpoints (`{ id, deleted: true }`). */
export class ApiSimpleDeleteResultDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: true })
  deleted!: boolean;
}

export class ApiDeleteResponseDto {
  @ApiProperty({ type: ApiDeleteResultDto })
  data!: ApiDeleteResultDto;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 142 })
  total!: number;

  @ApiProperty({ example: 8 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPrevPage!: boolean;
}
