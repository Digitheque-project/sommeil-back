import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';

export type CompteRenduPayload = {
  consultationId?: string;
  psgId?: string;
  titre?: string;
  contenu?: string;
  conclusion?: string;
  photoUrl?: string;
  type?: string;
  patientId?: string;
  patientNom?: string;
};

@Injectable()
export class ComptesRendusService {
  private readonly logger = new Logger(ComptesRendusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prescriptionsService: PrescriptionsService,
  ) {}

  /** Un compte rendu validé est verrouillé : plus aucune écriture n'est acceptée. */
  private assertModifiable(compteRendu: { statut: string }) {
    if (compteRendu.statut === 'VALIDE') {
      throw new ConflictException(
        'Ce compte rendu est validé et signé : il ne peut plus être modifié ni supprimé.',
      );
    }
  }

  async findAll(filters: {
    statut?: string;
    patientId?: string;
    consultationId?: string;
    psgId?: string;
  }) {
    const where: Record<string, any> = {};
    if (filters.statut) where.statut = filters.statut;
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.consultationId) where.consultationId = filters.consultationId;
    if (filters.psgId) where.psgId = filters.psgId;

    return this.prisma.compteRendu.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const compteRendu = await this.prisma.compteRendu.findUnique({ where: { id } });
    if (!compteRendu) throw new NotFoundException('Compte rendu non trouvé');
    return compteRendu;
  }

  async create(data: CompteRenduPayload) {
    if (!data.psgId && !data.consultationId) {
      throw new BadRequestException('psgId (ou consultationId) est requis');
    }
    if (!data.contenu?.trim()) {
      throw new BadRequestException('Le contenu du compte rendu est requis');
    }

    let patientId = data.patientId;
    let patientNom = data.patientNom;

    if (data.psgId && (!patientId || !patientNom)) {
      const exam = await this.prisma.polysomnographiePlanification.findUnique({
        where: { id: data.psgId },
      });
      if (!exam) throw new NotFoundException('Examen PSG non trouvé');
      patientId = patientId ?? exam.patientId;
      patientNom = patientNom ?? `${exam.patientPrenom} ${exam.patientNom}`.trim();
    }

    return this.prisma.compteRendu.create({
      data: {
        consultationId: data.consultationId,
        psgId: data.psgId,
        titre: data.titre?.trim() || 'Compte rendu',
        contenu: data.contenu,
        conclusion: data.conclusion?.trim() || undefined,
        photoUrl: data.photoUrl,
        type: data.type ?? 'MEDICAL',
        patientId,
        patientNom,
      },
    });
  }

  async update(id: string, data: CompteRenduPayload) {
    const existing = await this.findOne(id);
    this.assertModifiable(existing);

    return this.prisma.compteRendu.update({
      where: { id },
      data: {
        ...(data.titre !== undefined ? { titre: data.titre } : {}),
        ...(data.contenu !== undefined ? { contenu: data.contenu } : {}),
        ...(data.conclusion !== undefined ? { conclusion: data.conclusion } : {}),
        ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
      },
    });
  }

  async validate(id: string, validePar?: string, authorization?: string) {
    const existing = await this.findOne(id);
    if (existing.statut === 'VALIDE') return { ...existing, prescripteurNotifie: true };
    if (!existing.contenu?.trim()) {
      throw new BadRequestException('Un compte rendu vide ne peut pas être validé.');
    }

    const updated = await this.prisma.compteRendu.update({
      where: { id },
      data: { statut: 'VALIDE', valideLe: new Date(), validePar: validePar ?? null },
    });

    // Valider un compte rendu, c'est signer et envoyer le résultat au
    // prescripteur : le dossier n'a plus rien à faire dans le fil de travail
    // actif, il rejoint directement le registre des archives.
    await this.archiverApresValidation(updated).catch((error) =>
      this.logger.error(
        `Compte rendu ${id} validé, mais l'archivage automatique a échoué: ${error}`,
      ),
    );

    const prescripteurNotifie = await this.notifierPrescripteur(updated, authorization);

    return { ...updated, prescripteurNotifie };
  }

  /**
   * Transmet le résultat au prescripteur d'origine — uniquement pertinent
   * pour un examen polysomnographie (une consultation n'a pas de
   * prescription externe à mettre à jour). Best-effort : un échec ne doit
   * jamais annuler la signature du compte rendu, déjà actée en base ; il est
   * simplement remonté à l'appelant pour affichage.
   *
   * Deux appels distincts et complémentaires : le premier ne fait que
   * refléter le statut REALISEE dans le service prescriptions (silencieux,
   * personne n'y est notifié) ; le second avertit réellement le service
   * prescripteur via le hub de notification central. Sans lui, le
   * prescripteur ne découvre le résultat qu'en rechargeant sa liste.
   */
  private async notifierPrescripteur(
    compteRendu: { id: string; psgId: string | null },
    authorization?: string,
  ): Promise<boolean> {
    if (!compteRendu.psgId) return true;

    try {
      const exam = await this.prisma.polysomnographiePlanification.findUnique({
        where: { id: compteRendu.psgId },
      });
      if (!exam) {
        this.logger.warn(
          `Compte rendu ${compteRendu.id} validé : examen PSG ${compteRendu.psgId} introuvable, prescripteur non notifié.`,
        );
        return false;
      }

      await this.prescriptionsService.marquerPolysomnographieRealisee(
        exam.prescriptionId,
        authorization,
      );

      return await this.prescriptionsService.notifierResultatDisponible({
        serviceIdSource: exam.serviceIdSource,
        chuId: exam.chuId,
        patientId: exam.patientId,
        patientNom: `${exam.patientPrenom} ${exam.patientNom}`.trim(),
        prescriptionId: exam.prescriptionId,
        compteRenduId: compteRendu.id,
        urgence: exam.urgence,
      });
    } catch (error) {
      this.logger.error(
        `Compte rendu ${compteRendu.id} validé, mais la transmission au prescripteur a échoué: ${error}`,
      );
      return false;
    }
  }

  private async archiverApresValidation(compteRendu: {
    id: string;
    consultationId: string | null;
    patientNom: string | null;
    titre: string;
  }) {
    const archiveCompteRendu = await this.prisma.archive.findFirst({
      where: { type: 'COMPTE_RENDU', referenceId: compteRendu.id, restored: false },
    });
    if (!archiveCompteRendu) {
      await this.prisma.archive.create({
        data: {
          type: 'COMPTE_RENDU',
          referenceId: compteRendu.id,
          titre: `Compte rendu — ${compteRendu.patientNom ?? compteRendu.titre}`,
          donnees: compteRendu as any,
        },
      });
    }

    // Lien historique : un compte rendu encore rattaché à une consultation
    // (plutôt qu'à un examen PSG) en archive aussi le dossier parent.
    if (!compteRendu.consultationId) return;

    const consultation = await this.prisma.consultationLocale.findUnique({
      where: { id: compteRendu.consultationId },
    });
    if (!consultation || consultation.archived) return;

    await this.prisma.consultationLocale.update({
      where: { id: consultation.id },
      data: { archived: true },
    });

    const archiveConsultation = await this.prisma.archive.findFirst({
      where: { type: 'CONSULTATION', referenceId: consultation.id, restored: false },
    });
    if (!archiveConsultation) {
      await this.prisma.archive.create({
        data: {
          type: 'CONSULTATION',
          referenceId: consultation.id,
          titre: `Consultation — ${consultation.patientPrenom} ${consultation.patientNom}`.trim(),
          description: consultation.motif ?? undefined,
          donnees: consultation as any,
        },
      });
    }
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    this.assertModifiable(existing);

    await this.prisma.compteRendu.delete({ where: { id } });
    return { success: true, id };
  }

  /**
   * Charge utile d'export. Le rendu PDF est fait côté client (impression du
   * navigateur) : le backend fournit uniquement les données mises en forme.
   */
  async exportOne(id: string) {
    const compteRendu = await this.findOne(id);

    const consultation = compteRendu.consultationId
      ? await this.prisma.consultationLocale
          .findUnique({ where: { id: compteRendu.consultationId } })
          .catch(() => null)
      : null;

    const exam = compteRendu.psgId
      ? await this.prisma.polysomnographiePlanification
          .findUnique({ where: { id: compteRendu.psgId } })
          .catch(() => null)
      : null;

    return {
      id: compteRendu.id,
      titre: compteRendu.titre,
      contenu: compteRendu.contenu,
      conclusion: compteRendu.conclusion,
      photoUrl: compteRendu.photoUrl,
      type: compteRendu.type,
      statut: compteRendu.statut,
      valideLe: compteRendu.valideLe,
      validePar: compteRendu.validePar,
      genereLe: new Date().toISOString(),
      patient: {
        id: compteRendu.patientId ?? consultation?.patientId ?? exam?.patientId ?? null,
        nom:
          compteRendu.patientNom ??
          (consultation
            ? `${consultation.patientPrenom} ${consultation.patientNom}`.trim()
            : exam
              ? `${exam.patientPrenom} ${exam.patientNom}`.trim()
              : null),
        dossier: consultation?.patientDossier ?? null,
      },
      consultation: consultation
        ? {
            id: consultation.id,
            date: consultation.date,
            heure: consultation.heure,
            motif: consultation.motif,
          }
        : null,
      examen: exam
        ? {
            id: exam.id,
            rdvDate: exam.rdvDate,
            rdvHeure: exam.rdvHeure,
            motif: exam.motif,
            termineLe: exam.termineLe,
          }
        : null,
    };
  }
}
