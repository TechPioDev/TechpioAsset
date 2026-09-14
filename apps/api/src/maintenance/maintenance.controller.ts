import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  approveWorkOrderSchema,
  assignWorkOrderSchema,
  cancelMaintenanceSchema,
  completeMaintenanceSchema,
  consumePartSchema,
  createMaintenanceSchema,
  createMaintenanceScheduleSchema,
  diagnosisSchema,
  holdWorkOrderSchema,
  maintenanceListQuerySchema,
  scheduleMaintenanceSchema,
  sendBackWorkOrderSchema,
  updateMaintenanceScheduleSchema,
  type ApproveWorkOrderInput,
  type AssignWorkOrderInput,
  type AuthUser,
  type CancelMaintenanceInput,
  type ConsumePartInput,
  type CreateMaintenanceInput,
  type CreateMaintenanceScheduleInput,
  type HoldWorkOrderInput,
  type MaintenanceListQuery,
  type SendBackWorkOrderInput,
  type UpdateMaintenanceScheduleInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { MaintenanceService } from './maintenance.service.js';

const repairAdviceSchema = z.object({ repairCost: z.string().regex(/^\d+(\.\d{1,2})?$/) });

@ApiTags('Maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MAINTENANCE_READ)
  @ApiOperation({ summary: 'List maintenance records' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(maintenanceListQuerySchema)) query: MaintenanceListQuery,
  ) {
    return this.maintenance.list(actor, query);
  }

  // Static routes stay ABOVE ':id' so Express does not swallow them as ids.
  @Get('schedules')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_READ)
  @ApiOperation({ summary: 'Preventive maintenance schedules' })
  listSchedules(@CurrentUser() actor: AuthUser, @Query('assetId') assetId?: string) {
    return this.maintenance.listSchedules(actor, assetId);
  }

  @Post('schedules')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Create a preventive schedule (sweep spawns the orders)' })
  createSchedule(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createMaintenanceScheduleSchema)) body: CreateMaintenanceScheduleInput,
  ) {
    return this.maintenance.createSchedule(actor, body);
  }

  @Patch('schedules/:id')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Retitle, retime or de/activate a schedule' })
  updateSchedule(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateMaintenanceScheduleSchema)) body: UpdateMaintenanceScheduleInput,
  ) {
    return this.maintenance.updateSchedule(actor, id, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_READ)
  @ApiOperation({ summary: 'Read a maintenance record (with parts drawn)' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.maintenance.findOne(actor, id);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Assign a technician (optionally with an SLA deadline)' })
  assign(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(assignWorkOrderSchema)) body: AssignWorkOrderInput,
  ) {
    return this.maintenance.assign(actor, id, body);
  }

  @Patch(':id/diagnosis')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Record the diagnosis' })
  setDiagnosis(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(diagnosisSchema)) body: { diagnosis: string },
  ) {
    return this.maintenance.setDiagnosis(actor, id, body.diagnosis);
  }

  @Post(':id/hold')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Pause in-progress work' })
  hold(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(holdWorkOrderSchema)) body: HoldWorkOrderInput,
  ) {
    return this.maintenance.hold(actor, id, body.reason);
  }

  @Post(':id/resume')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Resume held work' })
  resume(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.maintenance.resume(actor, id);
  }

  @Post(':id/consume-part')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({
    summary: 'Draw a part from stock for this work order',
    description: 'The v2.4 guarded take; refusals return the honest numbers.',
  })
  consumePart(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(consumePartSchema)) body: ConsumePartInput,
  ) {
    return this.maintenance.consumePart(actor, id, body);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Raise a maintenance record' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createMaintenanceSchema)) body: CreateMaintenanceInput,
  ) {
    return this.maintenance.create(actor, body);
  }

  @Post(':id/schedule')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Schedule a date' })
  schedule(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(scheduleMaintenanceSchema)) body: { scheduledFor: Date },
  ) {
    return this.maintenance.schedule(actor, id, body.scheduledFor);
  }

  @Post(':id/start')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Start work (takes the asset under repair)' })
  start(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.maintenance.start(actor, id);
  }

  @Post(':id/accept')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({
    summary: 'The assigned technician accepts the work order',
    description: 'Required before work starts on an assigned order. Reassignment clears it.',
  })
  accept(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.maintenance.accept(actor, id);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({
    summary: 'Complete, recording cost and downtime',
    description: 'Moves the order to AWAITING_APPROVAL; a different manager signs it off.',
  })
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(completeMaintenanceSchema)) body: Parameters<MaintenanceService['complete']>[2],
  ) {
    return this.maintenance.complete(actor, id, body);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({
    summary: 'Approve completed work (closes the order, restores the asset)',
    description: 'Refused (403) for the person who completed it - segregation of duties.',
  })
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    // Body optional: a bare POST approves with the technician's restore choice.
    @Body(zodBody(approveWorkOrderSchema.optional())) body: ApproveWorkOrderInput | undefined,
  ) {
    return this.maintenance.approve(actor, id, body ?? {});
  }

  @Post(':id/send-back')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({
    summary: 'Send completed work back to the technician with a reason',
    description: 'Refused (403) for the person who completed it - segregation of duties.',
  })
  sendBack(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(sendBackWorkOrderSchema)) body: SendBackWorkOrderInput,
  ) {
    return this.maintenance.sendBack(actor, id, body.reason);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Cancel a maintenance record (optional reason)' })
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    // Optional, so the original body-less cancel call still works.
    @Body(zodBody(cancelMaintenanceSchema.optional())) body: CancelMaintenanceInput | undefined,
  ) {
    return this.maintenance.cancel(actor, id, body?.reason);
  }

  @Post('assets/:assetId/repair-advice')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_READ, PERMISSIONS.ASSETS_COST_READ)
  @ApiOperation({ summary: 'Repair-versus-replace guidance for an asset' })
  repairAdvice(
    @CurrentUser() actor: AuthUser,
    @Param('assetId') assetId: string,
    @Body(zodBody(repairAdviceSchema)) body: { repairCost: string },
  ) {
    return this.maintenance.repairAdvice(actor, assetId, body.repairCost);
  }
}
