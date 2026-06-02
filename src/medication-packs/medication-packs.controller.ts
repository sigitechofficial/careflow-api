import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../common/decorators/api-envelope-ok-response.decorator';
import {
  MEDICATION_PACK_MEMBERS_LIST_ENVELOPE_EXAMPLE,
  MEDICATION_PACK_PUBLISH_ENVELOPE_EXAMPLE,
} from '../common/swagger/medication-api.examples';
import { MedicationPacksService } from './medication-packs.service';
import { CreateMedicationPackDto } from './dto/create-medication-pack.dto';
import { UpdateMedicationPackDto } from './dto/update-medication-pack.dto';
import { CreateMedicationPackItemDto } from './dto/create-medication-pack-item.dto';
import { UpdateMedicationPackItemDto } from './dto/update-medication-pack-item.dto';
import { LinkMedicationPackMemberDto } from './dto/link-medication-pack-member.dto';
import { EndMedicationPackMemberDto } from './dto/end-medication-pack-member.dto';
import { PublishMedicationPackDto } from './dto/publish-medication-pack.dto';
import { SupersedeMedicationPackDto } from './dto/supersede-medication-pack.dto';
import { EndMedicationPackDto } from './dto/end-medication-pack.dto';
import { CreateMedicationPackCompartmentDto } from './dto/create-medication-pack-compartment.dto';
import { UpdateMedicationPackCompartmentDto } from './dto/update-medication-pack-compartment.dto';
import { ApiSimpleDeleteResultDto } from '../common/dto/api-error-response.dto';
import { MedicationPackDto, MedicationPackItemDto } from './dto/medication-pack-response.dto';
import { MedicationPackManifestDto } from './dto/medication-pack-manifest-response.dto';
import { MedicationPackCompartmentDto } from './dto/medication-pack-compartment-response.dto';
import { MedicationPackMemberDto } from './dto/medication-pack-member-response.dto';
import { MedicationPackContentsSnapshotDto } from './dto/medication-pack-contents-snapshot-response.dto';

@ApiTags('Medication Packs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-packs')
export class MedicationPacksController {
  constructor(private readonly service: MedicationPacksService) {}

