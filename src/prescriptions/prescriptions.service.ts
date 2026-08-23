import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { PlanningService } from '../planning/planning.service';

/** Code couleur d'urgence de l'hôpital : NORMALE, URGENTE, TRES_URGENTE. */
export type PrioriteRdv = 'NORMALE' | 'URGENTE' | 'TRES_URGENTE';

export type PolysomnographieItem = {
  id: string;
  patientId: string;
  patientNom: string;
  patientPrenom: string;
  motif: string;
  statut: string;
  urgence: boolean;
  /** Niveau d'urgence détaillé, aligné sur les priorités du planning. */
  priorite: PrioriteRdv;
  createdAt: string;
  rdvDate?: string | null;
  rdvHeure?: string | null;
};

/**
 * Le service prescriptions exprime l'urgence en NORMAL | URGENT | TRES_URGENT.
 * `Boolean(raw.urgence)` marquait donc TOUTES les prescriptions comme urgentes
 * — « NORMAL » est une chaîne non vide, donc vraie.
 */
function lirePriorite(brut: unknown): PrioriteRdv {
  if (typeof brut === 'boolean') return brut ? 'URGENTE' : 'NORMALE';

  const valeur = String(brut ?? '')
    .trim()
    .toUpperCase();
  if (valeur.startsWith('TRES_URGENT') || valeur === 'TRES_URGENTE') {
    return 'TRES_URGENTE';
  }
  if (valeur.startsWith('URGENT')) return 'URGENTE';
  return 'NORMALE';
}

