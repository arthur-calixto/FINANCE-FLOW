import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { uuidSchema } from '@finance-flow/validation';
import { IdentityService } from './identity.service';
import { WorkspaceService } from './workspace.service';
import type { ContextRequest } from './context';
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly identities: IdentityService,
    private readonly workspaces: WorkspaceService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<ContextRequest>();
    if (!req.identity) throw new UnauthorizedException();
    const parsed = uuidSchema.safeParse(req.headers['x-workspace-id']);
    if (!parsed.success)
      throw new BadRequestException('X-Workspace-Id deve ser um UUID');
    if (req.params.workspaceId && req.params.workspaceId !== parsed.data)
      throw new BadRequestException(
        'Workspace da rota e do header devem coincidir',
      );
    req.domainUser = await this.identities.bootstrap(req.identity);
    req.workspace = await this.workspaces.requireMembership(
      req.domainUser.id,
      parsed.data,
    );
    return true;
  }
}
