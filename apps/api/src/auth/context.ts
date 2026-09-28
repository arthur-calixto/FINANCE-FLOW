import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthIdentity } from './jwt-verifier';
import type { DomainUser, WorkspaceSummary } from '@finance-flow/types';
export interface ContextRequest {
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  identity?: AuthIdentity;
  domainUser?: DomainUser;
  workspace?: WorkspaceSummary;
}
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<ContextRequest>().identity,
);
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<ContextRequest>().workspace,
);
