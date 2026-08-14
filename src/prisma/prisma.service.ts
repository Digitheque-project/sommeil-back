import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Les bases managées (Render, Heroku...) imposent TLS mais présentent un
 * certificat signé par une autorité interne : `rejectUnauthorized` doit rester
 * désactivé pour ces hôtes. En local, on se connecte sans TLS.
 */
function buildSslOption(connectionString?: string) {
  if (!connectionString) return undefined;

  try {
    const { hostname } = new URL(connectionString);
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    return isLocal ? undefined : { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({
      connectionString,
      ssl: buildSslOption(connectionString),
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    // Une base indisponible ne doit pas empêcher le service de démarrer : les
    // routes qui n'en dépendent pas (relais vers les services externes,
    // listes de repli) restent servies.
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error(
        `Connexion à la base de données impossible, le service démarre en mode dégradé: ${error}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect().catch(() => undefined);
  }
}
