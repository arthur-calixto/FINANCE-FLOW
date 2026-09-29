import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  createInstallmentSchema,
  createCardInstallmentSchema,
  installmentPreviewSchema,
  cardInstallmentPreviewSchema,
  cancelInstallmentsSchema,
} from '@finance-flow/validation';
import type {
  CreateInstallment,
  CreateCardInstallment,
  InstallmentPreviewInput,
  CardInstallmentPreviewInput,
  CancelInstallments,
} from '@finance-flow/validation';
import type { WorkspaceSummary, DomainUser } from '@finance-flow/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceGuard } from '../auth/workspace.guard';
import { CurrentWorkspace, CurrentUser } from '../auth/context';
import { WriteGuard } from './write.guard';
import { SchemaPipe } from './validation.pipe';
import { InstallmentsService } from './installments.service';
@Controller()
@UseGuards(AuthGuard, WorkspaceGuard)
export class InstallmentsController {
  constructor(private readonly service: InstallmentsService) {}
  @Post('installments/preview') @HttpCode(200) preview(
    @Body(new SchemaPipe(installmentPreviewSchema))
    data: InstallmentPreviewInput,
  ) {
    return this.service.preview(data);
  }
  @Post('installments') @UseGuards(WriteGuard) create(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Body(new SchemaPipe(createInstallmentSchema)) data: CreateInstallment,
  ) {
    return this.service.create(ws.id, user.id, data);
  }
  @Post('credit-cards/:id/installments/preview') @HttpCode(200) cardPreview(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(cardInstallmentPreviewSchema))
    data: CardInstallmentPreviewInput,
  ) {
    return this.service.cardPreview(ws.id, id, data);
  }
  @Post('credit-cards/:id/installments') @UseGuards(WriteGuard) createCard(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(createCardInstallmentSchema))
    data: CreateCardInstallment,
  ) {
    return this.service.createCard(ws.id, id, user.id, data);
  }
  @Get('installment-groups/:id') get(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(ws.id, id);
  }
  @Post('installment-groups/:id/cancel')
  @HttpCode(200)
  @UseGuards(WriteGuard)
  cancelCommon(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(cancelInstallmentsSchema)) data: CancelInstallments,
  ) {
    return this.service.cancelCommon(ws.id, id, data);
  }
  @Delete('installment-groups/:id') @UseGuards(WriteGuard) cancelCard(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.cancelCard(ws.id, id);
  }
}
