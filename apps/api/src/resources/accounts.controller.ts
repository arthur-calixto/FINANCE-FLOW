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
} from '@nestjs/common';
import {
  createAccountSchema,
  updateAccountSchema,
  resourceListSchema,
} from '@finance-flow/validation';
import type { CreateAccount, UpdateAccount } from '@finance-flow/validation';
import type { WorkspaceSummary } from '@finance-flow/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceGuard } from '../auth/workspace.guard';
import { CurrentWorkspace } from '../auth/context';
import { WriteGuard } from './write.guard';
import { SchemaPipe } from './validation.pipe';
import { AccountsService } from './accounts.service';
@Controller('accounts')
@UseGuards(AuthGuard, WorkspaceGuard)
export class AccountsController {
  constructor(private readonly service: AccountsService) {}
  @Get() list(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Query(new SchemaPipe(resourceListSchema))
    query: { includeInactive: boolean },
  ) {
    return this.service.list(ws.id, query.includeInactive);
  }
  @Get(':id') get(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(ws.id, id);
  }
  @Post() @UseGuards(WriteGuard) create(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Body(new SchemaPipe(createAccountSchema)) data: CreateAccount,
  ) {
    return this.service.create(ws.id, data);
  }
  @Patch(':id') @UseGuards(WriteGuard) update(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(updateAccountSchema)) data: UpdateAccount,
  ) {
    return this.service.update(ws.id, id, data);
  }
  @Delete(':id') @UseGuards(WriteGuard) deactivate(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.deactivate(ws.id, id);
  }
}
