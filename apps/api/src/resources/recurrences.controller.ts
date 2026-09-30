import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createRecurrenceSchema,
  updateRecurrenceSchema,
  recurrencePreviewSchema,
  endRecurrenceSchema,
} from '@finance-flow/validation';
import type {
  CreateRecurrence,
  UpdateRecurrence,
  RecurrencePreviewInput,
} from '@finance-flow/validation';
import type { WorkspaceSummary, DomainUser } from '@finance-flow/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceGuard } from '../auth/workspace.guard';
import { CurrentWorkspace, CurrentUser } from '../auth/context';
import { WriteGuard } from './write.guard';
import { SchemaPipe } from './validation.pipe';
import { RecurrencesService } from './recurrences.service';
@Controller('recurrences')
@UseGuards(AuthGuard, WorkspaceGuard)
export class RecurrencesController {
  constructor(private readonly service: RecurrencesService) {}
  @Get() list(@CurrentWorkspace() ws: WorkspaceSummary) {
    return this.service.list(ws.id);
  }
  @Post('preview') @HttpCode(200) preview(
    @Body(new SchemaPipe(recurrencePreviewSchema)) data: RecurrencePreviewInput,
  ) {
    return this.service.preview(data);
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
    @Body(new SchemaPipe(createRecurrenceSchema)) data: CreateRecurrence,
  ) {
    return this.service.create(ws.id, user.id, data);
  }
  @Patch(':id') @UseGuards(WriteGuard) update(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(updateRecurrenceSchema)) data: UpdateRecurrence,
  ) {
    return this.service.update(ws.id, id, user.id, data);
  }
  @Delete(':id') @UseGuards(WriteGuard) end(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(endRecurrenceSchema)) data: { fromDate: string },
  ) {
    return this.service.end(ws.id, id, data.fromDate);
  }
}
