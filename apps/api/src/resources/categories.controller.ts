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
  createCategorySchema,
  updateCategorySchema,
  resourceListSchema,
} from '@finance-flow/validation';
import type { CreateCategory, UpdateCategory } from '@finance-flow/validation';
import type { WorkspaceSummary } from '@finance-flow/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceGuard } from '../auth/workspace.guard';
import { CurrentWorkspace } from '../auth/context';
import { WriteGuard } from './write.guard';
import { SchemaPipe } from './validation.pipe';
import { CategoriesService } from './categories.service';
@Controller('categories')
@UseGuards(AuthGuard, WorkspaceGuard)
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}
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
    @Body(new SchemaPipe(createCategorySchema)) data: CreateCategory,
  ) {
    return this.service.create(ws.id, data);
  }
  @Patch(':id') @UseGuards(WriteGuard) update(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(updateCategorySchema)) data: UpdateCategory,
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
