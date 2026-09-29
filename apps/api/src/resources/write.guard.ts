import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { ContextRequest } from '../auth/context';
@Injectable()
export class WriteGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ContextRequest>();
    if (!req.workspace || req.workspace.role === 'VIEWER')
      throw new ForbiddenException('Seu acesso permite somente consulta.');
    return true;
  }
}
