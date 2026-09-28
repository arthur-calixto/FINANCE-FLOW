const summaryCards = [
  {
    id: 'balance',
    label: 'Balance',
    value: 48250,
    trend: '+8.2%',
    type: 'balance',
    icon: '💰',
  },
  {
    id: 'income',
    label: 'Income',
    value: 18450,
    trend: '+12.5%',
    type: 'income',
    icon: '📈',
  },
  {
    id: 'expense',
    label: 'Expenses',
    value: 9620,
    trend: '-3.1%',
    type: 'expense',
    icon: '📉',
  },
  {
    id: 'savings',
    label: 'Savings',
    value: 8820,
    trend: '+5.6%',
    type: 'savings',
    icon: '🏦',
  },
];

const budgetData = [
  { label: 'Housing', value: 82, type: 'rent', amount: '$2,460 / $3,000' },
  { label: 'Food', value: 68, type: 'food', amount: '$1,020 / $1,500' },
  { label: 'Transport', value: 46, type: 'transport', amount: '$460 / $1,000' },
  {
    label: 'Entertainment',
    value: 74,
    type: 'entertainment',
    amount: '$740 / $1,000',
  },
];

const chartMonthlyData = [
  { month: 'Jan', income: 7200, expense: 5300 },
  { month: 'Feb', income: 7600, expense: 4900 },
  { month: 'Mar', income: 7100, expense: 5200 },
  { month: 'Apr', income: 8200, expense: 5600 },
  { month: 'May', income: 8700, expense: 6100 },
  { month: 'Jun', income: 9400, expense: 6500 },
  { month: 'Jul', income: 9800, expense: 6800 },
  { month: 'Aug', income: 10100, expense: 7200 },
  { month: 'Sep', income: 10950, expense: 7400 },
];

const transactions = [
  { title: 'Salary deposit', type: 'income', date: '2026-09-19', amount: 4200 },
  { title: 'Office rent', type: 'expense', date: '2026-09-18', amount: 1450 },
  { title: 'Groceries', type: 'expense', date: '2026-09-16', amount: 208.4 },
  {
    title: 'Design retainer',
    type: 'income',
    date: '2026-09-12',
    amount: 1200,
  },
  { title: 'Travel', type: 'expense', date: '2026-09-10', amount: 530 },
  { title: 'Freelance work', type: 'income', date: '2026-09-08', amount: 860 },
];

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function renderStats() {
  const container = document.getElementById('statsGrid');

  container.innerHTML = summaryCards
    .map(
      (card) => `
        <article class="stat-card ${card.type}">
          <div class="stat-head">
            <div>
              <p class="label">${card.label}</p>
            </div>
            <div class="stat-icon">${card.icon}</div>
          </div>
          <h3 class="stat-value">${currency.format(card.value)}</h3>
          <p class="stat-trend ${card.trend.startsWith('-') ? 'negative' : 'positive'}">${card.trend} vs last month</p>
        </article>
      `,
    )
    .join('');
}

function renderChart() {
  const chart = document.getElementById('chartBars');

  chart.innerHTML = chartMonthlyData
    .map(
      (item) => `
        <div class="bar-col">
          <div class="bar-stack">
            <span class="bar income" style="height: ${Math.max((item.income / 11000) * 100, 18)}%"></span>
            <span class="bar expense" style="height: ${Math.max((item.expense / 11000) * 100, 18)}%"></span>
          </div>
          <span>${item.month}</span>
        </div>
      `,
    )
    .join('');
}

function renderBudgets() {
  const budgetList = document.getElementById('budgetList');

  budgetList.innerHTML = budgetData
    .map(
      (item) => `
        <div class="budget-item">
          <div class="budget-meta">
            <strong>${item.label}</strong>
            <span>${item.amount}</span>
          </div>
          <div class="budget-track">
            <span class="budget-fill ${item.type}" style="width: ${item.value}%"></span>
          </div>
        </div>
      `,
    )
    .join('');
}

function renderTransactions() {
  const tableBody = document.getElementById('transactionTableBody');

  tableBody.innerHTML = transactions
    .map(
      (txn) => `
        <tr>
          <td>${txn.title}</td>
          <td><span class="type-badge ${txn.type}">${txn.type}</span></td>
          <td>${new Date(txn.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          <td class="amount ${txn.type === 'income' ? 'positive' : 'negative'}">${txn.type === 'income' ? '+' : '-'}${currency.format(txn.amount)}</td>
        </tr>
      `,
    )
    .join('');
}

function addTransaction(event) {
  event.preventDefault();

  const name = document.getElementById('txnName').value.trim();
  const type = document.getElementById('txnType').value;
  const amount = Number(document.getElementById('txnAmount').value);

  if (!name || !amount || amount <= 0) return;

  transactions.unshift({
    title: name,
    type,
    date: new Date().toISOString(),
    amount,
  });

  renderTransactions();
  document.getElementById('transactionForm').reset();
}

document
  .getElementById('transactionForm')
  .addEventListener('submit', addTransaction);

renderStats();
renderChart();
renderBudgets();
renderTransactions();
