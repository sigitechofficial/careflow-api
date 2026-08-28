import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { UpdateVacancyStatusDto } from './dto/update-vacancy-status.dto';
import { VacancyQueryDto } from './dto/vacancy-query.dto';
import { VacanciesService } from './vacancies.service';

@ApiTags('HR Vacancies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/vacancies')
export class VacanciesController {
  constructor(private readonly service: VacanciesService) {}

  @Post()
  @Permissions('hr.vacancies.create')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateVacancyDto) {
    return this.service.create(user, dto);
  }

  @Get()
  @Permissions('hr.vacancies.read')
  list(@CurrentUser() user: RequestUser, @Query() query: VacancyQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Permissions('hr.vacancies.read')
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(user, id);
  }

  @Patch(':id')
  @Permissions('hr.vacancies.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateVacancyDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Patch(':id/status')
  @Permissions('hr.vacancies.update')
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateVacancyStatusDto,
  ) {
    return this.service.updateStatus(user, id, dto);
  }
}
