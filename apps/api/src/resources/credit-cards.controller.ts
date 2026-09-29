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
  createCreditCardSchema,
  updateCreditCardSchema,
  createPurchaseSchema,
  purchasePreviewSchema,
  invoiceListSchema,
  payInvoiceSchema,
  resourceListSchema,
} from '@finance-flow/validation';
import type {
  CreateCreditCard,
  UpdateCreditCard,
  CreatePurchase,
  PayInvoice,
} from '@finance-flow/validation';
import type { WorkspaceSummary, DomainUser } from '@finance-flow/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceGuard } from '../auth/workspace.guard';
import { CurrentWorkspace, CurrentUser } from '../auth/context';
import { WriteGuard } from './write.guard';
import { SchemaPipe } from './validation.pipe';
import { CreditCardsService } from './credit-cards.service';
@Controller('credit-cards')
@UseGuards(AuthGuard, WorkspaceGuard)
export class CreditCardsController {
  constructor(private readonly service: CreditCardsService) {}
  @Get() list(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Query(new SchemaPipe(resourceListSchema)) q: { includeInactive: boolean },
  ) {
    return this.service.list(ws.id, q.includeInactive);
  }
  @Get(':id') get(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(ws.id, id);
  }
  @Post() @UseGuards(WriteGuard) create(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Body(new SchemaPipe(createCreditCardSchema)) data: CreateCreditCard,
  ) {
    return this.service.create(ws.id, data);
  }
  @Patch(':id') @UseGuards(WriteGuard) update(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(updateCreditCardSchema)) data: UpdateCreditCard,
  ) {
    return this.service.update(ws.id, id, data);
  }
  @Delete(':id') @UseGuards(WriteGuard) deactivate(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.update(ws.id, id, { isActive: false });
  }
  @Get(':id/purchase-preview') preview(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new SchemaPipe(purchasePreviewSchema))
    q: { transactionDate: string },
  ) {
    return this.service.preview(ws.id, id, q.transactionDate);
  }
  @Post(':id/purchases') @UseGuards(WriteGuard) purchase(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(createPurchaseSchema)) data: CreatePurchase,
  ) {
    return this.service.purchase(ws.id, id, user.id, data);
  }
  @Delete(':id/purchases/:purchaseId') @UseGuards(WriteGuard) cancel(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
  ) {
    return this.service.cancelPurchase(ws.id, id, purchaseId);
  }
  @Get(':id/invoices') invoices(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new SchemaPipe(invoiceListSchema)) q: { month?: string },
  ) {
    return this.service.invoices(ws.id, id, q.month);
  }
  @Get(':id/invoices/:invoiceId') detail(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ) {
    return this.service.detail(ws.id, id, invoiceId);
  }
  @Post(':id/invoices/:invoiceId/pay')
  @HttpCode(200)
  @UseGuards(WriteGuard)
  pay(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body(new SchemaPipe(payInvoiceSchema)) data: PayInvoice,
  ) {
    return this.service.pay(ws.id, id, invoiceId, data);
  }
}
