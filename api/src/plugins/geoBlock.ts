import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Interface-level geo-restriction at the gateway (P6-4 / research 2.4 #8) —
 * the server-side mirror of the web edge middleware. Trading endpoints
 * (order prep, tx submit) are refused with 451 from restricted
 * jurisdictions (US, Ontario, OFAC-sanctioned); read/health/auth stay open.
 *
 * The caller's country comes from an upstream edge header
 * (`cf-ipcountry` on Cloudflare, `x-vercel-ip-country` on Vercel, or a
 * custom `GEO_COUNTRY_HEADER`). Best-effort by design — the ToS carries the
 * restricted-persons + no-VPN warranties as the legal backstop. Disabled
 * unless `API_GEOBLOCK=1`, and skipped when no country header is present so
 * a missing header never blocks legitimate infra traffic.
 */

const BLOCKED_COUNTRIES = new Set(['US', 'CU', 'IR', 'KP', 'SY', 'RU', 'BY']);
const BLOCKED_REGIONS = new Set(['CA-ON']);

// Endpoints that place or mutate trades — the restricted surface.
const GUARDED_PREFIXES = ['/v1/orders', '/v1/tx'];

export interface GeoBlockOpts {
  enabled: boolean;
  countryHeader: string;
  regionHeader: string;
}

function header(request: FastifyRequest, name: string): string {
  const v = request.headers[name.toLowerCase()];
  const raw = Array.isArray(v) ? v[0] ?? '' : v ?? '';
  return raw.toString().toUpperCase();
}

export function isBlocked(country: string, region: string): boolean {
  if (!country) return false;
  if (BLOCKED_COUNTRIES.has(country)) return true;
  const composite = region ? `${country}-${region}` : '';
  return BLOCKED_REGIONS.has(composite);
}

async function geoBlockPluginImpl(app: FastifyInstance, opts: GeoBlockOpts): Promise<void> {
  if (!opts.enabled) return;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const guarded = GUARDED_PREFIXES.some((p) => request.url === p || request.url.startsWith(`${p}/`));
    if (!guarded) return;

    const country = header(request, opts.countryHeader);
    const region = header(request, opts.regionHeader);
    if (isBlocked(country, region)) {
      return reply.code(451).send({
        error: 'region_restricted',
        message:
          'Trading is not available in your jurisdiction. See the Terms of Service (restricted persons).',
      });
    }
  });
}

export const geoBlockPlugin = fp(geoBlockPluginImpl, { name: 'noether-geo-block' });
