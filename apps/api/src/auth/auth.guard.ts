import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtVerifier } from './jwt-verifier';
import type { ContextRequest } from './context';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly verifier: JwtVerifier) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<ContextRequest>();
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer [^\s]+$/i.test(header))
      throw new UnauthorizedException('Bearer token obrigatório');
    req.identity = await this.verifier.verify(header.slice(7));
    return true;
  }
}
