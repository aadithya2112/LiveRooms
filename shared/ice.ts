export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export const defaultIceServers: IceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];
export interface TurnConfig {
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
}
export async function iceConfig(
  env: TurnConfig,
): Promise<{ iceServers: IceServer[]; relayConfigured: boolean }> {
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN)
    return { iceServers: defaultIceServers, relayConfigured: false };
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURN_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 3600 }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error('TURN credential service unavailable');
  const data = (await response.json()) as { iceServers: IceServer[] };
  if (!Array.isArray(data.iceServers) || !data.iceServers.length)
    throw new Error('Invalid TURN response');
  return { iceServers: [...defaultIceServers, ...data.iceServers], relayConfigured: true };
}
export function allowedOrigin(origin: string | null | undefined, configured: string): boolean {
  return (
    !!origin &&
    configured
      .split(',')
      .map((s) => s.trim())
      .includes(origin)
  );
}
