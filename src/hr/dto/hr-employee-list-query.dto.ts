import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EmployeeLifecycleStatus, HrDeploymentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class HrEmployeeListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by name, employee number, or job title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: EmployeeLifecycleStatus })
  @IsOptional()
  @IsEnum(EmployeeLifecycleStatus)
  employeeLifecycleStatus?: EmployeeLifecycleStatus;

  @ApiPropertyOptional({ enum: HrDeploymentStatus })
  @IsOptional()
  @IsEnum(HrDeploymentStatus)
  deploymentStatus?: HrDeploymentStatus;
}
