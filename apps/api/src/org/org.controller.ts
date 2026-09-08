import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createDepartmentSchema,
  createOfficeSchema,
  createVendorSchema,
  updateVendorSchema,
  updateDepartmentSchema,
  updateOfficeSchema,
  type AuthUser,
  type CreateDepartmentInput,
  type CreateOfficeInput,
  type CreateVendorInput,
  type UpdateVendorInput,
  type UpdateDepartmentInput,
  type UpdateOfficeInput,
  updateOwnVendorSchema,
  type UpdateOwnVendorInput,
} from '@techpioasset/contracts';
import {
  PERMISSIONS,
  REQUEST_CREATION_POLICIES,
  VENDOR_OFFER_POLICIES,
} from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { OrgService } from './org.service.js';

/** Currency is a label, not a conversion - three letters, upper-cased. */
const updateCompanySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    baseCurrency: z.string().trim().length(3).toUpperCase().optional(),
    timezone: z.string().trim().max(64).optional(),
    /** v2.22 - who may raise a request across the whole tenant. */
    requestPolicy: z.enum(REQUEST_CREATION_POLICIES).optional(),
    vendorOfferPolicy: z.enum(VENDOR_OFFER_POLICIES).optional(),
  })
  .strict();
type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

@ApiTags('Organisation')
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('company')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: "The company's own settings" })
  company(@CurrentUser() actor: AuthUser) {
    return this.org.companySettings(actor);
  }

  @Patch('company')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({
    summary: 'Update company settings',
    description:
      'Base currency labels money going forward (estimates, prices); existing figures are not converted.',
  })
  updateCompany(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(updateCompanySchema)) body: UpdateCompanyInput,
  ) {
    return this.org.updateCompanySettings(actor, body);
  }

  @Get('offices')
  @ApiOperation({ summary: 'Offices with buildings, floors and rooms' })
  offices(@CurrentUser() actor: AuthUser) {
    return this.org.offices(actor);
  }

  @Get('offices/manage')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'All offices, inactive included, for the management page' })
  officesForManagement(@CurrentUser() actor: AuthUser) {
    return this.org.officesForManagement(actor);
  }

  @Post('offices')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Create an office' })
  createOffice(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createOfficeSchema)) body: CreateOfficeInput,
  ) {
    return this.org.createOffice(actor, body);
  }

  @Patch('offices/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update or deactivate an office' })
  updateOffice(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateOfficeSchema)) body: UpdateOfficeInput,
  ) {
    return this.org.updateOffice(actor, id, body);
  }

  @Get('departments')
  @ApiOperation({ summary: 'Departments' })
  departments(@CurrentUser() actor: AuthUser) {
    return this.org.departments(actor);
  }

  @Get('departments/manage')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'All departments, inactive included, for the management page' })
  departmentsForManagement(@CurrentUser() actor: AuthUser) {
    return this.org.departmentsForManagement(actor);
  }

  @Post('departments')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Create a department (v2.21)' })
  createDepartment(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createDepartmentSchema)) body: CreateDepartmentInput,
  ) {
    return this.org.createDepartment(actor, body);
  }

  @Patch('departments/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update or deactivate a department (v2.21)' })
  updateDepartment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateDepartmentSchema)) body: UpdateDepartmentInput,
  ) {
    return this.org.updateDepartment(actor, id, body);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Asset categories and subcategories' })
  categories(@CurrentUser() actor: AuthUser) {
    return this.org.categories(actor);
  }

  @Get('vendors')
  @RequirePermissions(PERMISSIONS.VENDORS_READ)
  @ApiOperation({ summary: 'Vendors' })
  vendors(@CurrentUser() actor: AuthUser) {
    return this.org.vendors(actor);
  }

  // v2.40: vendors:manage was granted to Finance and Procurement Manager and
  // enforced by nothing - there was no way to add a vendor, so a purchase order
  // could only name the "Unknown vendor" placeholder a bill upload creates.

  @Get('vendors/me')
  @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS)
  @ApiOperation({
    summary: "A supplier's own company record",
    description:
      'Scoped by the vendor link on the account, so there is no id to tamper with. The buying ' +
      "company's internal notes about the supplier are not included.",
  })
  ownVendor(@CurrentUser() actor: AuthUser) {
    return this.org.ownVendor(actor);
  }

  @Patch('vendors/me')
  @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS)
  @ApiOperation({
    summary: 'A supplier updates its own contact and address details',
    description:
      'Name, code and active status are the buying company’s record of the supplier, not the ' +
      'supplier’s to change, so they are not accepted here.',
  })
  updateOwnVendor(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(updateOwnVendorSchema)) body: UpdateOwnVendorInput,
  ) {
    return this.org.updateOwnVendor(actor, body);
  }

  @Get('vendors/manage')
  @RequirePermissions(PERMISSIONS.VENDORS_MANAGE)
  @ApiOperation({ summary: 'All vendors, inactive included, for the management page' })
  vendorsForManagement(@CurrentUser() actor: AuthUser) {
    return this.org.vendorsForManagement(actor);
  }

  @Post('vendors')
  @RequirePermissions(PERMISSIONS.VENDORS_MANAGE)
  @ApiOperation({ summary: 'Add a vendor' })
  createVendor(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createVendorSchema)) body: CreateVendorInput,
  ) {
    return this.org.createVendor(actor, body);
  }

  @Patch('vendors/:id')
  @RequirePermissions(PERMISSIONS.VENDORS_MANAGE)
  @ApiOperation({ summary: 'Edit a vendor, or deactivate it with isActive:false' })
  updateVendor(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateVendorSchema)) body: UpdateVendorInput,
  ) {
    return this.org.updateVendor(actor, id, body);
  }

  @Delete('vendors/:id')
  @RequirePermissions(PERMISSIONS.VENDORS_MANAGE)
  @ApiOperation({ summary: 'Delete a vendor that has no history; otherwise deactivate it' })
  deleteVendor(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.org.deleteVendor(actor, id);
  }
}
