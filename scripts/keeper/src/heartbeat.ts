/**
 * Keeper → api heartbeat (T3-D1 oracle health surface).
 *
 * After every oracle cycle the keeper POSTs a status snapshot to the api
 * gateway's /v1/oracle/heartbeat (shared-secret header), where it becomes
 * the `keeper` section of GET /v1/oracle/health. Fire-and-forget: a dead
 * or unconfigured gateway must never slow or fail the keeper loop —
 * without KEEPER_HEARTBEAT_URL this module is a no-op.
 */

const HEARTBEAT_TIMEOUT_MS = 5_000;

export interface HeartbeatConfig {
  heartbeatUrl: string;
  heartbeatSecret: string;
}

export function sendHeartbeat(config: HeartbeatConfig, payload: Record<string, unknown>): void {
  if (!config.heartbeatUrl) return;
  void fetch(config.heartbeatUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-keeper-secret': config.heartbeatSecret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
  }).catch(() => {
    // Deliberately silent: health visibility must not create keeper noise.
  });
}
