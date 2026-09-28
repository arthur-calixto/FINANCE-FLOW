import { afterEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: sdk.getSession } },
}));
import { apiRequest } from './api';
afterEach(() => {
  vi.unstubAllGlobals();
});
it('envia token gerenciado pelo SDK e header de workspace', async () => {
  sdk.getSession.mockResolvedValue({
    data: { session: { access_token: 'sdk-test-placeholder' } },
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  await apiRequest('/workspaces/id', 'id');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/workspaces/id'),
    {
      headers: {
        Authorization: 'Bearer sdk-test-placeholder',
        'X-Workspace-Id': 'id',
      },
      signal: undefined,
    },
  );
});
it('sem sessão não envia requisição', async () => {
  sdk.getSession.mockResolvedValue({ data: { session: null } });
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  await expect(apiRequest('/me')).rejects.toMatchObject({ status: 401 });
  expect(f).not.toHaveBeenCalled();
});
it('propaga 403 sem expor corpo de erro ou token', async () => {
  sdk.getSession.mockResolvedValue({
    data: { session: { access_token: 'sdk-test-placeholder' } },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
  await expect(apiRequest('/workspaces/id', 'id')).rejects.toMatchObject({
    status: 403,
    message: 'Você não tem acesso a este workspace.',
  });
});
