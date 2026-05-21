import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FlashMessageStatusEnum } from '../enums/flash-message-status.enum';

export class FlashMessageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FlashMessageStatusEnum })
  @IsOptional()
  @IsEnum(FlashMessageStatusEnum)
  status?: FlashMessageStatusEnum;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'displayUntil', 'status', 'updatedAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'displayUntil', 'status', 'updatedAt'])
  sortBy?: 'createdAt' | 'displayUntil' | 'status' | 'updatedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
