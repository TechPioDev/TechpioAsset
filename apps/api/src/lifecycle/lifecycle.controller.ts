import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { LifecycleService } from './lifecycle.service.js';

const startSchema = z.object({
  subjectUserId: z.string().min(1),
  templateKey: z.string().optional(),
});

/** v2.85 - why an offboarding was called off, for the record. */
const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const completeSchema = z.object({
  /**
   * Required only when assets are still outstanding. Minimum length is enforced
   * server-side: "documented exception" means something a person can be held to.
   */
  exceptionReason: z.string().trim().max(1000).optional(),
});

@ApiTags('Onboarding and offboarding')
@Controller('lifecycle')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get('tasks')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({ summary: 'List onboarding and offboarding tasks' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query('direction') direction?: 'ONBOARDING' | 'OFFBOARDING',
    @Query('status') status?: string,
  ) {
    return this.lifecycle.listTasks(actor, direction, status);
  }

  @Get('tasks/:id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({
    summary: 'Read a task with its outstanding assets',
    description: 'canComplete is a convenience for the UI; the server re-checks on completion.',
  })
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.lifecycle.getTask(actor, id);
  }

  @Post('onboarding')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({ summary: 'Start onboarding for an employee' })
  startOnboarding(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(startSchema)) body: { subjectUserId: string; templateKey?: string },
  ) {
    return this.lifecycle.startOnboarding(actor, body.subjectUserId, body.templateKey);
  }

  @Get('offboarding/preview/:subjectUserId')
  @RequirePermissions(PERMISSIONS.OFFBOARDING_MANAGE)
  @ApiOperation({
    summary: 'What offboarding this person would involve',
    description:
      'Writes nothing and notifies nobody (v2.85): the screen opens on this, and only the ' +
      'Start button creates the offboarding. Returns the open one if there already is one.',
  })
  previewOffboarding(
    @CurrentUser() actor: AuthUser,
    @Param('subjectUserId') subjectUserId: string,
  ) {
    return this.lifecycle.previewOffboarding(actor, subjectUserId);
  }

  @Post('offboarding/:id/cancel')
  @RequirePermissions(PERMISSIONS.OFFBOARDING_MANAGE)
  @ApiOperation({
    summary: 'Call off an offboarding started by mistake',
    description: 'The employee is told it is off; returns already recorded stay recorded.',
  })
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(cancelSchema)) body: { reason?: string },
  ) {
    return this.lifecycle.cancelOffboarding(actor, id, body.reason);
  }

  @Post('offboarding')
  @RequirePermissions(PERMISSIONS.OFFBOARDING_MANAGE)
  @ApiOperation({
    summary: 'Start offboarding',
    description: 'Snapshots every asset still assigned and notifies the employee.',
  })
  startOffboarding(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(startSchema)) body: { subjectUserId: string },
  ) {
    return this.lifecycle.startOffboarding(actor, body.subjectUserId);
  }

  @Post('offboarding/:id/complete')
  @RequirePermissions(PERMISSIONS.OFFBOARDING_MANAGE)
  @ApiOperation({
    summary: 'Complete an offboarding',
    description:
      'Refused with 409 while any asset remains in the employee’s custody, unless a documented ' +
      'exceptionReason is supplied (spec section 13).',
  })
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(completeSchema)) body: { exceptionReason?: string },
  ) {
    return this.lifecycle.completeOffboarding(actor, id, body.exceptionReason);
  }
}
