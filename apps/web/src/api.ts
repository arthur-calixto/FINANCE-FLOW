import { supabase } from './supabase';
import { meSchema, workspaceSchema } from '@finance-flow/validation';
export class ApiError extends Error {
  constructor(
    public status: number,
    message?: string,
  ) {
    super(
      message ??
        (status === 401
          ? 'Sessão inválida. Entre novamente.'
          : status === 403
            ? 'Você não tem acesso a este workspace.'
            : status === 400
              ? 'Confira valores, datas e vínculos. Selecione conta e categoria válidas deste workspace e de tipo compatível.'
              : status === 404
                ? 'Registro não encontrado neste workspace.'
                : status === 409
                  ? 'Operação incompatível com o estado atual. Reabra lançamentos pagos antes de editar ou cancelar e atualize a página.'
                  : 'Não foi possível carregar seus dados. Tente novamente.'),
    );
  }
}
export async function apiRequest(
  path: string,
  workspaceId?: string,
  signal?: AbortSignal,
  options?: { method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
) {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new ApiError(401);
  const response = await fetch(
    `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}${path}`,
    {
      ...(options
        ? {
            method: options.method,
            ...(options.body !== undefined
              ? { body: JSON.stringify(options.body) }
              : {}),
          }
        : {}),
      headers: {
        ...(options?.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        Authorization: `Bearer ${data.session.access_token}`,
        ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      },
      signal,
    },
  );
  if (!response.ok) {
    if (response.status === 403 && workspaceId)
      window.dispatchEvent(new Event('ff:workspace-forbidden'));
    if (
      (path.startsWith('/workspaces') || path.startsWith('/invitations')) &&
      [400, 403, 404, 409].includes(response.status)
    ) {
      const body =
        typeof response.json === 'function'
          ? ((await response.json().catch(() => null)) as {
              message?: unknown;
            } | null)
          : null;
      const safeMessages = new Set([
        'Somente OWNER pode administrar este workspace.',
        'Somente workspaces familiares podem ser compartilhados.',
        'Você não pode convidar a si próprio.',
        'Este usuário já faz parte do workspace.',
        'Convite não encontrado.',
        'Este convite não está pendente.',
        'Convite inválido.',
        'Este convite foi enviado para outro endereço de e-mail.',
        'Este convite não está mais disponível.',
        'Membro não encontrado.',
        'Somente MEMBER pode ser removido. O OWNER deve permanecer no workspace.',
      ]);
      throw new ApiError(
        response.status,
        typeof body?.message === 'string' && safeMessages.has(body.message)
          ? body.message
          : undefined,
      );
    }

    const allowed = new Set([
      'A compra ultrapassa o limite disponível.',
      'O total deve permitir pelo menos R$ 0,01 por parcela.',
      'O valor total excede o máximo permitido.',
      'A recorrência está encerrada a partir desta ocorrência.',
      'Não é possível retomar uma recorrência encerrada.',
      'O encerramento não pode preceder o primeiro vencimento.',
      'Selecione categoria ativa e compatível deste workspace.',
      'Não é possível cancelar compra parcelada com parcelas pagas.',
      'Selecione uma parcela pendente.',
      'O limite não pode ficar abaixo do valor utilizado.',
      'Dias de virada e vencimento não podem mudar após criar faturas.',
      'Ative o cartão antes de registrar compras.',
      'Selecione uma categoria de despesa ativa deste workspace.',
      'Não é possível adicionar compras a uma fatura paga.',
      'Compras de faturas pagas não podem ser canceladas.',
      'Esta fatura já foi paga.',
      'Selecione uma conta ativa deste workspace.',
      'O pagamento deve corresponder ao total integral da fatura.',
      'Não há valor a pagar nesta fatura.',
    ]);
    let message: string | undefined;
    if (
      (path.startsWith('/credit-cards') ||
        path.startsWith('/installments') ||
        path.startsWith('/installment-groups') ||
        path.startsWith('/recurrences')) &&
      [400, 409].includes(response.status)
    ) {
      const body = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      if (typeof body?.message === 'string' && allowed.has(body.message))
        message = body.message;
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<unknown>;
}
export async function getMe(signal?: AbortSignal) {
  return meSchema.parse(await apiRequest('/me', undefined, signal));
}
export async function selectWorkspace(id: string) {
  return workspaceSchema.parse(
    await apiRequest(`/workspaces/${encodeURIComponent(id)}`, id),
  );
}
