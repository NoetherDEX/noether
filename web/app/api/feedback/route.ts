import { NextRequest, NextResponse } from 'next/server';

// B28: feedback that actually arrives. Forwards to a Discord webhook
// (FEEDBACK_DISCORD_WEBHOOK_URL). Returns 501 when unconfigured so the
// client can fall back to the mailto path instead of false-succeeding.
export async function POST(request: NextRequest) {
  const webhook = process.env.FEEDBACK_DISCORD_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ error: 'not_configured' }, { status: 501 });
  }

  try {
    const { category, subject, message, page } = await request.json();

    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'message_required' }, { status: 400 });
    }

    const safe = (s: unknown, max: number) =>
      typeof s === 'string' ? s.slice(0, max) : '';

    const content = [
      `**[${safe(category, 20) || 'general'}] ${safe(subject, 120) || 'Feedback'}**`,
      safe(message, 1500),
      page ? `— page: ${safe(page, 100)}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'webhook_failed' }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
}
