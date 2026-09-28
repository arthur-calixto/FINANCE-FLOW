import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { JwtVerifier } from './auth/jwt-verifier';
import { AuthGuard } from './auth/auth.guard';
import { WorkspaceGuard } from './auth/workspace.guard';
import { IdentityService } from './auth/identity.service';
import { WorkspaceService } from './auth/workspace.service';
import { IdentityController } from './auth/identity.controller';
@Module({
  controllers: [HealthController, IdentityController],
  providers: [
    PrismaService,
    JwtVerifier,
    AuthGuard,
    WorkspaceGuard,
    IdentityService,
    WorkspaceService,
  ],
})
export class AppModule {}
