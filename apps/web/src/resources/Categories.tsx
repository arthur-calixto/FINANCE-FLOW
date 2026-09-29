import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CategoryRecord, CategoryType } from '@finance-flow/types';
import { createCategorySchema } from '@finance-flow/validation';
import { useAuth } from '../auth';
import { apiRequest } from '../api';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Select,
} from '../ui';
import { useResources } from './use-resources';
export function descendants(rows: CategoryRecord[], id: string): Set<string> {
  const found = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (row.parentId && found.has(row.parentId) && !found.has(row.id)) {
        found.add(row.id);
        changed = true;
      }
  }
  return found;
}
function CategoryForm({
  record,
  parent,
  rows,
  workspaceId,
  close,
  saved,
}: {
  record?: CategoryRecord;
  parent?: CategoryRecord;
  rows: CategoryRecord[];
  workspaceId: string;
  close: () => void;
  saved: () => void;
}) {
  const [type, setType] = useState<CategoryType>(
    record?.type ?? parent?.type ?? 'EXPENSE',
  );
  const [parentId, setParent] = useState(record?.parentId ?? parent?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const excluded = record ? descendants(rows, record.id) : new Set<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      const data = createCategorySchema.parse({
        name: values.name,
        type,
        parentId: parentId || null,
      });
      await apiRequest(
        `/categories${record ? '/' + record.id : ''}`,
        workspaceId,
        undefined,
        { method: record ? 'PATCH' : 'POST', body: data },
      );
      saved();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Confira o nome e o tipo da categoria.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        record
          ? 'Editar categoria'
          : parent
            ? 'Nova subcategoria'
            : 'Nova categoria'
      }
      busy={busy}
      onClose={close}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <FormField label="Nome">
            <Input
              name="name"
              required
              maxLength={120}
              defaultValue={record?.name}
              placeholder="Ex.: Alimentação"
              autoFocus
            />
          </FormField>
          <FormField label="Tipo">
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value as CategoryType);
                setParent('');
              }}
            >
              <option value="EXPENSE">Despesa</option>
              <option value="INCOME">Receita</option>
            </Select>
          </FormField>
          <FormField label="Categoria pai (opcional)">
            <Select
              value={parentId}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="">Sem categoria pai</option>
              {rows
                .filter((r) => r.type === type && !excluded.has(r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.isActive ? '' : ' (inativa)'}
                  </option>
                ))}
            </Select>
          </FormField>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={close}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar categoria'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function Categories() {
  const { activeWorkspaceId } = useAuth();
  return activeWorkspaceId ? (
    <CategoriesContent
      key={activeWorkspaceId}
      workspaceId={activeWorkspaceId}
    />
  ) : null;
}
function CategoriesContent({ workspaceId }: { workspaceId: string }) {
  const { me } = useAuth();
  const writable =
    me?.workspaces.find((w) => w.id === workspaceId)?.role !== 'VIEWER';
  const list = useResources<CategoryRecord>('/categories', workspaceId);
  const [inactive, setInactive] = useState(false);
  const [form, setForm] = useState<{
    record?: CategoryRecord;
    parent?: CategoryRecord;
  } | null>(null);
  const [target, setTarget] = useState<CategoryRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function changeStatus(row: CategoryRecord, active: boolean) {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/categories/${row.id}`, workspaceId, undefined, {
        method: active ? 'PATCH' : 'DELETE',
        ...(active ? { body: { isActive: true } } : {}),
      });
      setTarget(null);
      setSuccess(
        active
          ? 'Categoria reativada.'
          : 'Categoria desativada. As subcategorias não foram alteradas.',
      );
      list.reload();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível alterar a categoria.',
      );
    } finally {
      setBusy(false);
    }
  }
  const visible = new Set(
    list.rows.filter((r) => inactive || r.isActive).map((r) => r.id),
  );
  for (const row of list.rows.filter((r) => visible.has(r.id))) {
    let id = row.parentId;
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      visible.add(id);
      id = list.rows.find((r) => r.id === id)?.parentId ?? null;
    }
  }
  function tree(
    rows: CategoryRecord[],
    parentId: string | null = null,
    level = 0,
  ): React.ReactNode {
    return (
      <ul className="category-tree">
        {rows
          .filter((r) => r.parentId === parentId && visible.has(r.id))
          .map((row) => (
            <li key={row.id}>
              <div className="category-row">
                <span className="category-name">
                  <span className="category-symbol" aria-hidden="true">
                    {level ? '↳' : '⌑'}
                  </span>
                  <span>{row.name}</span>
                  <Badge active={row.isActive} />
                </span>
                {writable && (
                  <div className="category-actions">
                    <Button
                      variant="quiet"
                      aria-label={`Criar subcategoria de ${row.name}`}
                      onClick={() => setForm({ parent: row })}
                    >
                      ＋ Subcategoria
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label={`Editar ${row.name}`}
                      onClick={() => setForm({ record: row })}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="quiet"
                      disabled={busy}
                      aria-label={`${row.isActive ? 'Desativar' : 'Reativar'} ${row.name}`}
                      onClick={() => {
                        if (row.isActive) {
                          setError('');
                          setTarget(row);
                        } else void changeStatus(row, true);
                      }}
                    >
                      {row.isActive ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                )}
              </div>
              {level < rows.length && tree(rows, row.id, level + 1)}
            </li>
          ))}
      </ul>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Organização</span>
          <h1>Categorias</h1>
          <p>Uma organização que acompanha o seu jeito de viver.</p>
        </div>
        {writable && (
          <Button onClick={() => setForm({})}>＋ Nova categoria</Button>
        )}
      </div>
      <div className="list-toolbar">
        <p>Separe por assunto e detalhe com subcategorias.</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />
          Mostrar inativas
        </label>
      </div>
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      {error && !target && <ErrorState message={error} />}
      {list.loading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} retry={list.reload} />
      ) : !visible.size ? (
        <Card>
          <EmptyState
            title="Suas categorias começam por você."
            description="Crie categorias para organizar suas despesas e receitas. Nenhuma categoria é adicionada automaticamente."
            action={
              writable && (
                <Button onClick={() => setForm({})}>Nova categoria</Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="categories-grid">
          {(['EXPENSE', 'INCOME'] as const).map((type) => (
            <Card key={type}>
              <div className="section-heading">
                <span
                  className={`category-type-icon ${type.toLowerCase()}`}
                  aria-hidden="true"
                >
                  {type === 'EXPENSE' ? '↗' : '↙'}
                </span>
                <h2>{type === 'EXPENSE' ? 'Despesas' : 'Receitas'}</h2>
              </div>
              {list.rows.some((r) => r.type === type && visible.has(r.id)) ? (
                tree(list.rows.filter((r) => r.type === type))
              ) : (
                <p className="muted">Nenhuma categoria neste grupo.</p>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="page-footnote">
        Desativar uma categoria não altera suas subcategorias. Pais inativos de
        categorias ativas continuam visíveis para preservar a organização.
      </p>
      {form && (
        <CategoryForm
          {...form}
          rows={list.rows}
          workspaceId={workspaceId}
          close={() => setForm(null)}
          saved={() => {
            setForm(null);
            setSuccess('Categoria salva com sucesso.');
            list.reload();
          }}
        />
      )}
      {target && (
        <ConfirmDialog
          title={`Desativar ${target.name}?`}
          description="Somente esta categoria será desativada. As subcategorias permanecerão como estão, e o histórico será preservado."
          busy={busy}
          error={error}
          onClose={() => setTarget(null)}
          onConfirm={() => void changeStatus(target, false)}
        />
      )}
    </>
  );
}
