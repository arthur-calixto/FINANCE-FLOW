import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { CurrentIdentity, CurrentWorkspace } from './context';
import type { AuthIdentity } from './jwt-verifier';
import type { WorkspaceSummary } from '@finance-flow/types';
import { IdentityService } from './identity.service';
import { WorkspaceService } from './workspace.service';
@Controller()
@UseGuards(AuthGuard)
export class IdentityController {
  constructor(
    private readonly identities: IdentityService,
    private readonly workspaces: WorkspaceService,
  ) {}
  @Get('me')
  async me(@CurrentIdentity() identity: AuthIdentity) {
    const user = await this.identities.bootstrap(identity);
    return { user, workspaces: await this.workspaces.list(user.id) };
  }
  @Get('workspaces')
  async list(@CurrentIdentity() identity: AuthIdentity) {
    const user = await this.identities.bootstrap(identity);
    return this.workspaces.list(user.id);
  }
  @Get('workspaces/:id')
  @UseGuards(WorkspaceGuard)
  detail(@CurrentWorkspace() workspace: WorkspaceSummary) {
    return workspace;
  }
}
