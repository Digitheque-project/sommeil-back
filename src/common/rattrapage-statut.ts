// Rattrapage des statuts envoyés au service Prescription.
//
// Chaque changement de statut est envoyé une fois, au moment où il a lieu. Si
// cet envoi échoue (service redémarré, passerelle lente…), la prescription
// restait à l'ancien statut et le prescripteur n'était jamais prévenu. Une
// tâche périodique compare donc le statut local à celui du service
// Prescription et renvoie ce qui manque. Le service Prescription ignore un
// statut identique (pas de notification en double). Même fichier dans chaque
// service qui envoie des statuts.

const norm = (s?: string | null) => (s ?? '').trim().toUpperCase();

/**
 * Statut à renvoyer, ou null si le service Prescription est à jour.
 * - `ordre` : étapes normales, de la première à la dernière ;
 * - `finaux` : statuts définitifs (résultat, refus, annulation).
 * On ne touche jamais un statut distant final, ni un statut distant plus
 * avancé que le local (il a pu être changé ailleurs).
 */
export function statutARenvoyer(
  local: string | null | undefined,
  distant: string | null | undefined,
  ordre: string[],
  finaux: string[],
): string | null {
  const l = norm(local);
  const d = norm(distant);
  if (!l || !d || l === d) return null;
  const fin = finaux.map(norm);
  if (fin.includes(d)) return null;
  if (fin.includes(l)) return l;
  const rang = ordre.map(norm);
  const rl = rang.indexOf(l);
  const rd = rang.indexOf(d);
  if (rl < 0) return null;
  return rd < 0 || rl > rd ? l : null;
}

/**
 * Espace les nouvelles tentatives après un échec (2, 4, 8… minutes, au plus
 * une heure) pour ne pas insister chaque minute sur un envoi refusé.
 * En mémoire : un redémarrage repart de zéro, ce qui est voulu.
 */
export class RattrapageStatuts {
  private readonly echecs = new Map<string, { n: number; prochain: number }>();

  peutTenter(cle: string, maintenant = Date.now()): boolean {
    const e = this.echecs.get(cle);
    return !e || e.prochain <= maintenant;
  }

  resultat(cle: string, ok: boolean, maintenant = Date.now()): void {
    if (ok) {
      this.echecs.delete(cle);
      return;
    }
    const n = (this.echecs.get(cle)?.n ?? 0) + 1;
    this.echecs.set(cle, { n, prochain: maintenant + Math.min(2 ** n, 60) * 60_000 });
  }
}
