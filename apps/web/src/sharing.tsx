import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  createWorkspaceSchema,
  createInvitationSchema,
  renameWorkspaceSchema,
  invitationTokenSchema,
  z,
} from '@finance-flow/validation';
import { apiRequest, ApiError } from './api';
import { useAuth } from './auth';
import { Button, Card, Dialog, FormField, Input, LoadingState } from './ui';
import { inviteAuthPath } from './invite-return';

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};
const message = (e: unknown) =>
  e instanceof z.ZodError
    ? e.issues[0].message
    : e instanceof Error
      ? e.message
      : 'Não foi possível concluir. Tente novamente.';
const date = (value: string) => new Date(value).toLocaleDateString('pt-BR');
export function WorkspaceSettings() {
  const auth = useAuth();
  const ws = auth.me?.workspaces.find((w) => w.id === auth.activeWorkspaceId);
  const id = ws?.id;
  const owner = ws?.role === 'OWNER' && ws.type === 'FAMILY';
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<
    'create' | 'rename' | 'invite' | Member | null
  >(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    Promise.all([
      apiRequest(`/workspaces/${id}/members`, id, controller.signal),
      owner
        ? apiRequest(`/workspaces/${id}/invitations`, id, controller.signal)
        : Promise.resolve([]),
    ])
      .then(([m, i]) => {
        if (!controller.signal.aborted) {
          setMembers(m as Member[]);
          setInvitations(i as Invitation[]);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(message(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [id, owner, attempt]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!ws) return <LoadingState />;
  return (
    <div className="sharing-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Seu espaço compartilhado</span>
          <h1>Configurações</h1>
          <p>Organize quem participa das finanças de {ws.name}.</p>
        </div>
        <Button onClick={() => setDialog('create')}>
          Criar workspace familiar
        </Button>
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <Button variant="quiet" onClick={() => setAttempt((n) => n + 1)}>
            Tentar novamente
          </Button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Card>
        <div className="sharing-row">
          <div>
            <h2>{ws.name}</h2>
            <p>
              {ws.type === 'PERSONAL'
                ? 'Pessoal · Somente você'
                : 'Familiar · Finanças compartilhadas'}
            </p>
          </div>
          {owner && (
            <Button variant="secondary" onClick={() => setDialog('rename')}>
              Editar nome
            </Button>
          )}
        </div>
        {ws.type === 'PERSONAL' ? (
          <p>
            Seu workspace pessoal é privado. Crie um workspace familiar para
            compartilhar as finanças, mantendo suas contas individuais.
          </p>
        ) : (
          <p>
            Todos os membros podem gerenciar as finanças deste workspace.
            Somente OWNER administra membros e convites.
          </p>
        )}
      </Card>
      <Card>
        <div className="sharing-row">
          <h2>Membros — {ws.name}</h2>
          {owner && (
            <Button onClick={() => setDialog('invite')}>Convidar membro</Button>
          )}
        </div>
        {loading ? (
          <LoadingState />
        ) : (
          <ul className="sharing-list">
            {members.map((m) => (
              <li key={m.id} className="sharing-row">
                <div>
                  <strong>{m.name}</strong>
                  <p>{m.email}</p>
                  <small>
                    {m.role} · Desde {date(m.joinedAt)}
                  </small>
                </div>
                {owner && m.role === 'MEMBER' && (
                  <Button
                    variant="danger"
                    aria-label={`Remover ${m.name}`}
                    onClick={() => setDialog(m)}
                  >
                    Remover
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {owner && (
        <Card>
          <h2>Convites pendentes</h2>
          <p>
            O link fica disponível ao gerar o convite. Copie e envie para a
            pessoa. Não enviamos e-mail automaticamente.
          </p>
          {!loading && !invitations.some((i) => i.status === 'PENDING') && (
            <p>Nenhum convite pendente.</p>
          )}
          <ul className="sharing-list">
            {invitations
              .filter((i) => i.status === 'PENDING')
              .map((i) => (
                <li className="sharing-invitation" key={i.id}>
                  <div className="sharing-row">
                    <div>
                      <strong>{i.email}</strong>
                      <p>MEMBER · Expira em {date(i.expiresAt)}</p>
                    </div>
                    <div className="sharing-actions">
                      {links[i.id] && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await navigator.clipboard.writeText(links[i.id]);
                              setNotice('Convite copiado.');
                            })
                          }
                        >
                          Copiar convite
                        </Button>
                      )}
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await apiRequest(
                              `/workspaces/${id}/invitations/${i.id}`,
                              id,
                              undefined,
                              { method: 'DELETE' },
                            );
                            setAttempt((n) => n + 1);
                            setNotice('Convite cancelado.');
                          })
                        }
                      >
                        Cancelar convite
                      </Button>
                    </div>
                  </div>
                  {links[i.id] ? (
                    <FormField label="Link do convite">
                      <Input
                        readOnly
                        value={links[i.id]}
                        onFocus={(e) => e.target.select()}
                      />
                    </FormField>
                  ) : (
                    <small>
                      Use o link salvo ao criar o convite. Se o perdeu, cancele
                      e gere outro.
                    </small>
                  )}
                </li>
              ))}
          </ul>
        </Card>
      )}
      {dialog && (
        <Dialog
          title={
            typeof dialog === 'object'
              ? `Remover ${dialog.name}?`
              : dialog === 'create'
                ? 'Criar workspace familiar'
                : dialog === 'rename'
                  ? 'Editar nome'
                  : 'Convidar membro'
          }
          busy={busy}
          onClose={() => setDialog(null)}
        >
          {error && <p role="alert">{error}</p>}
          {typeof dialog === 'object' ? (
            <>
              <p>
                O acesso será revogado. Os dados financeiros e a autoria dos
                lançamentos permanecerão no workspace.
              </p>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await apiRequest(
                      `/workspaces/${id}/members/${dialog.id}`,
                      id,
                      undefined,
                      { method: 'DELETE' },
                    );
                    setDialog(null);
                    setAttempt((n) => n + 1);
                    setNotice('Membro removido.');
                  })
                }
              >
                Confirmar remoção
              </Button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.currentTarget));
                void run(async () => {
                  if (dialog === 'create') {
                    const body = createWorkspaceSchema.parse({
                      ...data,
                      type: 'FAMILY',
                    });
                    const created = (await apiRequest(
                      '/workspaces',
                      undefined,
                      undefined,
                      { method: 'POST', body },
                    )) as { id: string };
                    await auth.refreshWorkspaces(created.id);
                  } else if (dialog === 'rename') {
                    await apiRequest(`/workspaces/${id}`, id, undefined, {
                      method: 'PATCH',
                      body: renameWorkspaceSchema.parse(data),
                    });
                    await auth.refreshWorkspaces();
                  } else {
                    const result = (await apiRequest(
                      `/workspaces/${id}/invitations`,
                      id,
                      undefined,
                      {
                        method: 'POST',
                        body: createInvitationSchema.parse(data),
                      },
                    )) as {
                      invitation: Invitation;
                      token: string | null;
                      reused: boolean;
                    };
                    if (result.token)
                      setLinks((v) => ({
                        ...v,
                        [result.invitation.id]:
                          `${window.location.origin}/invite/${result.token}`,
                      }));
                    setNotice(
                      result.reused
                        ? 'Já existe um convite pendente para este e-mail. Use o link salvo ou cancele para gerar outro.'
                        : 'Convite criado. Copie o link e envie para a pessoa.',
                    );
                    setAttempt((n) => n + 1);
                  }
                  setDialog(null);
                });
              }}
            >
              {dialog === 'invite' ? (
                <>
                  <FormField label="E-mail">
                    <Input
                      name="email"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                    />
                  </FormField>
                  <p>Função: MEMBER — acesso às finanças compartilhadas.</p>
                </>
              ) : (
                <FormField label="Nome do workspace">
                  <Input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={dialog === 'rename' ? ws.name : ''}
                  />
                </FormField>
              )}
              <div className="sharing-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Cancelar
                </Button>
                <Button disabled={busy}>
                  {busy
                    ? 'Aguarde…'
                    : dialog === 'invite'
                      ? 'Gerar convite'
                      : 'Salvar'}
                </Button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </div>
  );
}

type Preview = {
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  status: string;
  expiresAt: string;
};
export function InvitePage() {
  const { token = '' } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!invitationTokenSchema.safeParse(token).success) return;
    fetch(
      `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/invitations/${token}`,
      { signal: controller.signal, referrerPolicy: 'no-referrer' },
    )
      .then(async (r) => {
        if (!r.ok)
          throw new ApiError(r.status, 'Convite inválido ou indisponível.');
        return r.json() as Promise<Preview>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [token]);
  async function respond(accept: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = (await apiRequest(
        `/invitations/${token}/${accept ? 'accept' : 'decline'}`,
        undefined,
        undefined,
        { method: 'POST' },
      )) as { workspaceId: string };
      if (accept) {
        await auth.refreshWorkspaces(result.workspaceId);
        navigate('/app/settings', { replace: true });
      } else setDeclined(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const next = `/invite/${token}`;
  return (
    <main className="auth-page">
      <Link className="auth-brand" to="/app">
        FINANCE FLOW
      </Link>
      <Card>
        <h1>Convite para compartilhar</h1>
        {!invitationTokenSchema.safeParse(token).success ? (
          <p role="alert">Convite inválido.</p>
        ) : (
          <>
            {error && <p role="alert">{error}</p>}
            {!preview && !error && <LoadingState />}
            {preview && (
              <>
                <p>{preview.inviterName} convidou você para participar de:</p>
                <h2>{preview.workspaceName}</h2>
                {declined ? (
                  <p role="status">Convite recusado.</p>
                ) : preview.status !== 'PENDING' ? (
                  <p role="status">
                    Este convite não está mais disponível (
                    {
                      (
                        {
                          EXPIRED: 'expirado',
                          CANCELLED: 'cancelado',
                          ACCEPTED: 'aceito',
                          DECLINED: 'recusado',
                        } as Record<string, string>
                      )[preview.status]
                    }
                    ).
                  </p>
                ) : auth.loading ? (
                  <LoadingState />
                ) : auth.session ? (
                  <>
                    <p>
                      Você está conectado como {auth.user?.email}. Ao aceitar,
                      terá acesso às finanças deste workspace. Seu espaço
                      pessoal continua privado.
                    </p>
                    <div className="sharing-actions">
                      <Button
                        disabled={busy}
                        variant="secondary"
                        onClick={() => void respond(false)}
                      >
                        Recusar
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void respond(true)}
                      >
                        Aceitar convite
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>
                      Entre ou crie uma conta com o e-mail que recebeu o
                      convite. Depois, confirme sua participação.
                    </p>
                    <nav className="sharing-actions">
                      <Link to={inviteAuthPath('/login', next)}>Entrar</Link>
                      <Link to={inviteAuthPath('/register', next)}>
                        Criar conta
                      </Link>
                    </nav>
                  </>
                )}
              </>
            )}
          </>
        )}
        <p>
          <Link to="/app">Ir para meus workspaces</Link>
        </p>
      </Card>
    </main>
  );
}
