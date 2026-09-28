import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
export async function signingServer() {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'test-key',
    alg: 'ES256',
  };
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    async token(id, email, options = {}) {
      return new SignJWT({
        email,
        role: 'authenticated',
        user_metadata: { name: 'Teste Auth' },
        ...options.claims,
      })
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setSubject(id)
        .setIssuedAt()
        .setExpirationTime(options.expiration ?? '5m')
        .setIssuer(options.issuer ?? `${origin}/auth/v1`)
        .setAudience(options.audience ?? 'authenticated')
        .sign(options.key ?? privateKey);
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
