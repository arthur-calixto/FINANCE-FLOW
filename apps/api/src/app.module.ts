import { AccountsController } from './resources/accounts.controller';
import { AccountsService } from './resources/accounts.service';
import { CategoriesController } from './resources/categories.controller';
import { CategoriesService } from './resources/categories.service';
import { WriteGuard } from './resources/write.guard';
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
  controllers: [
    HealthController,
    IdentityController,
    AccountsController,
    CategoriesController,
  ],
  providers: [
    PrismaService,
    AccountsService,
    CategoriesService,
    WriteGuard,
    JwtVerifier,
    AuthGuard,
    WorkspaceGuard,
    IdentityService,
    WorkspaceService,
  ],
})
export class AppModule {}
