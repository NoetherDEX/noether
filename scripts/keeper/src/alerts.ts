/**
 * Noether Keeper Bot - Webhook Alerting (K-1)
 *
 * Tiny dependency-free alert fan-out: Discord webhook and/or Telegram bot,
 * plain fetch with a 5s abort. Identical alerts (same level + title) are
 * rate-limited to once per 10 minutes so a flapping condition cannot spam
 * the channel. `sendAlert` NEVER throws and never blocks the caller for
 * more than the fetch timeout — alerting must not take the keeper down.
 *
 * Configure via env: DISCORD_WEBHOOK_URL and/or
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. With neither set, alerts are
 * console-only (still useful in Railway logs).
 */

export type AlertLevel = 'info' | 'warn' | 'critical';

export interface AlertChannels {
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

const ALERT_FETCH_TIMEOUT_MS = 5_000;
const ALERT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  critical: '🚨',
};

let channels: AlertChannels = {};
const lastSentAt = new Map<string, number>();

export function initAlerts(config: AlertChannels): void {
  channels = config;
  const active: string[] = [];
  if (channels.discordWebhookUrl) active.push('discord');
  if (channels.telegramBotToken && channels.telegramChatId) active.push('telegram');
  console.log(
    active.length > 0
      ? `🔔 Alerting enabled: ${active.join(', ')}`
      : '🔔 Alerting: no webhook configured (DISCORD_WEBHOOK_URL / TELEGRAM_*) — console only',
  );
}

/**
 * Fire an alert. `title` should be a STABLE string (it is the dedupe key);
 * put variable data (prices, counts, hashes) in `details`.
 */
export async function sendAlert(level: AlertLevel, title: string, details?: string): Promise<void> {
  try {
    const key = `${level}:${title}`;
    const now = Date.now();
    const previous = lastSentAt.get(key);
    if (previous !== undefined && now - previous < ALERT_DEDUPE_WINDOW_MS) return;
    lastSentAt.set(key, now);
    pruneDedupeMap(now);

    const text = `${LEVEL_EMOJI[level]} [noether-keeper/${level.toUpperCase()}] ${title}${details ? `\n${details}` : ''}`;
    console.log(`\n${text}`);

    const deliveries: Promise<void>[] = [];
    if (channels.discordWebhookUrl) {
      deliveries.push(postJson(channels.discordWebhookUrl, { content: text.slice(0, 1900) }));
    }
    if (channels.telegramBotToken && channels.telegramChatId) {
      deliveries.push(
        postJson(`https://api.telegram.org/bot${channels.telegramBotToken}/sendMessage`, {
          chat_id: channels.telegramChatId,
          text: text.slice(0, 4000),
        }),
      );
    }
    if (deliveries.length === 0) return;

    const results = await Promise.allSettled(deliveries);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(
          `⚠️  Alert delivery failed: ${result.reason instanceof Error ? result.reason.message : result.reason}`,
        );
      }
    }
  } catch (error) {
    // Alerting must never take the keeper down.
    console.warn(`⚠️  sendAlert error: ${error instanceof Error ? error.message : error}`);
  }
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ALERT_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`webhook HTTP ${response.status}`);
  }
}

function pruneDedupeMap(now: number): void {
  if (lastSentAt.size <= 200) return;
  for (const [key, sentAt] of lastSentAt) {
    if (now - sentAt >= ALERT_DEDUPE_WINDOW_MS) lastSentAt.delete(key);
  }
}
