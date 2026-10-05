import type { DashboardResponse } from '@finance-flow/types';
import { brazilToday, shiftMonth } from '../src/dates';
export function dashboardFixture(
  month = brazilToday().slice(0, 7),
): DashboardResponse {
  const summary = {
    income: { planned: '6000.00', actual: '5000.00', pending: '1000.00' },
    expense: { planned: '2650.00', actual: '1800.00', pending: '850.00' },
    result: { planned: '3350.00', actual: '3200.00', pending: '150.00' },
  };
  return {
    month,
    hasActivity: true,
    transactionCount: 6,
    summary,
    accounts: {
      totalBalance: '3500.00',
      items: [
        {
          id: 'account',
          name: 'Conta da família',
          type: 'CHECKING',
          initialBalance: '100.00',
          balance: '3300.00',
        },
      ],
    },
    upcoming: [
      {
        id: 'purchase',
        description: 'Supermercado',
        type: 'EXPENSE',
        dueDate: month + '-10',
        amount: '600.00',
        origin: 'CREDIT_CARD',
        status: 'PENDING',
        creditCardId: 'card',
        invoiceId: 'invoice',
      },
    ],
    expensesByCategory: [
      { id: 'home', name: 'Moradia', amount: '1750.00', percentage: '66.0' },
      { id: 'food', name: 'Alimentação', amount: '600.00', percentage: '22.6' },
      {
        id: 'transport',
        name: 'Transporte',
        amount: '300.00',
        percentage: '11.3',
      },
    ],
    expenseComposition: {
      recurring: '1750.00',
      creditCards: '600.00',
      other: '300.00',
      total: '2650.00',
      percentages: { recurring: '66.0', creditCards: '22.6', other: '11.3' },
    },
    creditCards: [
      {
        id: 'card',
        workspaceId: 'family',
        name: 'Cartão da família',
        creditLimit: '5000.00',
        usedLimit: '600.00',
        availableLimit: '4400.00',
        usagePercentage: '12.0',
        closingDay: 25,
        dueDay: 10,
        isActive: true,
        currentInvoice: {
          id: 'invoice',
          workspaceId: 'family',
          creditCardId: 'card',
          referenceMonth: month + '-01',
          closingDate: shiftMonth(month, -1) + '-25',
          dueDate: month + '-10',
          status: 'OPEN',
          total: '600.00',
          purchaseCount: 1,
          paidAt: null,
          paidAmount: null,
          paymentAccountId: null,
        },
      },
    ],
    evolution: Array.from({ length: 6 }, (_, i) => ({
      month: shiftMonth(month, i - 5),
      ...structuredClone(summary),
    })),
  };
}
export function emptyDashboard(
  month = brazilToday().slice(0, 7),
): DashboardResponse {
  const data = dashboardFixture(month);
  const summary = {
    income: { planned: '0.00', actual: '0.00', pending: '0.00' },
    expense: { planned: '0.00', actual: '0.00', pending: '0.00' },
    result: { planned: '0.00', actual: '0.00', pending: '0.00' },
  };
  return {
    ...data,
    hasActivity: false,
    transactionCount: 0,
    summary,
    accounts: { totalBalance: '0.00', items: [] },
    upcoming: [],
    expensesByCategory: [],
    creditCards: [],
    expenseComposition: {
      recurring: '0.00',
      creditCards: '0.00',
      other: '0.00',
      total: '0.00',
      percentages: { recurring: '0.0', creditCards: '0.0', other: '0.0' },
    },
    evolution: data.evolution.map((r) => ({ month: r.month, ...summary })),
  };
}
