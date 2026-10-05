import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
const Money = Prisma.Decimal.clone({ precision: 40 });
/** Saldo derivado de movimentos confirmados; independente da competência selecionada. */
@Injectable()
export class AccountBalancesService {
  async current(tx: Prisma.TransactionClient, workspaceId: string) {
    const accounts = await tx.account.findMany({
      where: { workspaceId, isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const movements = await tx.transaction.groupBy({
      by: ['accountId', 'type'],
      where: {
        workspaceId,
        status: 'PAID',
        creditCardId: null,
        invoiceId: null,
        accountId: { not: null },
      },
      _sum: { amount: true },
    });
    const invoices = await tx.creditCardInvoice.groupBy({
      by: ['paymentAccountId'],
      where: { workspaceId, status: 'PAID', paymentAccountId: { not: null } },
      _sum: { paidAmount: true },
    });
    const outgoing = await tx.transfer.groupBy({
      by: ['sourceAccountId'],
      where: { workspaceId },
      _sum: { amount: true },
    });
    const incoming = await tx.transfer.groupBy({
      by: ['destinationAccountId'],
      where: { workspaceId },
      _sum: { amount: true },
    });
    const balances = new Map(
      accounts.map((a) => [a.id, new Money(a.initialBalance.toString())]),
    );
    const add = (
      id: string | null,
      amount: Prisma.Decimal | null,
      sign: number,
    ) => {
      if (id && balances.has(id))
        balances.set(
          id,
          balances
            .get(id)!
            .plus(new Money(amount?.toString() ?? '0').times(sign)),
        );
    };
    for (const row of movements)
      add(row.accountId, row._sum.amount, row.type === 'INCOME' ? 1 : -1);
    for (const row of invoices)
      add(row.paymentAccountId, row._sum.paidAmount, -1);
    for (const row of outgoing) add(row.sourceAccountId, row._sum.amount, -1);
    for (const row of incoming)
      add(row.destinationAccountId, row._sum.amount, 1);
    const items = accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      initialBalance: a.initialBalance.toFixed(2),
      balance: balances.get(a.id)!.toFixed(2),
    }));
    return {
      totalBalance: [...balances.values()]
        .reduce((sum, n) => sum.plus(n), new Money(0))
        .toFixed(2),
      items,
    };
  }
}
