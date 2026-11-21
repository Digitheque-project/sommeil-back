import { RattrapageStatuts, statutARenvoyer } from './rattrapage-statut';

const ORDRE = ['CREEE', 'PLANIFIEE', 'EN_COURS', 'TERMINEE'];
const FINAUX = ['TERMINEE', 'ANNULEE', 'REFUSEE'];

describe('statutARenvoyer', () => {
  it('renvoie le statut local quand le distant est en retard', () => {
    expect(statutARenvoyer('EN_COURS', 'PLANIFIEE', ORDRE, FINAUX)).toBe('EN_COURS');
    expect(statutARenvoyer('TERMINEE', 'CREEE', ORDRE, FINAUX)).toBe('TERMINEE');
    expect(statutARenvoyer('ANNULEE', 'PLANIFIEE', ORDRE, FINAUX)).toBe('ANNULEE');
  });

  it('ne fait rien si les statuts sont égaux ou le distant plus avancé', () => {
    expect(statutARenvoyer('PLANIFIEE', 'planifiee', ORDRE, FINAUX)).toBeNull();
    expect(statutARenvoyer('PLANIFIEE', 'EN_COURS', ORDRE, FINAUX)).toBeNull();
  });

  it('ne touche jamais un statut distant final', () => {
    expect(statutARenvoyer('EN_COURS', 'ANNULEE', ORDRE, FINAUX)).toBeNull();
    expect(statutARenvoyer('ANNULEE', 'TERMINEE', ORDRE, FINAUX)).toBeNull();
  });

  it('ignore un statut local inconnu ou vide', () => {
    expect(statutARenvoyer('BIZARRE', 'CREEE', ORDRE, FINAUX)).toBeNull();
    expect(statutARenvoyer('', 'CREEE', ORDRE, FINAUX)).toBeNull();
    expect(statutARenvoyer('EN_COURS', undefined, ORDRE, FINAUX)).toBeNull();
  });
});

describe('RattrapageStatuts', () => {
  it('espace les tentatives après un échec et oublie après un succès', () => {
    const r = new RattrapageStatuts();
    const t0 = 1_000_000;
    expect(r.peutTenter('a', t0)).toBe(true);
    r.resultat('a', false, t0);
    expect(r.peutTenter('a', t0 + 60_000)).toBe(false);
    expect(r.peutTenter('a', t0 + 2 * 60_000)).toBe(true);
    r.resultat('a', true, t0);
    expect(r.peutTenter('a', t0)).toBe(true);
  });
});
