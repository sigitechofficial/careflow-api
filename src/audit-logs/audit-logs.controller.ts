import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { LoginHistoryQueryDto } from './dto/login-history-query.dto';
import { SecurityEventQueryDto } from './dto/security-event-query.dto';
import { DataAccessLogQueryDto } from './dto/data-access-log-query.dto';
import { ExportLogQueryDto } from './dto/export-log-query.dto';
import { AUDIT_EVENT_TYPE_VALUES } from './enums/audit-event-type.enum';
import { auditEventTypeLabel } from './audit-event-type.util';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Permissions('audit_logs.read')
  @ApiOperation({ summary: 'List immutable audit log entries' })
  async list(@Query() query: AuditLogQueryDto) {
    return this.auditLogsService.findAuditLogs(query);
  }

  @Get('login-history')
  @ApiTags('Login History')
  @Permissions('audit_logs.read')
  @ApiOperation({ summary: 'List login history records' })
  async loginHistory(@Query() query: LoginHistoryQueryDto) {
    return this.auditLogsService.findLoginHistory(query);
  }

  @Get('security-events')
  @ApiTags('Security Events')
  @Permissions('audit_logs.read')
  @ApiOperation({ summary: 'List security events' })
  async securityEvents(@Query() query: SecurityEventQueryDto) {
    return this.auditLogsService.findSecurityEvents(query);
  }

  @Get('data-access')
  @ApiTags('Data Access Logs')
  @Permissions('audit_logs.read')
  @ApiOperation({ summary: 'List data access logs' })
  async dataAccess(@Query() query: DataAccessLogQueryDto) {
    return this.auditLogsService.findDataAccessLogs(query);
  }

  @Get('exports')
  @ApiTags('Export Logs')
  @Permissions('audit_logs.read')
  @ApiOperation({ summary: 'List export logs' })
  async exports(@Query() query: ExportLogQueryDto) {
    return this.auditLogsService.findExportLogs(query);
  }

  @Get('event-types')
  @Permissions('audit_logs.read')
  @ApiOperation({ summary: 'List filterable audit event type categories' })
  listEventTypes() {
    return {
      data: AUDIT_EVENT_TYPE_VALUES.map((value) => ({
        value,
        label: auditEventTypeLabel(value),
      })),
    };
  }

  @Get(':id')
  @Permissions('audit_logs.read')
  @ApiOperation({ summary: 'Get a single audit log by id' })
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.auditLogsService.findAuditLogById(id);
  }
}
