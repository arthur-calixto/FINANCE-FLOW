import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { brazilToday } from '@finance-flow/types';
import type {
  CreateInstallment,
  CreateCardInstallment,
  InstallmentPreviewInput,
  CardInstallmentPreviewInput,
  CancelInstallments,
} from '@finance-flow/validation';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { CreditCardsService } from './credit-cards.service';
import { databaseOperation } from './database-errors';
import { asDate, civil } from './card-calendar';
import { commonInstallmentPlan, cardInstallmentPlan } from './installment-plan';
const Money = Prisma.Decimal.clone({ precision: 40 });
@Injectable()
export class InstallmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: CreditCardsService,
  ) {}
  preview(data: InstallmentPreviewInput) {
    return commonInstallmentPlan(
      data.totalAmount,
      data.installmentCount,
      data.firstDueDate,
    );
  }
  async cardPreview(
    workspaceId: string,
    id: string,
    data: CardInstallmentPreviewInput,
  ) {
    const card = await this.cards.get(workspaceId, id);
    const plan = cardInstallmentPlan(
      data.totalAmount,
      data.installmentCount,
      data.transactionDate,
      card.closingDay,
      card.dueDay,
    );
    return {
      ...plan,
      availableBefore: card.availableLimit,
      availableAfter: new Money(card.availableLimit)
        .minus(data.totalAmount)
        .toFixed(2),
    };
  }
  private async category(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    id: string,
    type: 'INCOME' | 'EXPENSE',
  ) {
    if (
      !(await tx.category.findFirst({
        where: { workspaceId, id, type, isActive: true },
      }))
    )
      throw new BadRequestException(
        'Selecione categoria ativa e compatível deste workspace.',
      );
  }
  create(workspaceId: string, createdBy: string, data: CreateInstallment) {
    const plan = this.preview(data);
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'categories:' + workspaceId},0))::text`;
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${data.accountId}::uuid AND "workspaceId"=${workspaceId}::uuid FOR SHARE`;
        if (
          !(await tx.account.findFirst({
            where: { workspaceId, id: data.accountId, isActive: true },
          }))
        )
          throw new BadRequestException(
            'Selecione uma conta ativa deste workspace.',
          );
        await this.category(tx, workspaceId, data.categoryId, data.type);
        const group = await tx.installmentGroup.create({
          data: {
            workspaceId,
            createdBy,
            description: data.description,
            totalAmount: data.totalAmount,
            installmentCount: data.installmentCount,
            purchaseDate: asDate(data.transactionDate),
            accountId: data.accountId,
            categoryId: data.categoryId,
          },
        });
        await tx.transaction.createMany({
          data: plan.installments.map((p) => ({
            workspaceId,
            createdBy,
            description: `${data.description} ${p.installmentNumber}/${data.installmentCount}`,
            type: data.type,
            expectedAmount: p.amount,
            status: 'PENDING' as const,
            transactionDate: asDate(data.transactionDate),
            dueDate: asDate(p.dueDate),
            competenceDate: asDate(p.competenceDate),
            accountId: data.accountId,
            categoryId: data.categoryId,
            notes: data.notes,
            installmentGroupId: group.id,
            installmentNumber: p.installmentNumber,
          })),
        });
        return this.detail(tx, workspaceId, group.id);
      }),
    );
  }
  createCard(
    workspaceId: string,
    id: string,
    createdBy: string,
    data: CreateCardInstallment,
  ) {
    return this.cards.locked(workspaceId, id, async (tx, card) => {
      if (!card.isActive)
        throw new BadRequestException(
          'Ative o cartão antes de registrar compras.',
        );
      const plan = cardInstallmentPlan(
        data.totalAmount,
        data.installmentCount,
        data.transactionDate,
        card.closingDay,
        card.dueDay,
      );
      await this.category(tx, workspaceId, data.categoryId, 'EXPENSE');
      const used = await this.cards.used(tx, workspaceId, id);
      if (
        new Money(used.toString())
          .plus(data.totalAmount)
          .gt(card.creditLimit.toString())
      )
        throw new ConflictException('A compra ultrapassa o limite disponível.');
      const group = await tx.installmentGroup.create({
        data: {
          workspaceId,
          createdBy,
          description: data.description,
          totalAmount: data.totalAmount,
          installmentCount: data.installmentCount,
          purchaseDate: asDate(data.transactionDate),
          creditCardId: id,
          categoryId: data.categoryId,
        },
      });
      for (const p of plan.installments) {
        const invoice = await tx.creditCardInvoice.upsert({
          where: {
            creditCardId_referenceMonth: {
              creditCardId: id,
              referenceMonth: asDate(p.competenceDate),
            },
          },
          update: {},
          create: {
            workspaceId,
            creditCardId: id,
            referenceMonth: asDate(p.competenceDate),
            dueDate: asDate(p.dueDate),
            closingDate: asDate(p.closingDate!),
          },
        });
        if (
          invoice.workspaceId !== workspaceId ||
          invoice.creditCardId !== id ||
          invoice.status === 'PAID'
        )
          throw new ConflictException(
            'Não é possível adicionar compras a uma fatura paga.',
          );
        await tx.transaction.create({
          data: {
            workspaceId,
            createdBy,
            description: `${data.description} ${p.installmentNumber}/${data.installmentCount}`,
            type: 'EXPENSE',
            expectedAmount: p.amount,
            amount: p.amount,
            status: 'PENDING',
            transactionDate: asDate(data.transactionDate),
            dueDate: invoice.dueDate,
            competenceDate: invoice.referenceMonth,
            categoryId: data.categoryId,
            notes: data.notes,
            creditCardId: id,
            invoiceId: invoice.id,
            installmentGroupId: group.id,
            installmentNumber: p.installmentNumber,
          },
        });
      }
      return this.detail(tx, workspaceId, group.id);
    });
  }
  private async detail(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    id: string,
  ) {
    const group = await tx.installmentGroup.findFirst({
      where: { workspaceId, id },
      include: {
        account: { select: { id: true, name: true } },
        creditCard: { select: { id: true, name: true } },
        transactions: {
          orderBy: { installmentNumber: 'asc' },
          include: {
            account: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
            invoice: { select: { id: true, referenceMonth: true } },
          },
        },
      },
    });
    if (!group) throw new NotFoundException('Parcelamento não encontrado.');
    const { transactions, ...record } = group,
      today = brazilToday();
    return {
      ...record,
      totalAmount: group.totalAmount.toFixed(2),
      purchaseDate: civil(group.purchaseDate),
      type: transactions[0]?.type ?? 'EXPENSE',
      origin: group.creditCardId ? 'CREDIT_CARD' : 'ACCOUNT',
      installments: transactions.map((r) => ({
        ...r,
        expectedAmount: r.expectedAmount?.toFixed(2) ?? null,
        amount: r.amount?.toFixed(2) ?? null,
        dueDate: civil(r.dueDate),
        competenceDate: civil(r.competenceDate),
        transactionDate: civil(r.transactionDate),
        status:
          r.status === 'PENDING' || r.status === 'OVERDUE'
            ? civil(r.dueDate) < today
              ? 'OVERDUE'
              : 'PENDING'
            : r.status,
      })),
    };
  }
  get(workspaceId: string, id: string) {
    return this.prisma.client.$transaction(
      (tx) => this.detail(tx, workspaceId, id),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  cancelCommon(workspaceId: string, id: string, data: CancelInstallments) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'categories:' + workspaceId},0))::text`;
        const group = await tx.installmentGroup.findFirst({
          where: { workspaceId, id, creditCardId: null },
        });
        if (!group)
          throw new NotFoundException('Parcelamento comum não encontrado.');
        const selected = await tx.transaction.findFirst({
          where: {
            workspaceId,
            installmentGroupId: id,
            installmentNumber: data.fromInstallmentNumber,
          },
        });
        if (!selected) throw new BadRequestException('Parcela inválida.');
        if (!['PENDING', 'OVERDUE'].includes(selected.status))
          throw new ConflictException('Selecione uma parcela pendente.');
        await tx.transaction.updateMany({
          where: {
            workspaceId,
            installmentGroupId: id,
            status: { in: ['PENDING', 'OVERDUE'] },
            installmentNumber:
              data.scope === 'ONE'
                ? data.fromInstallmentNumber
                : { gte: data.fromInstallmentNumber },
          },
          data: { status: 'CANCELLED' },
        });
        return this.detail(tx, workspaceId, id);
      }),
    );
  }
  async cancelCard(workspaceId: string, id: string) {
    const group = await this.prisma.client.installmentGroup.findFirst({
      where: { workspaceId, id, creditCardId: { not: null } },
    });
    if (!group) throw new NotFoundException('Compra parcelada não encontrada.');
    return this.cards.locked(workspaceId, group.creditCardId!, async (tx) => {
      if (
        await tx.transaction.findFirst({
          where: {
            workspaceId,
            installmentGroupId: id,
            OR: [{ status: 'PAID' }, { invoice: { status: 'PAID' } }],
          },
        })
      )
        throw new ConflictException(
          'Não é possível cancelar compra parcelada com parcelas pagas.',
        );
      await tx.transaction.updateMany({
        where: {
          workspaceId,
          installmentGroupId: id,
          status: { not: 'CANCELLED' },
        },
        data: { status: 'CANCELLED' },
      });
      return this.detail(tx, workspaceId, id);
    });
  }
}
