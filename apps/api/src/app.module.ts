import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { AccountBalancesService } from './resources/account-balances.service';
import {
  SharingController,
  InvitationsController,
} from './sharing/sharing.controller';
import { SharingService } from './sharing/sharing.service';
import { RecurrencesController } from './resources/recurrences.controller';
import { RecurrencesService } from './resources/recurrences.service';
import { RecurrenceClock } from './resources/recurrence-calendar';
import { InstallmentsController } from './resources/installments.controller';
import { InstallmentsService } from './resources/installments.service';
import { CreditCardsController } from './resources/credit-cards.controller';
import { CreditCardsService } from './resources/credit-cards.service';
import { TransactionsController } from './resources/transactions.controller';
import { TransactionsService } from './resources/transactions.service';
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
    DashboardController,
    SharingController,
    InvitationsController,
    IdentityController,
    AccountsController,
    CategoriesController,
    TransactionsController,
    CreditCardsController,
    InstallmentsController,
    RecurrencesController,
  ],
  providers: [
    PrismaService,
    DashboardService,
    AccountBalancesService,
    SharingService,
    AccountsService,
    CategoriesService,
    TransactionsService,
    CreditCardsService,
    InstallmentsService,
    RecurrencesService,
    RecurrenceClock,
    WriteGuard,
    JwtVerifier,
    AuthGuard,
    WorkspaceGuard,
    IdentityService,
    WorkspaceService,
  ],
})
export class AppModule {}
