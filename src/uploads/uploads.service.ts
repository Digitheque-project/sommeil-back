import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';

/**
 * Relaye les fichiers vers le service-upload mutualisé du CHU (même famille
 * que celui utilisé par pharmacie-front, cf. son intégration) : le nom exact
 * du champ retourné par cette instance n'a pas pu être vérifié en direct
 * (Swagger indisponible — "Service Suspended" au moment d'écrire ce code),
 * donc plusieurs noms plausibles sont tentés.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly UPLOAD_URL = (
    process.env.UPLOAD_URL || 'https://service-upload-u5z9.onrender.com'
  ).replace(/\/+$/, '');

  async uploadFile(
    file: Express.Multer.File,
    authorization?: string,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );

    let response: Response;
    try {
      response = await fetch(`${this.UPLOAD_URL}/files`, {
        method: 'POST',
        headers: authorization ? { Authorization: authorization } : undefined,
        body: form,
      });
    } catch (error) {
      this.logger.error(`Service upload injoignable: ${error}`);
      throw new BadGatewayException('Service de fichiers injoignable.');
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(`Échec de l'envoi (${response.status}): ${body}`);
      throw new BadGatewayException("Échec de l'envoi du fichier.");
    }

    const data = await response.json().catch(() => null);

    // Champ déjà une URL absolue : on l'utilise telle quelle.
    const directUrl: string | undefined = data?.url || data?.location || data?.path;
    if (directUrl) {
      return { url: /^https?:\/\//.test(directUrl) ? directUrl : `${this.UPLOAD_URL}${directUrl}` };
    }

    // Sinon, seul un identifiant/nom de fichier est renvoyé : on reconstruit
    // l'URL via l'endpoint de lecture GET /files/:filename.
    const filename: string | undefined =
      data?.filename || data?.name || data?.fileName || data?.id || data?.key;
    if (!filename) {
      this.logger.error(`Réponse inattendue du service upload: ${JSON.stringify(data)}`);
      throw new BadGatewayException(
        'Réponse inattendue du service de fichiers (fichier introuvable dans la réponse).',
      );
    }

    return { url: `${this.UPLOAD_URL}/files/${encodeURIComponent(filename)}` };
  }
}
