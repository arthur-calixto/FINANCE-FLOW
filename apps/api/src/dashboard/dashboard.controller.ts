import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { dashboardQuerySchema } from '@finance-flow/validation';
import type { WorkspaceSummary } from '@finance-flow/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceGuard } from '../auth/workspace.guard';
import { CurrentWorkspace } from '../auth/context';
import { SchemaPipe } from '../resources/validation.pipe';
import { DashboardService } from './dashboard.service';
@Controller('dashboard')
@UseGuards(AuthGuard, WorkspaceGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}
  @Get() get(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @Query(new SchemaPipe(dashboardQuerySchema)) query: { month: string },
  ) {
    return this.service.get(ws.id, query.month);
  }
}