@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  // URL de base du service prescriptions (sans préfixe ni suffixe) - à configurer via variables d'environnement.
  private readonly PRESCRIPTIONS_URL = process.env.PRESCRIPTIONS_URL || 'https://prescriptionback-production.up.railway.app';
  private readonly PRESCRIPTIONS_API_PATH = '/prescriptions/medicale';

  // Établissement du Centre de Sommeil. Sert à ne remonter que les
  // prescriptions de ce CHU, et à retrouver l'identifiant du service.
  private readonly CHU_ID =
    process.env.CHU_ID || '1e5bbbb7-fa10-4d59-8848-2d0ce96a9394';

  // Service accueil : source de vérité de l'identité patient au CHU. Base URL
  // uniquement, le préfixe de chemin (/accueil/patients) est ajouté par le code.
  private readonly ACCUEIL_URL =
    process.env.ACCUEIL_URL || 'https://acceuil-back.onrender.com';

  // Identifiant du service Centre de Sommeil dans l'annuaire du CHU.
  // Laissé vide, il est résolu à la volée par nom via GET /services?chuId=.
  private readonly SLEEP_SERVICE_ID = process.env.SLEEP_SERVICE_ID?.trim() || '';
  private readonly SLEEP_SERVICE_NAME =
    process.env.SLEEP_SERVICE_NAME?.trim() || 'sommeil';

  /** Identifiant résolu, mémorisé pour la durée de vie du processus. */
  private resolvedSleepServiceId: string | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly planningService: PlanningService,
  ) {}

  /**
   * Le service prescriptions et l'annuaire exigent un jeton porteur : on
   * relaie celui de l'appelant, tel qu'il arrive sur sommeil-back.
   */
  private authHeaders(authorization?: string): Record<string, string> {
    if (!authorization) return {};
    const value = authorization.toLowerCase().startsWith('bearer ')
      ? authorization
      : `Bearer ${authorization}`;
    return { Authorization: value };
  }

  /**
   * Identifiant du service Centre de Sommeil dans l'annuaire du CHU.
   *
   * Le service prescriptions expose l'annuaire sur `GET /services?chuId=` et
   * renvoie `{ serviceId, name, type, isActive, chuId }`. On y cherche le
   * service dont le nom contient `SLEEP_SERVICE_NAME` ; `SLEEP_SERVICE_ID`
   * court-circuite entièrement cette résolution.
   *
   * Renvoie `null` si l'annuaire est injoignable ou si aucun service ne
   * correspond : l'appelant retombe alors sur un filtrage par CHU seul,
   * plutôt que de n'afficher aucune prescription.
   */
  private async resolveSleepServiceId(
    authorization?: string,
  ): Promise<string | null> {
    if (this.SLEEP_SERVICE_ID) return this.SLEEP_SERVICE_ID;
    if (this.resolvedSleepServiceId) return this.resolvedSleepServiceId;

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.PRESCRIPTIONS_URL}/services`, {
          params: { chuId: this.CHU_ID },
          headers: this.authHeaders(authorization),
          timeout: 8000,
        }),
      );

      const services = Array.isArray(response.data) ? response.data : [];
      const needle = this.SLEEP_SERVICE_NAME.toLowerCase();
      const match = services.find((service: any) =>
        String(service?.name ?? service?.nom ?? '')
          .toLowerCase()
          .includes(needle),
      );

      const id = match?.serviceId ?? match?.id;
      if (!id) {
        this.logger.warn(
          `Aucun service correspondant à « ${this.SLEEP_SERVICE_NAME} » dans l'annuaire du CHU ${this.CHU_ID} ` +
            `(${services.length} service(s) listé(s)). Filtrage par CHU uniquement.`,
        );
        return null;
      }

      this.resolvedSleepServiceId = String(id);
      this.logger.log(
        `Service Centre de Sommeil résolu : ${this.resolvedSleepServiceId}`,
      );
      return this.resolvedSleepServiceId;
    } catch (error) {
      this.logger.warn(
        `Annuaire des services injoignable pour le CHU ${this.CHU_ID}, filtrage par CHU uniquement: ${error}`,
      );
      return null;
    }
  }

  // URL de base des prescriptions de polysomnographie reçues des services externes.
  // POLYSOMNOGRAPHIE_URL est une base URL (sans préfixe ni suffixe) ; le préfixe
  // de chemin est ajouté ici. Par défaut dérivée de PRESCRIPTIONS_URL (base URL).
  private get polysomnographieUrl(): string {
    const configured = process.env.POLYSOMNOGRAPHIE_URL;
    if (configured)
      return `${configured.replace(/\/+$/, '')}/prescriptions/polysomnographie`;
    return `${this.PRESCRIPTIONS_URL}/prescriptions/polysomnographie`;
  }
  /**
   * Un 401/403 du service prescriptions n'est pas une panne : c'est le jeton
   * relayé qui manque ou ne donne pas accès. Le distinguer évite d'afficher
   * « service indisponible » sur un simple problème de session.
   */
  private assertNotAuthFailure(error: unknown, what: string): void {
    const status = (error as AxiosError)?.response?.status;
    if (status === 401) {
      throw new UnauthorizedException(
        `Session expirée ou jeton absent : ${what} n'a pas pu être consulté.`,
      );
    }
    if (status === 403) {
      throw new ForbiddenException(
        `Droits insuffisants sur le service prescriptions : ${what}.`,
      );
    }
  }

  private isConnectionError(error: any): boolean {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      return (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        (status !== undefined && status >= 500)
      );
    }
    return false;
  }

  private get patientsUrl(): string {
    return `${this.ACCUEIL_URL.replace(/\/+$/, '')}/accueil/patients`;
  }

  /**
   * Identité des patients cités par les prescriptions.
   *
   * Le service prescriptions ne transporte que `patientId` : sans cette
   * résolution, les écrans affichaient un UUID à la place du nom, et la
   * planification recopiait ce vide dans la table locale — d'où des examens
   * PSG, comptes rendus et archives sans identité.
   *
   * Résolution par identifiant distinct plutôt que par le registre complet du
   * CHU : celui-ci grossit indéfiniment alors que le nombre de patients cités
   * par la liste reste borné. Best-effort — une fiche indisponible ne prive
   * pas les autres lignes de leur nom.
   */
  private async resolvePatientsSafely(
    patientIds: string[],
    authorization?: string,
  ): Promise<Map<string, { nom: string; prenom: string }>> {
    const uniques = [...new Set(patientIds.filter(Boolean))];

    const entries = await Promise.all(
      uniques.map(async (patientId) => {
        try {
          const response = await firstValueFrom(
            this.httpService.get(
              `${this.patientsUrl}/${encodeURIComponent(patientId)}`,
              {
                params: { chuId: this.CHU_ID },
                headers: this.authHeaders(authorization),
                timeout: 8000,
              },
            ),
          );
          const patient = response.data;
          return [
            patientId,
            { nom: patient?.nom ?? '', prenom: patient?.prenom ?? '' },
          ] as const;
        } catch (error) {
          this.logger.warn(
            `Identité du patient ${patientId} indisponible auprès du service accueil: ${error}`,
          );
          return null;
        }
      }),
    );

    return new Map(
      entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    );
  }

  private async getPlanificationsSafely(): Promise<Map<string, { rdvDate: Date; rdvHeure: string }>> {
    try {
      const planifications = await this.prisma.polysomnographiePlanification.findMany();
      return new Map(
        planifications.map((p) => [p.prescriptionId, { rdvDate: p.rdvDate, rdvHeure: p.rdvHeure }]),
      );
    } catch (dbError) {
      this.logger.warn(
        `Base de données locale indisponible, planifications ignorées: ${dbError}`,
      );
      return new Map();
    }
  }

  async getPatientPrescriptions(
    patientId: string,
    chuId?: string,
    authorization?: string,
  ) {
    try {
      const params: any = { chuId: chuId || this.CHU_ID };

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.PRESCRIPTIONS_URL}${this.PRESCRIPTIONS_API_PATH}/patient/${patientId}`,
          { params, headers: this.authHeaders(authorization), timeout: 8000 },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      this.assertNotAuthFailure(error, 'les prescriptions du patient');
      if (this.isConnectionError(error)) {
        this.logger.error(
          `Service prescriptions injoignable (${this.PRESCRIPTIONS_URL}) pour le patient ${patientId}`,
        );
        throw new ServiceUnavailableException(
          'Les prescriptions sont momentanément indisponibles (service prescriptions injoignable).',
        );
      }
      this.logger.error(
        `Erreur lors de la récupération des prescriptions du patient ${patientId}: ${err.message}`,
      );
      throw error;
    }
  }

  private normalizePolysomnographie(
    raw: any,
    scheduledPlanification?: { rdvDate: Date; rdvHeure: string },
    patient?: { nom: string; prenom: string },
  ): PolysomnographieItem {
    const id = String(raw?.id ?? raw?.prescriptionId ?? '');
    const priorite = lirePriorite(raw?.urgence);

    // `||` et non `??` : une chaîne vide doit laisser la main à la source
    // suivante, sans quoi un champ présent mais vide masquerait l'identité
    // résolue auprès du service accueil.
    return {
      id,
      patientId: String(raw?.patientId ?? ''),
      patientNom:
        patient?.nom ||
        raw?.patientNom ||
        raw?.patient?.nom ||
        raw?.patient?.lastname ||
        '',
      patientPrenom:
        patient?.prenom ||
        raw?.patientPrenom ||
        raw?.patient?.prenom ||
        raw?.patient?.firstname ||
        '',
      motif: raw?.motif ?? raw?.contexteClinique ?? raw?.observation ?? '',
      statut: scheduledPlanification ? 'PLANIFIE' : (raw?.statut ?? 'EN_ATTENTE'),
      urgence: priorite !== 'NORMALE',
      priorite,
      createdAt: raw?.createdAt ?? new Date().toISOString(),
      rdvDate: scheduledPlanification?.rdvDate.toISOString() ?? raw?.rdvDate ?? null,
      rdvHeure: scheduledPlanification?.rdvHeure ?? raw?.heure ?? raw?.rdvHeure ?? null,
    };
  }

  /**
   * Prescriptions de polysomnographie adressées au Centre de Sommeil.
   *
   * Le service prescriptions filtre sur `chuId` et `serviceIdDest` (service
   * destinataire). Sans `serviceIdDest`, la liste contiendrait aussi les
   * demandes adressées aux autres services du CHU.
   */
  async getPolysomnographiePrescriptions(authorization?: string) {
    try {
      const serviceIdDest = await this.resolveSleepServiceId(authorization);

      const response = await firstValueFrom(
        this.httpService.get(this.polysomnographieUrl, {
          params: {
            chuId: this.CHU_ID,
            ...(serviceIdDest ? { serviceIdDest } : {}),
          },
          headers: this.authHeaders(authorization),
          timeout: 8000,
        }),
      );

      const list = Array.isArray(response.data) ? response.data : [];

      // Récupérer les planifications depuis la base de données locale
      const planificationsMap = await this.getPlanificationsSafely();
      const patientsMap = await this.resolvePatientsSafely(
        list.map((item: any) => String(item?.patientId ?? '')),
        authorization,
      );

      return list.map((item: any) =>
        this.normalizePolysomnographie(
          item,
          planificationsMap.get(String(item?.id ?? item?.prescriptionId)),
          patientsMap.get(String(item?.patientId ?? '')),
        ),
      );
    } catch (error) {
      const err = error as AxiosError;
      this.assertNotAuthFailure(
        error,
        'la liste des prescriptions de polysomnographie',
      );
      if (this.isConnectionError(error)) {
        this.logger.error(
          `Service prescriptions injoignable (${this.polysomnographieUrl}) pour la liste polysomnographie`,
        );
        throw new ServiceUnavailableException(
          'Les prescriptions de polysomnographie sont momentanément indisponibles (service prescriptions injoignable).',
        );
      }
      this.logger.error(`Erreur lors de la récupération des polysomnographies: ${err.message}`);
      throw error;
    }
  }

  async schedulePolysomnographie(
    id: string,
    data: { rdvDate: string; rdvHeure?: string },
    authorization?: string,
  ) {
    if (!data?.rdvDate) {
      throw new BadRequestException('Une date de rendez-vous est requise');
    }

    const items = await this.getPolysomnographiePrescriptions(authorization);
    const target = items.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException('Prescription polysomnographie non trouvée');
    }

    // Sauvegarder dans la base de données locale
    try {
      const planification = await this.prisma.polysomnographiePlanification.upsert({
        where: { prescriptionId: id },
        update: {
          rdvDate: new Date(data.rdvDate),
          rdvHeure: data.rdvHeure ?? target.rdvHeure ?? '20:00',
          statut: 'PLANIFIE',
          // Rafraîchit l'identité : les planifications enregistrées avant la
          // résolution auprès du service accueil portent un nom vide, elles
          // se corrigent ainsi dès qu'on les replanifie.
          patientNom: target.patientNom,
          patientPrenom: target.patientPrenom,
        },
        create: {
          prescriptionId: id,
          patientId: target.patientId,
          patientNom: target.patientNom,
          patientPrenom: target.patientPrenom,
          motif: target.motif,
          rdvDate: new Date(data.rdvDate),
          rdvHeure: data.rdvHeure ?? target.rdvHeure ?? '20:00',
          statut: 'PLANIFIE',
          urgence: target.urgence,
        },
      });

      // Le planning ne lit que `RendezVousPlanning` : sans cette seconde
      // écriture, l'examen était bien enregistré mais n'apparaissait nulle
      // part dans le calendrier. Volontairement dans le même `try` — les deux
      // tables vivent dans la même base, et les deux écritures étant des
      // upsert idempotents, réessayer est sans risque.
      await this.planningService.upsertDepuisPrescription({
        prescriptionId: id,
        patientId: target.patientId,
        patientNom: target.patientNom,
        patientPrenom: target.patientPrenom,
        motif: target.motif || 'Polysomnographie',
        priorite: target.priorite,
        dateRdv: planification.rdvDate,
        heureDebut: planification.rdvHeure,
      });

      // La planification est passée en second argument : sans elle, la réponse
      // reprenait le statut d'origine (EN_ATTENTE) alors que le rendez-vous
      // vient d'être posé. `urgence: target.priorite` conserve le niveau fin
      // (un booléen écraserait TRES_URGENTE en URGENTE).
      return {
        success: true,
        ...this.normalizePolysomnographie(
          { ...target, id, urgence: target.priorite },
          { rdvDate: planification.rdvDate, rdvHeure: planification.rdvHeure },
        ),
      };
    } catch (dbError) {
      // L'ancien repli renvoyait un rendez-vous « planifié » construit en
      // mémoire alors que rien n'était persisté : le praticien voyait un RDV
      // qui disparaissait au rechargement. On remonte l'échec.
      this.logger.error(`Erreur base de données locale pour planification: ${dbError}`);
      throw new ServiceUnavailableException(
        "Le rendez-vous n'a pas pu être enregistré (base locale injoignable).",
      );
    }
  }

  async updatePrescriptionStatus(
    id: string,
    statut: string,
    actionParId?: string,
    authorization?: string,
  ) {
    try {
      const response = await firstValueFrom(
        this.httpService.put(
          `${this.PRESCRIPTIONS_URL}${this.PRESCRIPTIONS_API_PATH}/${id}/statut`,
          { statut, actionParId },
          { headers: this.authHeaders(authorization), timeout: 8000 },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      this.assertNotAuthFailure(error, 'la mise à jour du statut');
      if (this.isConnectionError(error)) {
        // Ne pas annoncer un succès sans écriture : le statut affiché
        // divergerait de celui du service prescriptions.
        this.logger.error(
          `Service prescriptions injoignable pour la mise à jour du statut de ${id}`,
        );
        throw new ServiceUnavailableException(
          "Le statut n'a pas pu être mis à jour (service prescriptions injoignable).",
        );
      }
      this.logger.error(
        `Erreur lors de la mise à jour du statut de la prescription ${id}: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Signale au service prescriptions que le résultat d'un examen
   * polysomnographie est disponible (compte rendu validé) : PATCH
   * .../polysomnographie/:id/statut avec statut=REALISEE. Distinct de
   * updatePrescriptionStatus, qui cible la route générique
   * .../medicale/:id/statut — inadaptée aux prescriptions polysomnographie.
   */
  async marquerPolysomnographieRealisee(prescriptionId: string, authorization?: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.patch(
          `${this.polysomnographieUrl}/${prescriptionId}/statut`,
          { statut: 'REALISEE' },
          { headers: this.authHeaders(authorization), timeout: 8000 },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      this.assertNotAuthFailure(error, 'la transmission du résultat au prescripteur');
      if (this.isConnectionError(error)) {
        this.logger.error(
          `Service prescriptions injoignable pour transmettre le résultat de la prescription PSG ${prescriptionId}`,
        );
        throw new ServiceUnavailableException(
          "Le résultat n'a pas pu être transmis au prescripteur (service prescriptions injoignable).",
        );
      }
      this.logger.error(
        `Erreur lors de la transmission du résultat de la prescription PSG ${prescriptionId}: ${err.message}`,
      );
      throw error;
    }
  }

  // Nouvelles méthodes CRUD pour la base de données locale
  async getAllPlanifications() {
    return this.prisma.polysomnographiePlanification.findMany({
      orderBy: { rdvDate: 'asc' },
    });
  }

  async getPlanificationById(id: string) {
    return this.prisma.polysomnographiePlanification.findUnique({
      where: { id },
    });
  }

  async deletePlanification(id: string) {
    return this.prisma.polysomnographiePlanification.delete({
      where: { id },
    });
  }

  async createArchive(data: { type: string; referenceId: string; titre: string; description?: string; donnees: any; archivedBy?: string }) {
    return this.prisma.archive.create({
      data: {
        type: data.type,
        referenceId: data.referenceId,
        titre: data.titre,
        description: data.description,
        donnees: data.donnees,
        archivedBy: data.archivedBy,
      },
    });
  }

  async getArchives(type?: string) {
    return this.prisma.archive.findMany({
      where: type ? { type } : undefined,
      orderBy: { archivedAt: 'desc' },
    });
  }
}