  @Get()
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List medication packs' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiOkResponse({ type: [MedicationPackDto] })
  @ApiMedicationStandardResponses()
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Get(':packId')
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Get medication pack' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiOkResponse({ type: MedicationPackDto })
  @ApiMedicationStandardResponses()
  getOne(@Param('id') serviceUserId: string, @Param('packId') packId: string) {
    return this.service.getOne(serviceUserId, packId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.create', 'service_users.update')
  @ApiOperation({ summary: 'Create medication pack' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiCreatedResponse({ type: MedicationPackDto })
  @ApiMedicationStandardResponses()
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateMedicationPackDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':packId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Update medication pack' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiOkResponse({ type: MedicationPackDto })
  @ApiMedicationStandardResponses()
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: UpdateMedicationPackDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Delete(':packId')
  @AnyPermission('service_users.medications.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Delete medication pack' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiOkResponse({ type: ApiSimpleDeleteResultDto })
  @ApiMedicationStandardResponses()
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, packId, getRequestAuditMeta(req));
  }

  @Post(':packId/items')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Add item to medication pack' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiCreatedResponse({ type: MedicationPackItemDto })
  @ApiMedicationStandardResponses()
  addItem(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: CreateMedicationPackItemDto,
    @Req() req: Request,
  ) {
    return this.service.addItem(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Patch(':packId/items/:itemId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Update pack item' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiParam({ name: 'itemId', description: 'Pack item UUID' })
  @ApiOkResponse({ type: MedicationPackItemDto })
  @ApiMedicationStandardResponses()
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateMedicationPackItemDto,
    @Req() req: Request,
  ) {
    return this.service.updateItem(user.id, serviceUserId, packId, itemId, dto, getRequestAuditMeta(req));
  }

  @Delete(':packId/items/:itemId')
  @AnyPermission('service_users.medications.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Remove pack item' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiParam({ name: 'itemId', description: 'Pack item UUID' })
  @ApiOkResponse({ type: ApiSimpleDeleteResultDto })
  @ApiMedicationStandardResponses()
  removeItem(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    return this.service.removeItem(user.id, serviceUserId, packId, itemId, getRequestAuditMeta(req));
  }

  // ---- Track E: canonical membership ------------------------------------

  @Get(':packId/members')
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List pack members (linked medications)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiEnvelopeOkResponse({
    description: 'Pack members list',
    example: MEDICATION_PACK_MEMBERS_LIST_ENVELOPE_EXAMPLE,
    innerType: MedicationPackMemberDto,
  })
  @ApiMedicationStandardResponses()
  listMembers(@Param('id') serviceUserId: string, @Param('packId') packId: string) {
    return this.service.listMembers(serviceUserId, packId);
  }

  @Post(':packId/members')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission(
    'service_users.medications.create',
    'service_users.medications.update',
    'service_users.update',
  )
  @ApiOperation({
    summary: 'Link a medication into the pack',
    description:
      'Rejects PRN and controlled drugs (400). Returns 409 if the medication is already an active member of this or another pack.',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiCreatedResponse({ type: MedicationPackMemberDto })
  @ApiConflictResponse({ description: 'Medication already linked to this or another active pack' })
  @ApiMedicationStandardResponses()
  addMember(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: LinkMedicationPackMemberDto,
    @Req() req: Request,
  ) {
    return this.service.addMember(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Delete(':packId/members/:memberId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'End a pack member (remove medication mid-cycle)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiParam({ name: 'memberId', description: 'Pack member UUID' })
  @ApiBody({ type: EndMedicationPackMemberDto })
  @ApiOkResponse({ type: MedicationPackMemberDto })
  @ApiConflictResponse({ description: 'Pack member is already ended' })
  @ApiMedicationStandardResponses()
  endMember(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('memberId') memberId: string,
    @Body() dto: EndMedicationPackMemberDto,
    @Req() req: Request,
  ) {
    return this.service.endMember(user.id, serviceUserId, packId, memberId, dto, getRequestAuditMeta(req));
  }

  // ---- Track E: publish / manifest / lifecycle --------------------------

  @Get(':packId/manifest')
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Get pack manifest (published snapshot or live contents)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiOkResponse({ type: MedicationPackManifestDto })
  @ApiMedicationStandardResponses()
  getManifest(@Param('id') serviceUserId: string, @Param('packId') packId: string) {
    return this.service.getManifest(serviceUserId, packId);
  }

  @Get(':packId/manifest/pdf')
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Download the MCA contents record as a PDF' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiResponse({
    status: 200,
    description: 'MCA contents PDF (application/pdf)',
    content: {
      'application/pdf': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiMedicationStandardResponses()
  async getManifestPdf(
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    const pdf = await this.service.getManifestPdf(serviceUserId, packId);
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="mca-contents-${packId}.pdf"`)
      .send(pdf);
  }

  @Post(':packId/publish')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission(
    'service_users.medications.packs.publish',
    'service_users.medications.create',
    'service_users.medications.update',
    'service_users.update',
  )
  @ApiOperation({
    summary: 'Publish the pack — captures an immutable contents snapshot',
    description: 'Requires at least one active member. Sets pack status to ACTIVE and freezes manifest lines for CQC.',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiEnvelopeCreatedResponse({
    description: 'Published contents snapshot',
    example: MEDICATION_PACK_PUBLISH_ENVELOPE_EXAMPLE,
    innerType: MedicationPackContentsSnapshotDto,
  })
  @ApiMedicationStandardResponses()
  publish(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: PublishMedicationPackDto,
    @Req() req: Request,
  ) {
    return this.service.publish(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Post(':packId/supersede')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission(
    'service_users.medications.packs.supersede',
    'service_users.medications.update',
    'service_users.update',
  )
  @ApiOperation({ summary: 'Supersede the pack with a new next-cycle draft pack' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiCreatedResponse({ type: MedicationPackDto })
  @ApiMedicationStandardResponses()
  supersede(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: SupersedeMedicationPackDto,
    @Req() req: Request,
  ) {
    return this.service.supersede(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Post(':packId/end')
  @AnyPermission('service_users.medications.packs.supersede', 'service_users.medications.update')
  @ApiOperation({ summary: 'End the pack and all its active members' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiOkResponse({ type: MedicationPackDto })
  @ApiMedicationStandardResponses()
  end(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: EndMedicationPackDto,
    @Req() req: Request,
  ) {
    return this.service.end(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  // ---- Track E: compartments (tray time slots) --------------------------

  @Get(':packId/compartments')
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List pack compartments (time slots)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiOkResponse({ type: [MedicationPackCompartmentDto] })
  @ApiMedicationStandardResponses()
  listCompartments(@Param('id') serviceUserId: string, @Param('packId') packId: string) {
    return this.service.listCompartments(serviceUserId, packId);
  }

  @Post(':packId/compartments')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission(
    'service_users.medications.create',
    'service_users.medications.update',
    'service_users.update',
  )
  @ApiOperation({ summary: 'Add a compartment to the pack' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiCreatedResponse({ type: MedicationPackCompartmentDto })
  @ApiMedicationStandardResponses()
  addCompartment(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: CreateMedicationPackCompartmentDto,
    @Req() req: Request,
  ) {
    return this.service.addCompartment(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Patch(':packId/compartments/:compartmentId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Update a compartment' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiParam({ name: 'compartmentId', description: 'Compartment UUID' })
  @ApiOkResponse({ type: MedicationPackCompartmentDto })
  @ApiMedicationStandardResponses()
  updateCompartment(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('compartmentId') compartmentId: string,
    @Body() dto: UpdateMedicationPackCompartmentDto,
    @Req() req: Request,
  ) {
    return this.service.updateCompartment(
      user.id,
      serviceUserId,
      packId,
      compartmentId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Delete(':packId/compartments/:compartmentId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Remove a compartment' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiParam({ name: 'compartmentId', description: 'Compartment UUID' })
  @ApiOkResponse({ type: ApiSimpleDeleteResultDto })
  @ApiMedicationStandardResponses()
  removeCompartment(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('compartmentId') compartmentId: string,
    @Req() req: Request,
  ) {
    return this.service.removeCompartment(user.id, serviceUserId, packId, compartmentId, getRequestAuditMeta(req));
  }
}
