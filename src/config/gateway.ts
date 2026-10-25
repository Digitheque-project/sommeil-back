import { createHmac } from 'crypto';

/**
 * Passerelle unique du CHU : tous les services appelés par le Centre de
 * Sommeil (consultation externe, prescriptions, accueil, upload,
 * notification, registre des services) passent par elle. Une seule variable
 * d'environnement, GATEWAY_URL — aucune adresse de repli dans le code
 * (changer d'hébergement ne doit demander que de changer cette variable).
 */
export function gatewayUrl(path = ''): string {
  const base = (process.env.GATEWAY_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('GATEWAY_URL non configurée');
  return `${base}${path}`;
}

/**
 * CHU de l'utilisateur, lu dans son jeton (services[].chu.id). Repli sur la
 * variable CHU_ID si elle est définie ; jamais d'identifiant écrit en dur.
 */
export function chuIdFromAuthorization(authorization?: string): string | undefined {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
      const services = Array.isArray(payload?.services) ? payload.services : [];
      const chuId = services.find((s: any) => s?.chu?.id)?.chu?.id;
      if (chuId) return String(chuId);
    } catch {
      // Jeton illisible : repli sur la configuration.
    }
  }
  return process.env.CHU_ID?.trim() || undefined;
}

/**
 * Jeton de service (rôle SERVICE) signé HS256 avec le secret commun du CHU,
 * pour les appels faits sans utilisateur à relayer.
 */
export function serviceToken(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) return '';
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ userId: 'service-sommeil', role: 'SERVICE', iat: now, exp: now + 300 });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
