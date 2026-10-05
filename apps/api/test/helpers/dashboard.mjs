import { monthOffset } from '../../dist/resources/card-calendar.js';
/** Dados controlados somente para banco local e identidades de teste. */
export async function dashboardScenario(call, month = '2026-10') {
  const create = (path, body) =>
    call(path, { method: 'POST', body, expected: 201 });
  const account = await create('/accounts', {
    name: 'Conta da família',
    type: 'CHECKING',
    initialBalance: '100',
  });
  const reserve = await create('/accounts', {
    name: 'Reserva',
    type: 'SAVINGS',
    initialBalance: '200',
  });
  const categories = {};
  for (const [key, name, type] of [
    ['salary', 'Trabalho', 'INCOME'],
    ['home', 'Moradia', 'EXPENSE'],
    ['food', 'Alimentação', 'EXPENSE'],
    ['transport', 'Transporte', 'EXPENSE'],
  ])
    categories[key] = await create('/categories', { name, type });
  const recurring = async (description, type, amount, categoryId, day) =>
    create('/recurrences', {
      description,
      type,
      expectedAmount: amount,
      accountId: account.id,
      categoryId,
      frequency: 'MONTHLY',
      firstDueDate: month + '-' + day,
    });
  const salary = await recurring(
    'Salário',
    'INCOME',
    '5000',
    categories.salary.id,
    '05',
  );
  const rent = await recurring(
    'Aluguel',
    'EXPENSE',
    '1500',
    categories.home.id,
    '06',
  );
  const energy = await recurring(
    'Energia',
    'EXPENSE',
    '250',
    categories.home.id,
    '15',
  );
  for (const recurrence of [salary, rent]) {
    const occurrence = recurrence.occurrences.find((t) =>
      t.dueDate.startsWith(month),
    );
    await call(`/transactions/${occurrence.id}/pay`, {
      method: 'POST',
      body: { paidAt: month + '-06T12:00:00-03:00' },
    });
  }
  const transaction = (description, type, value, categoryId, day = '20') =>
    create('/transactions', {
      description,
      type,
      expectedAmount: value,
      transactionDate: month + '-01',
      dueDate: month + '-' + day,
      accountId: account.id,
      categoryId,
    });
  const freelance = await transaction(
    'Freelance',
    'INCOME',
    '1000',
    categories.salary.id,
  );
  const fuel = await transaction(
    'Combustível',
    'EXPENSE',
    '300',
    categories.transport.id,
    '07',
  );
  await call(`/transactions/${fuel.id}/pay`, {
    method: 'POST',
    body: { paidAt: month + '-07T12:00:00-03:00' },
  });
  const card = await create('/credit-cards', {
    name: 'Cartão da família',
    creditLimit: '5000',
    closingDay: 25,
    dueDay: 10,
  });
  const purchase = await create(`/credit-cards/${card.id}/purchases`, {
    description: 'Supermercado',
    amount: '600',
    transactionDate: monthOffset(month, -1) + '-24',
    categoryId: categories.food.id,
  });
  return {
    account,
    reserve,
    categories,
    salary,
    rent,
    energy,
    freelance,
    fuel,
    card,
    purchase,
    transaction,
    create,
  };
}
export async function cleanupDashboard(db, authIds) {
  const users = await db.user.findMany({
    where: { authUserId: { in: authIds } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const workspaces = await db.workspace.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const workspaceId = { in: workspaces.map((w) => w.id) };
  for (const model of [
    'workspaceInvitation',
    'transaction',
    'recurrenceOccurrenceExclusion',
    'recurrenceRevision',
    'recurrence',
    'installmentGroup',
    'creditCardInvoice',
    'creditCard',
    'transfer',
    'category',
    'account',
    'workspaceMember',
  ])
    await db[model].deleteMany({ where: { workspaceId } });
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}
