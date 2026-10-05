import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { brazilToday } from '@finance-flow/types';
import type {
  CreateCreditCard,
  UpdateCreditCard,
  CreatePurchase,
  PayInvoice,
} from '@finance-flow/validation';
import {
  Prisma,
  type CreditCard,
  type CreditCardInvoice,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { databaseOperation } from './database-errors';
import { asDate, civil, purchaseCalendar } from './card-calendar';
const Money = Prisma.Decimal.clone({ precision: 40 });
@Injectable()
export class CreditCardsService {
  constructor(private readonly prisma: PrismaService) {}
  private async findCard(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    id: string,
  ) {
    const card = await tx.creditCard.findFirst({ where: { workspaceId, id } });
    if (!card) throw new NotFoundException('Cartão não encontrado.');
    return card;
  }
  async used(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    creditCardId: string,
  ) {
    const result = await tx.transaction.aggregate({
      where: {
        workspaceId,
        creditCardId,
        status: { not: 'CANCELLED' },
        invoice: { status: { not: 'PAID' } },
      },
      _sum: { amount: true },
    });
    return new Money(result._sum.amount?.toString() ?? 0);
  }
  private async invoiceView(
    tx: Prisma.TransactionClient,
    row: CreditCardInvoice,
  ) {
    const sum = await tx.transaction.aggregate({
      where: {
        workspaceId: row.workspaceId,
        creditCardId: row.creditCardId,
        invoiceId: row.id,
        status: { not: 'CANCELLED' },
      },
      _sum: { amount: true },
      _count: true,
    });
    const today = brazilToday();
    return {
      ...row,
      referenceMonth: civil(row.referenceMonth),
      closingDate: civil(row.closingDate),
      dueDate: civil(row.dueDate),
      paidAmount: row.paidAmount?.toFixed(2) ?? null,
      status:
        row.status === 'PAID'
          ? 'PAID'
          : civil(row.dueDate) < today
            ? 'OVERDUE'
            : civil(row.closingDate) <= today
              ? 'CLOSED'
              : 'OPEN',
      total: sum._sum.amount?.toFixed(2) ?? '0.00',
      purchaseCount: sum._count,
    };
  }
  private async cardView(tx: Prisma.TransactionClient, card: CreditCard) {
    const used = await this.used(tx, card.workspaceId, card.id);
    const next = await tx.creditCardInvoice.findFirst({
      where: {
        workspaceId: card.workspaceId,
        creditCardId: card.id,
        status: { not: 'PAID' },
        transactions: { some: { status: { not: 'CANCELLED' } } },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return {
      ...card,
      creditLimit: card.creditLimit.toFixed(2),
      usedLimit: used.toFixed(2),
      availableLimit: new Money(card.creditLimit.toString())
        .minus(used)
        .toFixed(2),
      currentInvoice: next ? await this.invoiceView(tx, next) : null,
    };
  }
  list(workspaceId: string, includeInactive: boolean) {
    return this.prisma.client.$transaction(
      async (tx) => {
        const rows = await tx.creditCard.findMany({
          where: {
            workspaceId,
            ...(includeInactive ? {} : { isActive: true }),
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
        const result = [];
        for (const row of rows) result.push(await this.cardView(tx, row));
        return result;
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  get(workspaceId: string, id: string) {
    return this.prisma.client.$transaction(
      async (tx) => this.cardView(tx, await this.findCard(tx, workspaceId, id)),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  create(workspaceId: string, data: CreateCreditCard) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) =>
        this.cardView(
          tx,
          await tx.creditCard.create({ data: { ...data, workspaceId } }),
        ),
      ),
    );
  }
  locked<T>(
    workspaceId: string,
    id: string,
    action: (tx: Prisma.TransactionClient, card: CreditCard) => Promise<T>,
  ) {
    return databaseOperation(() =>
      this.prisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'categories:' + workspaceId},0))::text`;
        await tx.$queryRaw`SELECT id FROM "CreditCard" WHERE id=${id}::uuid AND "workspaceId"=${workspaceId}::uuid FOR UPDATE`;
        return action(tx, await this.findCard(tx, workspaceId, id));
      }),
    );
  }
  update(workspaceId: string, id: string, data: UpdateCreditCard) {
    return this.locked(workspaceId, id, async (tx, card) => {
      if (
        data.creditLimit !== undefined &&
        new Money(data.creditLimit).lt(await this.used(tx, workspaceId, id))
      )
        throw new ConflictException(
          'O limite não pode ficar abaixo do valor utilizado.',
        );
      if (
        ((data.closingDay !== undefined &&
          data.closingDay !== card.closingDay) ||
          (data.dueDay !== undefined && data.dueDay !== card.dueDay)) &&
        (await tx.creditCardInvoice.findFirst({
          where: { workspaceId, creditCardId: id },
        }))
      )
        throw new ConflictException(
          'Dias de virada e vencimento não podem mudar após criar faturas.',
        );
      return this.cardView(
        tx,
        await tx.creditCard.update({
          where: { workspaceId_id: { workspaceId, id } },
          data,
        }),
      );
    });
  }
  async preview(workspaceId: string, id: string, transactionDate: string) {
    const card = await this.findCard(this.prisma.client, workspaceId, id);
    return purchaseCalendar(transactionDate, card.closingDay, card.dueDay);
  }
  purchase(
    workspaceId: string,
    id: string,
    createdBy: string,
    data: CreatePurchase,
  ) {
    return this.locked(workspaceId, id, async (tx, card) => {
      if (!card.isActive)
        throw new BadRequestException(
          'Ative o cartão antes de registrar compras.',
        );
      if (
        !(await tx.category.findFirst({
          where: {
            workspaceId,
            id: data.categoryId,
            type: 'EXPENSE',
            isActive: true,
          },
        }))
      )
        throw new BadRequestException(
          'Selecione uma categoria de despesa ativa deste workspace.',
        );
      const used = await this.used(tx, workspaceId, id);
      if (used.plus(data.amount).gt(card.creditLimit.toString()))
        throw new ConflictException('A compra ultrapassa o limite disponível.');
      const calendar = purchaseCalendar(
        data.transactionDate,
        card.closingDay,
        card.dueDay,
      );
      const invoice = await tx.creditCardInvoice.upsert({
        where: {
          creditCardId_referenceMonth: {
            creditCardId: id,
            referenceMonth: asDate(calendar.referenceMonth),
          },
        },
        update: {},
        create: {
          workspaceId,
          creditCardId: id,
          referenceMonth: asDate(calendar.referenceMonth),
          closingDate: asDate(calendar.closingDate),
          dueDate: asDate(calendar.dueDate),
        },
      });
      if (invoice.workspaceId !== workspaceId || invoice.creditCardId !== id)
        throw new ConflictException('Fatura incompatível.');
      if (invoice.status === 'PAID')
        throw new ConflictException(
          'Não é possível adicionar compras a uma fatura paga.',
        );
      const row = await tx.transaction.create({
        data: {
          workspaceId,
          createdBy,
          description: data.description,
          type: 'EXPENSE',
          status: 'PENDING',
          amount: data.amount,
          expectedAmount: data.amount,
          creditCardId: id,
          invoiceId: invoice.id,
          accountId: null,
          categoryId: data.categoryId,
          transactionDate: asDate(data.transactionDate),
          competenceDate: invoice.referenceMonth,
          dueDate: invoice.dueDate,
          notes: data.notes,
        },
      });
      return {
        ...row,
        amount: row.amount!.toFixed(2),
        expectedAmount: row.expectedAmount!.toFixed(2),
        transactionDate: civil(row.transactionDate),
        competenceDate: civil(row.competenceDate),
        dueDate: civil(row.dueDate),
      };
    });
  }
  invoices(workspaceId: string, id: string, month?: string) {
    return this.prisma.client.$transaction(
      async (tx) => {
        await this.findCard(tx, workspaceId, id);
        const rows = await tx.creditCardInvoice.findMany({
          where: {
            workspaceId,
            creditCardId: id,
            ...(month ? { referenceMonth: asDate(month + '-01') } : {}),
          },
          orderBy: { referenceMonth: 'desc' },
          take: 24,
        });
        const result = [];
        for (const row of rows) result.push(await this.invoiceView(tx, row));
        return result;
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async findInvoice(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    creditCardId: string,
    id: string,
  ) {
    const row = await tx.creditCardInvoice.findFirst({
      where: { workspaceId, creditCardId, id },
    });
    if (!row)
      throw new NotFoundException('Fatura não encontrada neste cartão.');
    return row;
  }
  detail(workspaceId: string, id: string, invoiceId: string) {
    return this.prisma.client.$transaction(
      async (tx) => {
        const card = await this.findCard(tx, workspaceId, id),
          invoice = await this.findInvoice(tx, workspaceId, id, invoiceId);
        const purchases = await tx.transaction.findMany({
          where: { workspaceId, creditCardId: id, invoiceId },
          include: {
            category: { select: { id: true, name: true } },
            installmentGroup: { select: { id: true, installmentCount: true } },
          },
          orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
        });
        const paymentAccount = invoice.paymentAccountId
          ? await tx.account.findFirst({
              where: { workspaceId, id: invoice.paymentAccountId },
              select: { id: true, name: true },
            })
          : null;
        return {
          ...(await this.invoiceView(tx, invoice)),
          creditCard: { id: card.id, name: card.name },
          paymentAccount,
          purchases: purchases.map((r) => ({
            ...r,
            amount: r.amount?.toFixed(2) ?? null,
            expectedAmount: r.expectedAmount?.toFixed(2) ?? null,
            transactionDate: civil(r.transactionDate),
            dueDate: civil(r.dueDate),
            competenceDate: civil(r.competenceDate),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  cancelPurchase(workspaceId: string, id: string, purchaseId: string) {
    return this.locked(workspaceId, id, async (tx) => {
      const purchase = await tx.transaction.findFirst({
        where: {
          workspaceId,
          id: purchaseId,
          creditCardId: id,
          invoiceId: { not: null },
          installmentGroupId: null,
          recurrenceId: null,
        },
      });
      if (!purchase) throw new NotFoundException('Compra não encontrada.');
      const invoice = await this.findInvoice(
        tx,
        workspaceId,
        id,
        purchase.invoiceId!,
      );
      if (invoice.status === 'PAID')
        throw new ConflictException(
          'Compras de faturas pagas não podem ser canceladas.',
        );
      await tx.transaction.update({
        where: { id: purchaseId, workspaceId },
        data: { status: 'CANCELLED' },
      });
      return { id: purchaseId, status: 'CANCELLED' };
    });
  }
  pay(workspaceId: string, id: string, invoiceId: string, data: PayInvoice) {
    return this.locked(workspaceId, id, async (tx) => {
      const invoice = await this.findInvoice(tx, workspaceId, id, invoiceId);
      if (invoice.status === 'PAID')
        throw new ConflictException('Esta fatura já foi paga.');
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${data.accountId}::uuid AND "workspaceId"=${workspaceId}::uuid FOR SHARE`;
      const account = await tx.account.findFirst({
        where: {
          workspaceId,
          id: data.accountId,
          isActive: true,
          currency: 'BRL',
        },
      });
      if (!account)
        throw new BadRequestException(
          'Selecione uma conta ativa deste workspace.',
        );
      const purchases = await tx.transaction.findMany({
        where: { workspaceId, invoiceId, status: { not: 'CANCELLED' } },
      });
      if (
        purchases.some(
          (r) =>
            r.creditCardId !== id ||
            r.amount === null ||
            r.type !== 'EXPENSE' ||
            r.accountId !== null ||
            r.status === 'PAID',
        )
      )
        throw new ConflictException('A fatura contém compras inconsistentes.');
      const total = purchases.reduce(
        (sum, r) => sum.plus(r.amount!.toString()),
        new Money(0),
      );
      if (total.lte(0))
        throw new BadRequestException('Não há valor a pagar nesta fatura.');
      if (data.amount !== undefined && !total.eq(data.amount))
        throw new BadRequestException(
          'O pagamento deve corresponder ao total integral da fatura.',
        );
      const paidAt = new Date(data.paidAt);
      await tx.transaction.updateMany({
        where: {
          workspaceId,
          creditCardId: id,
          invoiceId,
          status: { not: 'CANCELLED' },
        },
        data: { status: 'PAID', paidAt },
      });
      const result = await tx.creditCardInvoice.update({
        where: { workspaceId_id: { workspaceId, id: invoiceId } },
        data: {
          status: 'PAID',
          paidAt,
          paymentAccountId: data.accountId,
          paidAmount: total.toFixed(2),
        },
      });
      return this.invoiceView(tx, result);
    });
  }
}
