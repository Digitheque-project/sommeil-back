import { createHmac } from 'crypto';
import { chuIdFromAuthorization, gatewayUrl, serviceToken } from './gateway';

function jeton(payload: object): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.signature`;
}

describe('configuration passerelle du Centre de Sommeil', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('construit les adresses sur GATEWAY_URL, sans barre finale en double', () => {
    process.env.GATEWAY_URL = 'https://gateway.example/';
    expect(gatewayUrl('/consultation/api')).toBe('https://gateway.example/consultation/api');
  });

  it('refuse de deviner une adresse quand GATEWAY_URL manque', () => {
    delete process.env.GATEWAY_URL;
    expect(() => gatewayUrl('/services')).toThrow(/GATEWAY_URL/);
  });

  it('lit le CHU dans le jeton de l’utilisateur', () => {
    process.env.CHU_ID = 'chu-config';
    const auth = `Bearer ${jeton({ services: [{ serviceName: 'Centre de Sommeil', chu: { id: 'chu-du-jeton' } }] })}`;
    expect(chuIdFromAuthorization(auth)).toBe('chu-du-jeton');
  });

  it('se replie sur CHU_ID sans jeton, et ne renvoie rien sans configuration', () => {
    process.env.CHU_ID = 'chu-config';
    expect(chuIdFromAuthorization(undefined)).toBe('chu-config');
    delete process.env.CHU_ID;
    expect(chuIdFromAuthorization('Bearer illisible')).toBeUndefined();
  });

  it('signe un jeton SERVICE vérifiable avec le secret commun', () => {
    process.env.JWT_SECRET = 'secret-de-test';
    const [head, body, sig] = serviceToken().split('.');
    const attendu = createHmac('sha256', 'secret-de-test').update(`${head}.${body}`).digest('base64url');
    expect(sig).toBe(attendu);
    expect(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))).toMatchObject({ role: 'SERVICE' });
  });
});
