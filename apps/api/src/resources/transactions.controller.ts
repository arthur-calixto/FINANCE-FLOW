import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  createTransactionSchema,
  updateTransactionSchema,
  payTransactionSchema,
  transactionListSchema,
  transactionSummarySchema,
  transactionMonthViewSchema,
  permanentlyDeleteTransactionSchema,
  z,
} from '@finance-flow/validation';
import type {
  CreateTransaction,
  UpdateTransaction,
  PayTransaction,
  TransactionQuery,
  PermanentlyDeleteTransaction,
} from '@finance-flow/validation';
import type { WorkspaceSummary, DomainUser } from '@finance-flow/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceGuard } from '../auth/workspace.guard';
import { CurrentWorkspace, CurrentUser } from '../auth/context';
import { WriteGuard } from './write.guard';
import { SchemaPipe } from './validation.pipe';
import { TransactionsService } from './transactions.service';
@Controller('transactions')
@UseGuards(AuthGuard, WorkspaceGuard)
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}
  @Get() list(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Query(new SchemaPipe(transactionListSchema)) query: TransactionQuery,
  ) {
    return this.service.list(ws.id, query);
  }
  @Get('summary') summary(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Query(new SchemaPipe(transactionSummarySchema)) query: { month: string },
  ) {
    return this.service.summary(ws.id, query.month);
  }
  @Get('month-view') monthView(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Query(new SchemaPipe(transactionMonthViewSchema)) query: TransactionQuery,
  ) {
    return this.service.monthView(ws.id, query);
  }
  @Get(':id/deletion-options') deletionOptions(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.deletionOptions(ws.id, id);
  }
  @Delete(':id/permanent') @UseGuards(WriteGuard) permanentlyDelete(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(permanentlyDeleteTransactionSchema))
    data: PermanentlyDeleteTransaction,
  ) {
    return this.service.permanentlyDelete(ws.id, id, data);
  }
  @Post(':id/cancel') @HttpCode(200) @UseGuards(WriteGuard) cancelExplicit(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.cancel(ws.id, id);
  }
  @Get(':id') get(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(ws.id, id);
  }
  @Post() @UseGuards(WriteGuard) create(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Body(new SchemaPipe(createTransactionSchema)) data: CreateTransaction,
  ) {
    return this.service.create(ws.id, user.id, data);
  }
  @Patch(':id') @UseGuards(WriteGuard) update(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(updateTransactionSchema)) data: UpdateTransaction,
  ) {
    return this.service.update(ws.id, id, data);
  }
  @Delete(':id') @UseGuards(WriteGuard) cancel(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.cancel(ws.id, id);
  }
  @Post(':id/pay') @HttpCode(200) @UseGuards(WriteGuard) pay(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(payTransactionSchema)) data: PayTransaction,
  ) {
    return this.service.pay(ws.id, id, data);
  }
  @Post(':id/reopen') @HttpCode(200) @UseGuards(WriteGuard) reopen(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(z.object({}).strict().optional())) _data: unknown,
  ) {
    void _data;
    return this.service.reopen(ws.id, id);
  }
}
