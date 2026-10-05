import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createWorkspaceSchema,
  renameWorkspaceSchema,
  createInvitationSchema,
  invitationTokenSchema,
} from '@finance-flow/validation';
import type { DomainUser, WorkspaceSummary } from '@finance-flow/types';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceGuard } from '../auth/workspace.guard';
import {
  CurrentIdentity,
  CurrentUser,
  CurrentWorkspace,
} from '../auth/context';
import type { AuthIdentity } from '../auth/jwt-verifier';
import { IdentityService } from '../auth/identity.service';
import { SchemaPipe } from '../resources/validation.pipe';
import { SharingService } from './sharing.service';
@Controller('workspaces')
@UseGuards(AuthGuard)
export class SharingController {
  constructor(
    private readonly service: SharingService,
    private readonly identities: IdentityService,
  ) {}
  @Post() async create(
    @CurrentIdentity() identity: AuthIdentity,
    @Body(new SchemaPipe(createWorkspaceSchema))
    data: { name: string; type: 'FAMILY' },
  ) {
    const user = await this.identities.bootstrap(identity);
    return this.service.create(user.id, data.name);
  }
  @Patch(':workspaceId')
  @UseGuards(WorkspaceGuard)
  rename(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Body(new SchemaPipe(renameWorkspaceSchema)) data: { name: string },
  ) {
    return this.service.rename(ws.id, user.id, data.name);
  }
  @Get(':workspaceId/members')
  @UseGuards(WorkspaceGuard)
  members(@CurrentWorkspace() ws: WorkspaceSummary) {
    return this.service.members(ws.id);
  }
  @Delete(':workspaceId/members/:memberId')
  @UseGuards(WorkspaceGuard)
  remove(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Param('memberId', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.remove(ws.id, user.id, id);
  }
  @Get(':workspaceId/invitations')
  @UseGuards(WorkspaceGuard)
  invitations(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
  ) {
    return this.service.invitations(ws.id, user.id);
  }
  @Post(':workspaceId/invitations')
  @UseGuards(WorkspaceGuard)
  invite(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Body(new SchemaPipe(createInvitationSchema))
    data: { email: string; role: 'MEMBER' },
  ) {
    return this.service.invite(ws.id, user, data.email);
  }
  @Delete(':workspaceId/invitations/:invitationId')
  @UseGuards(WorkspaceGuard)
  cancel(
    @CurrentWorkspace() ws: WorkspaceSummary,
    @CurrentUser() user: DomainUser,
    @Param('invitationId', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.cancel(ws.id, user.id, id);
  }
}
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly service: SharingService,
    private readonly identities: IdentityService,
  ) {}
  @Get(':token') preview(
    @Param('token', new SchemaPipe(invitationTokenSchema)) token: string,
  ) {
    return this.service.preview(token);
  }
  @Post(':token/accept')
  @UseGuards(AuthGuard)
  async accept(
    @Param('token', new SchemaPipe(invitationTokenSchema)) token: string,
    @CurrentIdentity() identity: AuthIdentity,
  ) {
    return this.service.respond(
      token,
      await this.identities.bootstrap(identity),
      true,
    );
  }
  @Post(':token/decline')
  @UseGuards(AuthGuard)
  async decline(
    @Param('token', new SchemaPipe(invitationTokenSchema)) token: string,
    @CurrentIdentity() identity: AuthIdentity,
  ) {
    return this.service.respond(
      token,
      await this.identities.bootstrap(identity),
      false,
    );
  }
}
