import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AuthUser,
  CreateWorkflowStepInput,
  ReorderWorkflowStepsInput,
  UpdateWorkflowStepInput,
} from '@techpioasset/contracts';
import {
  createWorkflowStepSchema,
  reorderWorkflowStepsSchema,
  setAssessmentStagesSchema,
  updateWorkflowStepSchema,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { WorkflowsService } from './workflows.service.js';

@ApiTags('Approval workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WORKFLOWS_CONFIGURE)
  @ApiOperation({
    summary: 'The configured approval chains',
    description:
      'Every workflow with its steps in order, each reporting how many active accounts could ' +
      'actually decide it - a step that applies to every request but has no eligible approver ' +
      'is the failure worth seeing.',
  })
  list(@CurrentUser() actor: AuthUser) {
    return this.workflows.list(actor);
  }

  @Patch(':id/assessment-stages')
  @RequirePermissions(PERMISSIONS.WORKFLOWS_CONFIGURE)
  @ApiOperation({
    summary: 'Add or remove the inventory-check and cost-assessment stages',
    description:
      'The two stages go in immediately before the first thresholded step, because their answer ' +
      'is what that threshold is measured against. Requests already in flight are untouched.',
  })
  setAssessmentStages(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(setAssessmentStagesSchema)) body: { enabled: boolean; roleKey?: string },
  ) {
    return this.workflows.setAssessmentStages(actor, id, body);
  }

  @Post(':id/steps')
  @RequirePermissions(PERMISSIONS.WORKFLOWS_CONFIGURE)
  @ApiOperation({
    summary: 'Add an approval step',
    description:
      'Inserted at `position` among the approval steps (default last). The assessment stages, ' +
      'if present, are re-placed by their rule. Requests already in flight keep their chain.',
  })
  addStep(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(createWorkflowStepSchema)) body: CreateWorkflowStepInput,
  ) {
    return this.workflows.addStep(actor, id, body);
  }

  @Put(':id/steps/order')
  @RequirePermissions(PERMISSIONS.WORKFLOWS_CONFIGURE)
  @ApiOperation({
    summary: 'Reorder the approval steps',
    description:
      'Every approval step id exactly once, in the wanted order. The assessment stages follow ' +
      'their rule: adjacent, immediately before the first thresholded step, else last.',
  })
  reorderSteps(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reorderWorkflowStepsSchema)) body: ReorderWorkflowStepsInput,
  ) {
    return this.workflows.reorderSteps(actor, id, body);
  }

  @Patch('steps/:id')
  @RequirePermissions(PERMISSIONS.WORKFLOWS_CONFIGURE)
  @ApiOperation({
    summary: 'Change a step: name, cost threshold, skippability, SLA, or role',
    description:
      'A null threshold means the step applies to every request. Moving the role also moves ' +
      'the requests already waiting on the step; a rename reaches future requests only.',
  })
  updateStep(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateWorkflowStepSchema)) body: UpdateWorkflowStepInput,
  ) {
    return this.workflows.updateStep(actor, id, body);
  }

  @Delete('steps/:id')
  @RequirePermissions(PERMISSIONS.WORKFLOWS_CONFIGURE)
  @ApiOperation({
    summary: 'Remove an approval step',
    description:
      'Refused for the last approval step and for the assessment stages (which leave as a pair ' +
      'via assessment-stages). Requests already waiting on the step keep their current chain; ' +
      'new requests skip it.',
  })
  removeStep(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.workflows.removeStep(actor, id);
  }
}
