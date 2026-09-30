-- Executado somente no PostgreSQL local; não deixa fixtures persistidas.
BEGIN;
SET LOCAL search_path TO public;
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.expect_error(command text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    IF actual_state <> expected_state THEN
      RAISE EXCEPTION 'Esperado SQLSTATE %, recebido %: %', expected_state, actual_state, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Comando deveria falhar com SQLSTATE %: %', expected_state, command;
END;
$$;

DO $$
DECLARE
  user_id uuid;
  ws uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  member_ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  accounts uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  categories uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  cards uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  invoices uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  groups uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  recurrences uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  transactions uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  extra_account uuid;
  transfer_id uuid;
  second_transaction uuid;
  revision_id uuid;
  user_email text := gen_random_uuid()::text || '@schema-test.invalid';
  i integer;
  link record;
  invalid_value text;
BEGIN
  INSERT INTO "User" (email, name, "updatedAt")
    VALUES (user_email, 'Schema test', now()) RETURNING id INTO user_id;
  IF user_id IS NULL THEN RAISE EXCEPTION 'UUID default ausente'; END IF;

  FOR i IN 1..2 LOOP
    INSERT INTO "Workspace" (id, name, type, "ownerId", "updatedAt")
      VALUES (ws[i], 'Workspace test', 'PERSONAL', user_id, now());
    INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role)
      VALUES (member_ids[i], ws[i], user_id, 'OWNER');
    INSERT INTO "Account" (id, "workspaceId", name, type, "ownerMemberId", "updatedAt")
      VALUES (accounts[i], ws[i], 'Conta', 'CHECKING', member_ids[i], now());
    INSERT INTO "Category" (id, "workspaceId", name, type, "updatedAt")
      VALUES (categories[i], ws[i], 'Categoria', 'EXPENSE', now());
    INSERT INTO "CreditCard" (id, "workspaceId", name, "creditLimit", "closingDay", "dueDay", "ownerMemberId", "paymentAccountId", "updatedAt")
      VALUES (cards[i], ws[i], 'Cartão', 1000.00, 25, 10, member_ids[i], accounts[i], now());
    INSERT INTO "CreditCardInvoice" (id, "workspaceId", "creditCardId", "referenceMonth", "closingDate", "dueDate", "updatedAt")
      VALUES (invoices[i], ws[i], cards[i], CASE WHEN i = 1 THEN DATE '2026-10-01' ELSE DATE '2026-11-01' END, '2026-09-25', '2026-10-10', now());
    INSERT INTO "InstallmentGroup" (id, "workspaceId", description, "totalAmount", "installmentCount", "purchaseDate", "categoryId", "accountId", "creditCardId", "createdBy", "updatedAt")
      VALUES (groups[i], ws[i], 'Grupo', 100, 3, '2026-09-28', categories[i], accounts[i], cards[i], user_id, now());
    INSERT INTO "Recurrence" (id, "workspaceId", description, type, "expectedAmount", frequency, "dueDay", "startDate", "nextGenerationDate", "categoryId", "accountId", "createdBy", "updatedAt")
      VALUES (recurrences[i], ws[i], 'Recorrência', 'EXPENSE', 150, 'MONTHLY', 10, '2026-10-01', '2026-10-01', categories[i], accounts[i], user_id, now());
    INSERT INTO "Transaction" (id, "workspaceId", description, type, "expectedAmount", "transactionDate", "competenceDate", "dueDate", "accountId", "categoryId", "creditCardId", "invoiceId", "ownerMemberId", "createdBy", "updatedAt")
      VALUES (transactions[i], ws[i], 'Energia', 'EXPENSE', 150, '2026-09-28', '2026-10-01', '2026-10-10', accounts[i], categories[i], cards[i], invoices[i], member_ids[i], user_id, now());
  END LOOP;

  -- A mesma pessoa pode participar de dois tenants, mas a associação não pode duplicar.
  PERFORM pg_temp.expect_error(format('INSERT INTO "User" (email, name, "updatedAt") VALUES (%L, ''Duplicado'', now())', user_email), '23505');
  PERFORM pg_temp.expect_error(format('INSERT INTO "WorkspaceMember" ("workspaceId", "userId", role) VALUES (%L, %L, ''MEMBER'')', ws[1], user_id), '23505');
  PERFORM pg_temp.expect_error(format('INSERT INTO "CreditCardInvoice" ("workspaceId", "creditCardId", "referenceMonth", "closingDate", "dueDate", "updatedAt") VALUES (%L, %L, ''2026-10-01'', ''2026-09-25'', ''2026-10-10'', now())', ws[1], cards[1]), '23505');

  -- Todas as relações financeiras devem rejeitar alvos de outro tenant em UPDATE.
  FOR link IN SELECT * FROM (VALUES
    ('Transaction', transactions[1], 'accountId', accounts[2]),
    ('Transaction', transactions[1], 'categoryId', categories[2]),
    ('Transaction', transactions[1], 'creditCardId', cards[2]),
    ('Transaction', transactions[1], 'invoiceId', invoices[2]),
    ('Transaction', transactions[1], 'installmentGroupId', groups[2]),
    ('Transaction', transactions[1], 'recurrenceId', recurrences[2]),
    ('Transaction', transactions[1], 'ownerMemberId', member_ids[2]),
    ('Account', accounts[1], 'ownerMemberId', member_ids[2]),
    ('Category', categories[1], 'parentId', categories[2]),
    ('CreditCard', cards[1], 'ownerMemberId', member_ids[2]),
    ('CreditCard', cards[1], 'paymentAccountId', accounts[2]),
    ('CreditCardInvoice', invoices[1], 'creditCardId', cards[2]),
    ('InstallmentGroup', groups[1], 'accountId', accounts[2]),
    ('InstallmentGroup', groups[1], 'categoryId', categories[2]),
    ('InstallmentGroup', groups[1], 'creditCardId', cards[2]),
    ('Recurrence', recurrences[1], 'accountId', accounts[2]),
    ('Recurrence', recurrences[1], 'categoryId', categories[2])
  ) AS links(table_name, row_id, column_name, target_id)
  LOOP
    PERFORM pg_temp.expect_error(format('UPDATE %I SET %I = %L WHERE id = %L', link.table_name, link.column_name, link.target_id, link.row_id), '23503');
  END LOOP;

  -- INSERT também deve rejeitar transferência entre tenants.
  PERFORM pg_temp.expect_error(format('INSERT INTO "Transfer" ("workspaceId", "sourceAccountId", "destinationAccountId", amount, "transferDate", "createdBy", "updatedAt") VALUES (%L, %L, %L, 10, ''2026-10-10'', %L, now())', ws[1], accounts[1], accounts[2], user_id), '23503');
  INSERT INTO "Account" ("workspaceId", name, type, "updatedAt")
    VALUES (ws[1], 'Dinheiro', 'CASH', now()) RETURNING id INTO extra_account;
  INSERT INTO "Transfer" ("workspaceId", "sourceAccountId", "destinationAccountId", amount, "transferDate", "createdBy", "updatedAt")
    VALUES (ws[1], accounts[1], extra_account, 10.25, '2026-10-10', user_id, now()) RETURNING id INTO transfer_id;
  PERFORM pg_temp.expect_error(format('UPDATE "Transfer" SET "sourceAccountId" = %L WHERE id = %L', accounts[2], transfer_id), '23503');
  PERFORM pg_temp.expect_error(format('UPDATE "Transfer" SET "destinationAccountId" = %L WHERE id = %L', accounts[2], transfer_id), '23503');

  -- Previsão pode existir sem valor efetivo e sem vínculos opcionais.
  IF NOT EXISTS (SELECT FROM "Transaction" WHERE id = transactions[1] AND "expectedAmount" = 150 AND amount IS NULL AND status = 'PENDING' AND "paidAt" IS NULL) THEN
    RAISE EXCEPTION 'Estado previsto inválido';
  END IF;
  UPDATE "Transaction" SET amount = 173.48, "updatedAt" = now() WHERE id = transactions[1];
  IF NOT EXISTS (SELECT FROM "Transaction" WHERE id = transactions[1] AND "expectedAmount" = 150 AND amount = 173.48 AND status = 'PENDING') THEN
    RAISE EXCEPTION 'Valor efetivo deve ser independente do previsto e do pagamento';
  END IF;
  UPDATE "Transaction" SET status = 'PAID', "paidAt" = now(), "updatedAt" = now() WHERE id = transactions[1];
  IF NOT EXISTS (SELECT FROM "Transaction" WHERE id = transactions[1] AND status = 'PAID' AND "paidAt" IS NOT NULL AND "transactionDate" = DATE '2026-09-28' AND "competenceDate" = DATE '2026-10-01' AND "dueDate" = DATE '2026-10-10') THEN
    RAISE EXCEPTION 'Datas financeiras ou pagamento incorretos';
  END IF;
  INSERT INTO "Transaction" ("workspaceId", description, type, "expectedAmount", "transactionDate", "competenceDate", "dueDate", "createdBy", "updatedAt")
    VALUES (ws[1], 'Sem vínculos', 'INCOME', 1, '2026-10-01', '2026-10-01', '2026-10-01', user_id, now()) RETURNING id INTO second_transaction;
  UPDATE "Transaction" SET "installmentGroupId" = groups[1], "installmentNumber" = 1 WHERE id = transactions[1];
  PERFORM pg_temp.expect_error(format('UPDATE "Transaction" SET "installmentGroupId" = %L, "installmentNumber" = 1 WHERE id = %L', groups[1], second_transaction), '23505');
  UPDATE "Transaction" SET "installmentGroupId" = groups[1], "installmentNumber" = 2, "recurrenceId" = recurrences[1] WHERE id = second_transaction;

  -- Fronteiras dos dias: 1 e 31 aceitos; 0 e 32 rejeitados.
  FOR link IN SELECT * FROM (VALUES
    ('CreditCard', cards[1], 'closingDay'),
    ('CreditCard', cards[1], 'dueDay'),
    ('Recurrence', recurrences[1], 'dueDay')
  ) AS limits(table_name, row_id, column_name)
  LOOP
    FOREACH i IN ARRAY ARRAY[1, 31] LOOP
      EXECUTE format('UPDATE %I SET %I = %L WHERE id = %L', link.table_name, link.column_name, i, link.row_id);
    END LOOP;
    FOREACH i IN ARRAY ARRAY[0, 32] LOOP
      PERFORM pg_temp.expect_error(format('UPDATE %I SET %I = %L WHERE id = %L', link.table_name, link.column_name, i, link.row_id), '23514');
    END LOOP;
  END LOOP;
  FOR link IN SELECT * FROM (VALUES
    ('Recurrence', recurrences[1], 'interval'),
    ('InstallmentGroup', groups[1], 'installmentCount')
  ) AS limits(table_name, row_id, column_name)
  LOOP
    EXECUTE format('UPDATE %I SET %I = 1 WHERE id = %L', link.table_name, link.column_name, link.row_id);
    FOREACH i IN ARRAY ARRAY[0, -1] LOOP
      PERFORM pg_temp.expect_error(format('UPDATE %I SET %I = %L WHERE id = %L', link.table_name, link.column_name, i, link.row_id), '23514');
    END LOOP;
  END LOOP;

  -- Todos os montantes de movimentação: menor centavo positivo aceito.
  -- Zero, negativos e NaN devem falhar mesmo via SQL direto.
  FOR link IN SELECT * FROM (VALUES
    ('Transaction', transactions[1], 'expectedAmount'),
    ('Transaction', transactions[1], 'amount'),
    ('Recurrence', recurrences[1], 'expectedAmount'),
    ('InstallmentGroup', groups[1], 'totalAmount'),
    ('Transfer', transfer_id, 'amount')
  ) AS money(table_name, row_id, column_name)
  LOOP
    EXECUTE format('UPDATE %I SET %I = 0.01 WHERE id = %L', link.table_name, link.column_name, link.row_id);
    FOREACH invalid_value IN ARRAY ARRAY['0', '-0.01', 'NaN'] LOOP
      PERFORM pg_temp.expect_error(format('UPDATE %I SET %I = %L WHERE id = %L', link.table_name, link.column_name, invalid_value, link.row_id), '23514');
    END LOOP;
  END LOOP;
  -- NULL continua permitido individualmente nos valores de Transaction.
  UPDATE "Transaction" SET "expectedAmount" = NULL WHERE id = transactions[1];
  UPDATE "Transaction" SET amount = NULL, "expectedAmount" = 150 WHERE id = transactions[2];
  PERFORM pg_temp.expect_error(format('UPDATE "Transfer" SET "destinationAccountId" = "sourceAccountId" WHERE id = %L', transfer_id), '23514');
  PERFORM pg_temp.expect_error(format('INSERT INTO "Transfer" ("workspaceId", "sourceAccountId", "destinationAccountId", amount, "transferDate", "createdBy", "updatedAt") VALUES (%L, %L, %L, 1, CURRENT_DATE, %L, now())', ws[1], accounts[1], accounts[1], user_id), '23514');
  PERFORM pg_temp.expect_error(format('UPDATE "Transfer" SET "updatedAt" = NULL WHERE id = %L', transfer_id), '23502');
  UPDATE "Transfer" SET "updatedAt" = TIMESTAMPTZ '2026-10-10 12:00:00+00' WHERE id = transfer_id;
  IF NOT EXISTS (SELECT FROM "Transfer" WHERE id = transfer_id AND "updatedAt" = TIMESTAMPTZ '2026-10-10 12:00:00+00') THEN
    RAISE EXCEPTION 'Transfer.updatedAt não foi persistido';
  END IF;
  UPDATE "Account" SET "initialBalance" = -0.01 WHERE id = extra_account;
  UPDATE "Account" SET "initialBalance" = 0 WHERE id = extra_account;

  -- Precisão NUMERIC deve preservar centavos inclusive além da precisão de Number.
  UPDATE "Account" SET "initialBalance" = 9007199254740993.01 WHERE id = extra_account;
  IF (SELECT "initialBalance" FROM "Account" WHERE id = extra_account) <> 9007199254740993.01::numeric THEN
    RAISE EXCEPTION 'Perda de precisão monetária';
  END IF;
  IF (SELECT currency FROM "Account" WHERE id = extra_account) <> 'BRL' THEN
    RAISE EXCEPTION 'Moeda padrão incorreta';
  END IF;
  PERFORM pg_temp.expect_error(format('UPDATE "Transaction" SET type = ''TRANSFER'' WHERE id = %L', transactions[1]), '22P02');
  PERFORM pg_temp.expect_error(format('DELETE FROM "Account" WHERE id = %L', accounts[1]), '23503');
  PERFORM pg_temp.expect_error(format('DELETE FROM "Workspace" WHERE id = %L', ws[1]), '23503');
  PERFORM pg_temp.expect_error(format('UPDATE "Account" SET "workspaceId" = %L WHERE id = %L', ws[2], accounts[1]), '23503');
  -- FIN-8: revisões e identidade de ocorrência têm integridade própria.
  INSERT INTO "RecurrenceRevision" ("workspaceId", "recurrenceId", "effectiveDate", description, "expectedAmount", "accountId", "categoryId", "createdBy", "updatedAt")
    VALUES (ws[1], recurrences[1], '2027-01-10', 'Reajuste', 135, accounts[1], categories[1], user_id, now()) RETURNING id INTO revision_id;
  PERFORM pg_temp.expect_error(format('UPDATE "RecurrenceRevision" SET "accountId" = %L WHERE id = %L', accounts[2], revision_id), '23503');
  PERFORM pg_temp.expect_error(format('UPDATE "RecurrenceRevision" SET "categoryId" = %L WHERE id = %L', categories[2], revision_id), '23503');
  PERFORM pg_temp.expect_error(format('UPDATE "RecurrenceRevision" SET "recurrenceId" = %L WHERE id = %L', recurrences[2], revision_id), '23503');
  PERFORM pg_temp.expect_error(format('UPDATE "RecurrenceRevision" SET "expectedAmount" = 0 WHERE id = %L', revision_id), '23514');
  PERFORM pg_temp.expect_error(format('UPDATE "RecurrenceRevision" SET "expectedAmount" = ''NaN'' WHERE id = %L', revision_id), '23514');
  UPDATE "Transaction" SET "recurrenceDate" = '2026-10-10' WHERE id = second_transaction;
  PERFORM pg_temp.expect_error(format('UPDATE "Transaction" SET "recurrenceId" = %L, "recurrenceDate" = ''2026-10-10'' WHERE id = %L', recurrences[1], transactions[1]), '23505');
  RAISE NOTICE 'OK: 12 models exercitados; isolamento, unicidade, datas, Decimal, CHECKs, Transfer.updatedAt e exclusões validados';
END;
$$;
ROLLBACK;
