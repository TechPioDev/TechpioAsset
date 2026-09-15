import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  expenseExportLinkSchema,
  expenseExportQuerySchema,
  expenseQuerySchema,
  type AuthUser,
  type ExpenseExportQuery,
  type ExpenseQuery,
} from '@techpioasset/contracts';
import { CurrentUser, Public } from '../auth/decorators.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { ExpenseExportService, type ExpenseFile } from './expense-export.service.js';
import { ExpensesService } from './expenses.service.js';

function send(res: Response, file: ExpenseFile) {
  res.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    'Content-Length': String(file.buffer.length),
    // Never cached: the figures change, and a signed link must stop working.
    'Cache-Control': 'private, no-store',
  });
  res.end(file.buffer);
}

/**
 * Expense report (v2.59). Super Admin ONLY - enforced in the service on the
 * role, because no permission is exclusive to Super Admin (Finance holds the
 * cost permissions too). Every route except the signed-link download requires
 * a signed-in Super Admin; that one route is public because the signature is
 * the credential, and the signer was checked when it was minted.
 */
@ApiTags('Expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly exports: ExpenseExportService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Expense summary for a period (Super Admin only)',
    description:
      'Asset purchases (by purchase date), completed repairs (by closing date) and software licences ' +
      '(by purchase date, plus renewals). Invoices are not counted. Money is exact decimal strings.',
  })
  summary(@CurrentUser() actor: AuthUser, @Query(zodBody(expenseQuerySchema)) query: ExpenseQuery) {
    return this.expenses.summary(actor, query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Download the expense report as PDF or Excel (Super Admin only)' })
  async export(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(expenseExportQuerySchema)) query: ExpenseExportQuery,
    @Res() res: Response,
  ) {
    send(res, await this.exports.export(actor, query));
  }

  @Post('export-link')
  @HttpCode(201)
  @ApiOperation({
    summary: 'A two-minute download link for the expense report (Super Admin only)',
    description:
      'For the phone app, which opens files in the system browser without a sign-in header. ' +
      'Access is checked now; the link carries the report query and expires after two minutes.',
  })
  exportLink(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(expenseExportLinkSchema)) body: ExpenseExportQuery,
  ) {
    return this.exports.createLink(actor, body);
  }

  // Public on purpose, and only this one route: the signature is the credential.
  @Get('export-links/:token')
  @Public()
  @ApiOperation({ summary: 'Download an expense report through a signed link' })
  async readLink(@Param('token') token: string, @Res() res: Response) {
    send(res, await this.exports.readByLink(token));
  }
}
