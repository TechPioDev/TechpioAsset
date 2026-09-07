import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser, CreateSpecFieldInput, UpdateSpecFieldInput } from '@techpioasset/contracts';
import { createSpecFieldSchema, updateSpecFieldSchema } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { SpecTemplatesService } from './spec-templates.service.js';

/**
 * Spec templates (v2.42).
 *
 * Writes sit behind the catalogue review permission: the people who assess
 * offers are the ones who decide what an offer is described by. Deliberately
 * not the manage permission, which suppliers hold for their own drafts - a
 * vendor defining what buyers compare it on would be marking its own homework.
 * Deliberately not the categories permission either, which only Super Admin
 * holds, and which would leave procurement unable to set up its own fields.
 *
 * Reading is open to everyone who can see the catalogue, vendors included: a
 * supplier cannot fill in the specifications a buyer asks for without being
 * told which ones those are. The template holds no pricing and nothing about
 * any other vendor, so there is nothing here to leak.
 */
@ApiTags('spec-templates')
@Controller('spec-templates')
export class SpecTemplatesController {
  constructor(private readonly templates: SpecTemplatesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({
    summary: 'The fields a category describes its offers by',
    description: 'Vendors read this to know what to fill in; buyers read it to know what to ask for.',
  })
  list(@CurrentUser() actor: AuthUser, @Query('categoryId') categoryId: string) {
    return this.templates.list(actor, categoryId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)
  @ApiOperation({ summary: 'Add a field to a category template' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createSpecFieldSchema)) body: CreateSpecFieldInput,
  ) {
    return this.templates.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)
  @ApiOperation({
    summary: 'Edit a field',
    description:
      'The key cannot change once offers exist in the category: it is what ties the template to the values vendors already entered.',
  })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateSpecFieldSchema)) body: UpdateSpecFieldInput,
  ) {
    return this.templates.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)
  @ApiOperation({
    summary: 'Retire a field',
    description: 'The values vendors entered against it are left alone, so past comparisons still read.',
  })
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.templates.remove(actor, id);
  }
}
