import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readEnvVarPreferDotenvFile } from '../config/read-env-var.util';
import {
  buildOpenFdaDrugLabelSearchQuery,
  dedupeOpenFdaHits,
  escapeOpenFdaSearchTerm,
  mapOpenFdaLabelResult,
  type OpenFdaDrugLabelHit,
  type OpenFdaRawLabel,
} from './openfda-label.util';

const OPENFDA_BASE = 'https://api.fda.gov/drug/label.json';

type OpenFdaApiResponse = {
  results?: OpenFdaRawLabel[];
  error?: { code?: string; message?: string };
};

@Injectable()
export class OpenFdaService {
  constructor(private readonly config: ConfigService) {}

  private resolveApiKey(): string {
    const fromConfig =
      this.config.get<string>('openfda.apiKey')?.trim() ||
      this.config.get<string>('OPENDFDA_API_KEY')?.trim() ||
      '';
    if (fromConfig) return fromConfig;
    return readEnvVarPreferDotenvFile('OPENDFDA_API_KEY');
  }

  isConfigured(): boolean {
    return Boolean(this.resolveApiKey());
  }

  async searchDrugLabels(query: string, limit = 8): Promise<OpenFdaDrugLabelHit[]> {
    const term = query.trim();
    if (term.length < 2) return [];

    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'openFDA search is not configured. Set OPENDFDA_API_KEY on the server.',
      );
    }

    const search = buildOpenFdaDrugLabelSearchQuery(term);
    const cappedLimit = Math.min(Math.max(limit, 1), 20);
    const url = new URL(OPENFDA_BASE);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('search', search);
    url.searchParams.set('limit', String(cappedLimit));

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new BadGatewayException('Unable to reach openFDA. Check your network and try again.');
    }

    if (res.status === 404) return [];

    const body = (await res.json().catch(() => null)) as OpenFdaApiResponse | null;
    if (!res.ok) {
      const detail = body?.error?.message ?? `openFDA returned HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        throw new ServiceUnavailableException('openFDA API key is invalid or not authorized.');
      }
      if (res.status === 400 || res.status === 500) {
        const fallback = await this.searchDrugLabelsFallback(term, apiKey, cappedLimit);
        if (fallback.length > 0) return fallback;
      }
      throw new BadGatewayException(
        detail === 'Check your request and try again'
          ? 'Drug name search could not be run. Try a longer name or different spelling.'
          : detail,
      );
    }

    const mapped = (body?.results ?? [])
      .map((row, i) => mapOpenFdaLabelResult(row, i))
      .filter((h): h is OpenFdaDrugLabelHit => h != null);

    return dedupeOpenFdaHits(mapped);
  }

  private async searchDrugLabelsFallback(
    term: string,
    apiKey: string,
    limit: number,
  ): Promise<OpenFdaDrugLabelHit[]> {
    const escaped = escapeOpenFdaSearchTerm(term);
    if (!escaped) return [];
    const search = `openfda.brand_name:${escaped}*`;
    const url = new URL(OPENFDA_BASE);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('search', search);
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 404 || !res.ok) return [];

    const body = (await res.json().catch(() => null)) as OpenFdaApiResponse | null;
    const mapped = (body?.results ?? [])
      .map((row, i) => mapOpenFdaLabelResult(row, i))
      .filter((h): h is OpenFdaDrugLabelHit => h != null);
    return dedupeOpenFdaHits(mapped);
  }
}
