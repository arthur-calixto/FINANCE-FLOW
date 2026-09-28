import type { createRemoteJWKSet } from 'jose' with {
  'resolution-mode': 'import',
};
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { z } from '@finance-flow/validation';

const claimsSchema = z.object({
  sub: z.uuid(),
  email: z.email(),
  role: z.literal('authenticated'),
  is_anonymous: z.boolean().optional(),
  user_metadata: z
    .object({ name: z.string().trim().min(1).max(120).optional() })
    .passthrough()
    .optional(),
});
export interface AuthIdentity {
  authUserId: string;
  email: string;
  name: string;
}

@Injectable()
export class JwtVerifier {
  private keySet?: ReturnType<typeof createRemoteJWKSet>;
  private issuer?: string;
  async verify(token: string): Promise<AuthIdentity> {
    try {
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      if (!this.keySet) {
        const url = new URL(process.env.SUPABASE_URL ?? '');
        this.issuer = `${url.origin}/auth/v1`;
        this.keySet = createRemoteJWKSet(
          new URL(`${this.issuer}/.well-known/jwks.json`),
          { timeoutDuration: 5000 },
        );
      }
      const { payload } = await jwtVerify(token, this.keySet, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'iss', 'aud'],
      });
      const claims = claimsSchema.parse(payload);
      if (claims.is_anonymous) throw new Error('Anonymous identity');
      return {
        authUserId: claims.sub,
        email: claims.email.toLowerCase(),
        name: claims.user_metadata?.name ?? claims.email.split('@')[0],
      };
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }
  }
}
