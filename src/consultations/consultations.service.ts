import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';

/** Paramètre clinique tel que saisi dans l'écran de traitement. */
type ParametreClinique = { id?: number; nom: string; valeur: string; unite?: string | null };

/** Demandes non médicamenteuses attachées à une consultation. */
type NonMedicaments = {
  recommandationsNotes?: string | null;
  rdvMotif?: string | null;
  rdvNiveau?: string | null;
  rdvDate?: string | null;
  hospitalisationMotif?: string | null;
  hospitalisationService?: string | null;
  hospitalisationStatus?: 'EN_ATTENTE' | 'VALIDE' | null;
};

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  // Service consultation externe. Comme partout dans ce projet, la variable
  // d'environnement ne porte QUE la base URL : le préfixe de chemin réel des
  // contrôleurs (`consultation/api`, cf. son `setGlobalPrefix`) est ajouté
  // ici. Sans lui, chaque repli tapait une route inexistante et remontait un
  // 404 au lieu des consultations.
  private readonly CONSULTATION_EXTERNE_URL = `${(
    process.env.CONSULTATION_EXTERNE_URL || 'http://localhost:3001'
  ).replace(/\/+$/, '')}/${(process.env.CONSULTATION_EXTERNE_API_PREFIX || 'consultation/api').replace(/^\/+|\/+$/g, '')}`;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService
  ) {}

  private async getAuthToken(): Promise<string> {
    // Récupérer le token depuis l'en-tête Authorization de la requête
    // Pour l'instant, on utilise une variable d'environnement ou un token par défaut
    return process.env.CONSULTATION_EXTERNE_TOKEN || '';
  }

  private isConnectionError(error: any): boolean {
    if (error instanceof AxiosError) {
      return error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET';
    }
    return false;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Contrat de sortie
  //
  // La base locale stocke le patient à plat (`patientNom`, `patientPrenom`…)
  // et les observations dans une table liée. L'interface, elle, consomme le
  // contrat du service Consultation Externe : un objet `patient`, UNE
  // `observation` et des tableaux `parametresCliniques` /
  // `nonMedicamentPrescriptions`. Sans cette traduction, l'écran de
  // traitement affichait « Patient inconnu », perdait le diagnostic déjà
  // saisi, et l'historique clinique — qui reçoit alors un tableau d'objets
  // là où du texte est attendu — faisait planter le rendu.
  // ───────────────────────────────────────────────────────────────────────

  private parseJsonField<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }
    return value as T;
  }

  /** Observation la plus récente : c'est elle qui fait foi à l'affichage. */
  private latestObservation(row: any): any | null {
    const observations = Array.isArray(row?.observations) ? [...row.observations] : [];
    if (observations.length === 0) return null;
    observations.sort(
      (a, b) => new Date(b?.createdAt ?? 0).getTime() - new Date(a?.createdAt ?? 0).getTime(),
    );
    return observations[0];
  }

  private toApiConsultation(row: any) {
    if (!row) return row;

    const observation = this.latestObservation(row);
    const parametres = this.parseJsonField<ParametreClinique[]>(observation?.parametres, []);
    const nonMedicaments = this.parseJsonField<NonMedicaments | null>(
      observation?.nonMedicaments,
      null,
    );

    const displayName =
      [row.patientPrenom, row.patientNom].filter(Boolean).join(' ').trim() || 'Patient inconnu';

    return {
      id: row.id,
      consultationId: row.consultationId,
      date: row.date,
      heure: row.heure,
      motif: row.motif ?? '',
      statut: row.statut ?? 'EN_ATTENTE',
      typeVisite: row.typeVisite ?? 'INITIALE',
      urgence: Boolean(row.urgence),
      // `termine` reste le drapeau lu par l'interface ; les enregistrements
      // antérieurs à son introduction n'ont que `statut`.
      termine: Boolean(row.termine) || String(row.statut).toUpperCase() === 'TERMINE',
      arriveeAccueil: Boolean(row.arriveeAccueil),
      estReport: Boolean(row.estReport),
      archived: Boolean(row.archived),
      ordreControle: row.ordreControle ?? null,
      consultationParenteId: row.consultationParenteId ?? null,
      patientId: row.patientId,
      medecinId: row.medecinId ?? '',
      createdAt: row.createdAt,
      patient: {
        id: row.patientId,
        nom: row.patientNom ?? '',
        prenom: row.patientPrenom ?? '',
        displayName,
        dossier: row.patientDossier ?? '',
      },
      observation: observation
        ? {
            diagnostic: observation.diagnostic ?? '',
            diagnosticSuspicion: observation.diagnosticSuspicion ?? '',
            diagnosticRetenu: observation.diagnosticRetenu ?? observation.diagnostic ?? '',
            notes: observation.notes ?? '',
          }
        : null,
      parametresCliniques: Array.isArray(parametres) ? parametres : [],
      // Tableau (et non objet) : l'interface lit `nonMedicamentPrescriptions[0]`.
      nonMedicamentPrescriptions: nonMedicaments ? [nonMedicaments] : [],
      compteRendus: row.compteRendus ?? [],
    };
  }

  private toApiConsultations(rows: any[]) {
    return (Array.isArray(rows) ? rows : []).map((row) => this.toApiConsultation(row));
  }

  /** Entrée d'historique : texte plat, jamais la relation Prisma brute. */
  private toHistoryEntry(row: any) {
    const observation = this.latestObservation(row);
    const nonMedicaments = this.parseJsonField<NonMedicaments | null>(
      observation?.nonMedicaments,
      null,
    );

    return {
      id: row.id,
      date: row.date,
      heure: row.heure,
      statut: row.statut ?? 'EN_ATTENTE',
      typeVisite: row.typeVisite ?? 'INITIALE',
      ordreControle: row.ordreControle ?? null,
      diagnostic: observation?.diagnosticRetenu ?? observation?.diagnostic ?? '',
      observations: observation?.notes ?? '',
      nonMedicamentPrescriptions: nonMedicaments ? [nonMedicaments] : [],
    };
  }

  private readonly consultationInclude = {
    observations: true,
    compteRendus: true,
  } as const;

  async getAllConsultations(filters: any) {
    // Essayer d'abord la base de données locale
    try {
      const where: any = {};
      if (filters.date) {
        where.date = new Date(filters.date);
      }
      if (filters.dateFrom) {
        where.date = { gte: new Date(filters.dateFrom) };
      }
      if (filters.dateTo) {
        where.date = { ...where.date, lte: new Date(filters.dateTo) };
      }
      if (filters.archived !== undefined) {
        where.archived = filters.archived;
      }

      const consultations = await this.prisma.consultationLocale.findMany({
        where,
        include: this.consultationInclude,
        orderBy: { date: 'desc' },
      });

      return this.toApiConsultations(consultations);
    } catch (dbError) {
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);

      // Fallback vers API externe
      try {
        const token = await this.getAuthToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const response = await firstValueFrom(
          this.httpService.get(`${this.CONSULTATION_EXTERNE_URL}/consultations`, {
            headers,
            params: filters,
          })
        );

        return response.data;
      } catch (error) {
        const err = error as AxiosError;
        if (this.isConnectionError(error)) {
          this.logger.error(
            `Base locale et service consultation externe injoignables : ${err.message}`,
          );
          throw new ServiceUnavailableException(
            'Les consultations sont momentanément indisponibles (base locale et service externe injoignables).',
          );
        }
        this.logger.error(`Erreur lors de la récupération des consultations: ${err.message}`);
        throw error;
      }
    }
  }

  async getConsultationById(id: string) {
    // Essayer d'abord la base de données locale
    try {
      const consultation = await this.prisma.consultationLocale.findUnique({
        where: { id },
        include: this.consultationInclude,
      });

      if (consultation) {
        return this.toApiConsultation(consultation);
      }
    } catch (dbError) {
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
    }

    // Fallback vers API externe
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.get(`${this.CONSULTATION_EXTERNE_URL}/consultations/${id}`, {
          headers,
        })
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.error(
          `Base locale et service consultation externe injoignables pour la consultation ${id} : ${err.message}`,
        );
        throw new ServiceUnavailableException(
          'La consultation est momentanément indisponible (base locale et service externe injoignables).',
        );
      }
      this.logger.error(`Erreur lors de la récupération de la consultation ${id}: ${err.message}`);
      throw new NotFoundException('Consultation non trouvée');
    }
  }

  /** Consultation locale ou 404 explicite — jamais un `update` sur du vide. */
  private async requireLocalConsultation(id: string) {
    const consultation = await this.prisma.consultationLocale.findUnique({
      where: { id },
      include: this.consultationInclude,
    });
    if (!consultation) {
      throw new NotFoundException('Consultation non trouvée');
    }
    return consultation;
  }

  private cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeParametres(value: unknown): ParametreClinique[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item: any) => ({
        nom: String(item?.nom ?? '').trim(),
        valeur: String(item?.valeur ?? '').trim(),
        unite: this.cleanText(item?.unite),
      }))
      .filter((item) => item.nom.length > 0 || item.valeur.length > 0);
  }

  /**
   * Ne retient QUE les champs réellement renseignés.
   *
   * Le résultat est fusionné par-dessus ce qui est déjà consigné : une clé
   * absente de la saisie doit donc rester absente ici, sinon elle écraserait
   * par un vide une demande déjà enregistrée (contrôle, hospitalisation).
   */
  private normalizeNonMedicaments(value: any): NonMedicaments | null {
    if (!value || typeof value !== 'object') return null;

    const normalized: NonMedicaments = {};
    const fields: Array<keyof NonMedicaments> = [
      'recommandationsNotes',
      'rdvMotif',
      'rdvNiveau',
      'rdvDate',
      'hospitalisationMotif',
      'hospitalisationService',
    ];

    for (const field of fields) {
      const text = this.cleanText(value[field]);
      if (text !== null) normalized[field] = text as never;
    }

    if (value.hospitalisationStatus === 'EN_ATTENTE' || value.hospitalisationStatus === 'VALIDE') {
      normalized.hospitalisationStatus = value.hospitalisationStatus;
    }

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  /**
   * Fusionne la saisie avec l'observation la plus récente plutôt que de
   * l'écraser : un champ laissé vide lors d'un second enregistrement ne doit
   * pas effacer ce qui avait déjà été consigné.
   */
  private async upsertObservation(
    consultationId: string,
    payload: {
      diagnostic?: string | null;
      diagnosticSuspicion?: string | null;
      diagnosticRetenu?: string | null;
      notes?: string | null;
      parametres?: ParametreClinique[] | null;
      nonMedicaments?: NonMedicaments | null;
    },
  ) {
    const existing = await this.prisma.observation.findFirst({
      where: { consultationId },
      orderBy: { createdAt: 'desc' },
    });

    const data: any = {
      ...(payload.diagnostic !== undefined ? { diagnostic: payload.diagnostic } : {}),
      ...(payload.diagnosticSuspicion !== undefined
        ? { diagnosticSuspicion: payload.diagnosticSuspicion }
        : {}),
      ...(payload.diagnosticRetenu !== undefined
        ? { diagnosticRetenu: payload.diagnosticRetenu }
        : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      ...(payload.parametres !== undefined && payload.parametres !== null
        ? { parametres: payload.parametres as any }
        : {}),
      ...(payload.nonMedicaments !== undefined && payload.nonMedicaments !== null
        ? { nonMedicaments: payload.nonMedicaments as any }
        : {}),
    };

    if (existing) {
      return this.prisma.observation.update({ where: { id: existing.id }, data });
    }
    return this.prisma.observation.create({ data: { ...data, consultationId } });
  }

  /** Contenu non médicamenteux déjà consigné, pour fusion incrémentale. */
  private async currentNonMedicaments(consultationId: string): Promise<NonMedicaments> {
    const existing = await this.prisma.observation.findFirst({
      where: { consultationId },
      orderBy: { createdAt: 'desc' },
    });
    return this.parseJsonField<NonMedicaments>(existing?.nonMedicaments, {});
  }

  /**
   * Matérialise le rendez-vous de contrôle en consultation à part entière.
   *
   * C'est ce qui permet à l'interface de basculer directement sur la fiche du
   * contrôle après la finalisation : sans consultation créée, l'écran de
   * traitement n'avait aucun identifiant vers lequel naviguer.
   *
   * Une date est indispensable — un contrôle sans date n'est pas un
   * rendez-vous, il est simplement consigné dans l'observation.
   */
  private async createControleConsultation(
    parent: any,
    demande: { motif?: string | null; date?: string | null; heure?: string | null },
  ) {
    const date = this.cleanText(demande.date);
    if (!date) return null;

    const parsedDate = new Date(date.length === 10 ? `${date}T00:00:00` : date);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException('La date du rendez-vous de contrôle est invalide.');
    }

    // Un contrôle déjà créé pour cette consultation est mis à jour, pas
    // dupliqué : « Enregistrer le rendez-vous » puis « Terminer » ne doivent
    // pas produire deux contrôles.
    const existing = await this.prisma.consultationLocale.findFirst({
      where: { consultationParenteId: parent.id, archived: false },
      include: this.consultationInclude,
    });

    if (existing) {
      // Réenregistrement du même contrôle : un champ laissé vide conserve la
      // valeur déjà saisie plutôt que de retomber sur celle du parent.
      const updated = await this.prisma.consultationLocale.update({
        where: { id: existing.id },
        data: {
          date: parsedDate,
          heure: this.cleanText(demande.heure) ?? existing.heure,
          motif: this.cleanText(demande.motif) ?? existing.motif,
        },
        include: this.consultationInclude,
      });
      return this.toApiConsultation(updated);
    }

    const motif = this.cleanText(demande.motif) ?? parent.motif ?? 'Consultation de contrôle';
    const heure = this.cleanText(demande.heure) ?? parent.heure;

    const ordreControle = (parent.ordreControle ?? 0) + 1;
    const created = await this.prisma.consultationLocale.create({
      data: {
        // La consultation naît ici : elle n'a pas d'identifiant externe, on
        // en dérive un stable et unique depuis le parent.
        consultationId: `ctrl-${parent.id}-${ordreControle}`,
        date: parsedDate,
        heure,
        motif,
        statut: 'EN_ATTENTE',
        typeVisite: 'CONTROLE',
        urgence: Boolean(parent.urgence),
        patientId: parent.patientId,
        patientNom: parent.patientNom,
        patientPrenom: parent.patientPrenom,
        patientDossier: parent.patientDossier,
        medecinId: parent.medecinId,
        ordreControle,
        consultationParenteId: parent.id,
      },
      include: this.consultationInclude,
    });

    return this.toApiConsultation(created);
  }

  async finalizeConsultation(id: string, data: any) {
    const observationInput = data?.observation ?? {};
    const nonMedicaments = this.normalizeNonMedicaments(data?.nonMedicaments);
    const parametres = this.normalizeParametres(data?.parametres);

    try {
      // Dans le `try` : une consultation absente de la base locale bascule
      // sur le service externe plutôt que de remonter un 404.
      const consultation = await this.requireLocalConsultation(id);

      await this.upsertObservation(id, {
        diagnostic: this.cleanText(data?.diagnostic ?? observationInput.diagnostic),
        diagnosticSuspicion: this.cleanText(observationInput.diagnosticSuspicion),
        diagnosticRetenu: this.cleanText(
          observationInput.diagnosticRetenu ?? data?.diagnostic,
        ),
        notes: this.cleanText(data?.notes ?? observationInput.notes),
        parametres: parametres.length > 0 ? parametres : null,
        nonMedicaments: nonMedicaments
          ? { ...(await this.currentNonMedicaments(id)), ...nonMedicaments }
          : null,
      });

      const followUp = await this.createControleConsultation(consultation, {
        motif: nonMedicaments?.rdvMotif,
        date: nonMedicaments?.rdvDate,
      });

      const updated = await this.prisma.consultationLocale.update({
        where: { id },
        data: { statut: 'TERMINE', termine: true },
        include: this.consultationInclude,
      });

      return {
        success: true,
        consultation: this.toApiConsultation(updated),
        followUp,
      };
    } catch (dbError) {
      if (dbError instanceof BadRequestException) throw dbError;
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
    }

    // Fallback vers API externe
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.post(`${this.CONSULTATION_EXTERNE_URL}/consultations/${id}/finalize`, data, {
          headers,
        })
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        // Ne jamais annoncer un succès qui n'a rien enregistré : le praticien
        // croirait la consultation finalisée alors que rien n'est persisté.
        this.logger.error(
          `Base locale et service consultation externe injoignables pour la finalisation de ${id} : ${err.message}`,
        );
        throw new ServiceUnavailableException(
          "La finalisation n'a pas pu être enregistrée (base locale et service externe injoignables).",
        );
      }
      this.logger.error(`Erreur lors de la finalisation de la consultation ${id}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Traduit une action de l'interface en mise à jour locale.
   * Retourne `null` quand l'action n'a pas d'effet direct sur le statut
   * (elle est alors traitée séparément : contrôle, hospitalisation, examen).
   */
  private buildTraiterUpdate(data: any): Record<string, any> | null {
    switch (data.action) {
      case 'ouvrir':
        return { statut: 'EN_COURS' };
      case 'terminer':
        return { statut: 'TERMINE', termine: true };
      case 'annuler':
        return { statut: 'ANNULE' };
      case 'reporter':
        // Le report replace la consultation en attente à la nouvelle date.
        return {
          statut: 'EN_ATTENTE',
          termine: false,
          estReport: true,
          ...(data.nouvelleDate ? { date: new Date(data.nouvelleDate) } : {}),
          ...(data.nouvelleHeure ? { heure: data.nouvelleHeure } : {}),
        };
      case 'controle':
      case 'hospitalisation':
      case 'examen':
        return null;
      default:
        throw new BadRequestException(
          `Action inconnue : ${data.action}. Actions valides : ouvrir, annuler, terminer, controle, examen, hospitalisation, reporter.`,
        );
    }
  }

  async traiterConsultation(id: string, data: any) {
    const updateData = this.buildTraiterUpdate(data);

    // Mettre à jour dans la base de données locale
    try {
      if (updateData === null) {
        const current = await this.prisma.consultationLocale.findUnique({
          where: { id },
          include: this.consultationInclude,
        });
        if (current) {
          return this.applySideAction(current, data);
        }
      } else {
        const consultation = await this.prisma.consultationLocale.update({
          where: { id },
          data: updateData,
          include: this.consultationInclude,
        });
        return {
          success: true,
          action: data.action,
          consultation: this.toApiConsultation(consultation),
        };
      }
    } catch (dbError) {
      if (dbError instanceof BadRequestException) throw dbError;
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
    }

    // Fallback vers API externe
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.post(`${this.CONSULTATION_EXTERNE_URL}/consultations/${id}/traiter`, data, {
          headers,
        })
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.error(
          `Base locale et service consultation externe injoignables pour le traitement de ${id} : ${err.message}`,
        );
        throw new ServiceUnavailableException(
          "L'action n'a pas pu être enregistrée (base locale et service externe injoignables).",
        );
      }
      this.logger.error(`Erreur lors du traitement de la consultation ${id}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Actions qui n'entraînent pas de transition de statut mais produisent une
   * demande : contrôle, hospitalisation, examen. Elles sont persistées dans
   * l'observation — auparavant elles n'étaient tout simplement pas
   * enregistrées et le praticien perdait sa saisie au rechargement.
   */
  private async applySideAction(consultation: any, data: any) {
    const previous = await this.currentNonMedicaments(consultation.id);

    if (data.action === 'controle') {
      const merged: NonMedicaments = {
        ...previous,
        rdvMotif: this.cleanText(data.rdvMotif) ?? previous.rdvMotif ?? null,
        rdvDate: this.cleanText(data.rdvDate) ?? previous.rdvDate ?? null,
        rdvNiveau: this.cleanText(data.rdvNiveau) ?? previous.rdvNiveau ?? null,
      };
      await this.upsertObservation(consultation.id, { nonMedicaments: merged });

      const followUp = await this.createControleConsultation(consultation, {
        motif: merged.rdvMotif,
        date: merged.rdvDate,
      });

      return {
        success: true,
        action: data.action,
        consultation: this.toApiConsultation(
          await this.requireLocalConsultation(consultation.id),
        ),
        followUp,
      };
    }

    if (data.action === 'hospitalisation') {
      const motif = this.cleanText(data.hospitalisationMotif);
      if (!motif) {
        throw new BadRequestException("Le motif de l'hospitalisation est requis.");
      }
      const service = this.cleanText(data.hospitalisationService);
      // Une demande adressée à un service d'accueil attend sa réponse ; sans
      // service désigné, elle est simplement consignée au dossier.
      const hospitalisationStatus: 'EN_ATTENTE' | 'VALIDE' = service ? 'EN_ATTENTE' : 'VALIDE';

      const merged: NonMedicaments = {
        ...previous,
        hospitalisationMotif: motif,
        hospitalisationService: service,
        hospitalisationStatus,
      };
      await this.upsertObservation(consultation.id, { nonMedicaments: merged });

      return {
        success: true,
        action: data.action,
        consultation: {
          ...this.toApiConsultation(await this.requireLocalConsultation(consultation.id)),
          hospitalisationStatus,
        },
      };
    }

    // `examen` : la demande part vers le module de prescriptions
    // para-cliniques, rien à persister ici.
    return {
      success: true,
      action: data.action,
      consultation: this.toApiConsultation(consultation),
    };
  }

  async getPatientConsultationHistory(patientId: string) {
    // Essayer d'abord la base de données locale
    try {
      const consultations = await this.prisma.consultationLocale.findMany({
        where: { patientId },
        include: this.consultationInclude,
        orderBy: { date: 'desc' },
      });

      return consultations.map((consultation) => this.toHistoryEntry(consultation));
    } catch (dbError) {
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
    }

    // Fallback vers API externe
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.get(`${this.CONSULTATION_EXTERNE_URL}/consultations/patient/${patientId}/history`, {
          headers,
        })
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(`Service consultation externe non disponible, historique vide pour patient ${patientId}`);
        return [];
      }
      this.logger.error(`Erreur lors de la récupération de l'historique du patient ${patientId}: ${err.message}`);
      throw error;
    }
  }

  // Nouvelles méthodes CRUD pour la base de données locale
  async createConsultation(data: any) {
    const created = await this.prisma.consultationLocale.create({
      data: {
        consultationId: data.consultationId || data.id,
        date: new Date(data.date),
        heure: data.heure,
        motif: data.motif,
        statut: data.statut || 'EN_ATTENTE',
        typeVisite: data.typeVisite,
        urgence: data.urgence || false,
        arriveeAccueil: data.arriveeAccueil || false,
        estReport: data.estReport || false,
        patientId: data.patientId,
        patientNom: data.patient?.nom || data.patientNom,
        patientPrenom: data.patient?.prenom || data.patientPrenom,
        patientDossier: data.patient?.dossier || data.patientDossier,
        medecinId: data.medecinId,
      },
      include: this.consultationInclude,
    });

    return this.toApiConsultation(created);
  }

  async updateConsultation(id: string, data: any) {
    const updated = await this.prisma.consultationLocale.update({
      where: { id },
      data,
      include: this.consultationInclude,
    });
    return this.toApiConsultation(updated);
  }

  /**
   * L'archivage sort la consultation du fil de travail ET l'inscrit au
   * registre des archives : sans cette seconde écriture, le dossier
   * disparaissait de la liste sans jamais apparaître dans « Archives », et
   * une restauration n'avait rien à restaurer.
   */
  async archiveConsultation(id: string, archivedBy?: string) {
    const consultation = await this.requireLocalConsultation(id);

    const updated = await this.prisma.consultationLocale.update({
      where: { id },
      data: { archived: true },
      include: this.consultationInclude,
    });
    const mapped = this.toApiConsultation(updated);

    const existingArchive = await this.prisma.archive.findFirst({
      where: { type: 'CONSULTATION', referenceId: id, restored: false },
    });

    if (!existingArchive) {
      await this.prisma.archive
        .create({
          data: {
            type: 'CONSULTATION',
            referenceId: id,
            titre: `Consultation — ${mapped.patient.displayName}`,
            description: consultation.motif ?? undefined,
            donnees: mapped as any,
            archivedBy: archivedBy ?? undefined,
          },
        })
        .catch((error) =>
          this.logger.error(
            `Consultation ${id} archivée, mais l'entrée du registre n'a pas pu être créée: ${error}`,
          ),
        );
    }

    return { success: true, consultation: mapped };
  }

  async addObservation(
    consultationId: string,
    data: {
      diagnostic?: string;
      notes?: string;
      diagnosticSuspicion?: string;
      diagnosticRetenu?: string;
      parametres?: ParametreClinique[];
    },
  ) {
    await this.requireLocalConsultation(consultationId);
    const parametres = this.normalizeParametres(data.parametres);

    return this.upsertObservation(consultationId, {
      diagnostic: this.cleanText(data.diagnostic),
      diagnosticSuspicion: this.cleanText(data.diagnosticSuspicion),
      diagnosticRetenu: this.cleanText(data.diagnosticRetenu ?? data.diagnostic),
      notes: this.cleanText(data.notes),
      parametres: parametres.length > 0 ? parametres : null,
    });
  }

  async addCompteRendu(
    consultationId: string,
    data: { titre: string; contenu: string; type: string },
  ) {
    const consultation = await this.prisma.consultationLocale.findUnique({
      where: { id: consultationId },
    });

    return this.prisma.compteRendu.create({
      data: {
        consultationId,
        titre: data.titre,
        contenu: data.contenu,
        type: data.type ?? 'MEDICAL',
        patientId: consultation?.patientId,
        patientNom: consultation
          ? `${consultation.patientPrenom} ${consultation.patientNom}`.trim()
          : undefined,
      },
    });
  }

  async getCompteRendus(consultationId: string) {
    return this.prisma.compteRendu.findMany({
      where: { consultationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Consultations du jour dont le patient n'a pas encore été pris en charge. */
  async getWaitingConsultations() {
    try {
      const consultations = await this.prisma.consultationLocale.findMany({
        where: { statut: { in: ['EN_ATTENTE', 'EN_COURS'] }, archived: false },
        include: this.consultationInclude,
        orderBy: [{ urgence: 'desc' }, { heure: 'asc' }],
      });
      return this.toApiConsultations(consultations);
    } catch (dbError) {
      this.logger.error(`Base locale indisponible pour la file d'attente: ${dbError}`);
      throw new ServiceUnavailableException(
        "La file d'attente est momentanément indisponible (base locale injoignable).",
      );
    }
  }

  /** Consultations de contrôle (suivi d'une consultation initiale). */
  async getControlConsultations() {
    try {
      const consultations = await this.prisma.consultationLocale.findMany({
        where: { typeVisite: 'CONTROLE', archived: false },
        include: this.consultationInclude,
        orderBy: { date: 'desc' },
      });
      return this.toApiConsultations(consultations);
    } catch (dbError) {
      this.logger.error(`Base locale indisponible pour les contrôles: ${dbError}`);
      throw new ServiceUnavailableException(
        'Les consultations de contrôle sont momentanément indisponibles (base locale injoignable).',
      );
    }
  }

  /** Marque (ou annule) l'arrivée du patient à l'accueil. */
  async markArrival(
    id: string,
    payload: { arriveeAccueil?: boolean; arriveeAccueilAt?: string | null },
  ) {
    const arrived = payload.arriveeAccueil ?? true;

    try {
      const consultation = await this.prisma.consultationLocale.update({
        where: { id },
        data: { arriveeAccueil: arrived },
        include: this.consultationInclude,
      });
      return { success: true, consultation: this.toApiConsultation(consultation) };
    } catch (dbError) {
      this.logger.warn(`Base locale indisponible, relais vers l'API externe: ${dbError}`);
    }

    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await firstValueFrom(
        this.httpService.patch(
          `${this.CONSULTATION_EXTERNE_URL}/consultations/${id}/arrival`,
          payload,
          { headers },
        ),
      );
      return response.data;
    } catch (error) {
      if (this.isConnectionError(error)) {
        // Ne pas annoncer un succès sans écriture : l'accueil croirait le
        // patient enregistré alors que rien n'a été persisté.
        throw new ServiceUnavailableException(
          "L'arrivée n'a pas pu être enregistrée (base locale et service externe injoignables).",
        );
      }
      throw error;
    }
  }

  /** Note libre attachée à une consultation de contrôle. */
  async saveControlNote(id: string, note: string) {
    try {
      return await this.upsertObservation(id, { notes: note });
    } catch (dbError) {
      this.logger.error(`Base locale indisponible pour la note de contrôle: ${dbError}`);
      throw new ServiceUnavailableException(
        "La note n'a pas pu être enregistrée (base locale injoignable).",
      );
    }
  }

  async deleteConsultation(id: string) {
    await this.prisma.consultationLocale.delete({ where: { id } });
    return { success: true, id };
  }
}
