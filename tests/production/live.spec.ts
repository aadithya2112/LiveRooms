import { test, expect, type Page } from '@playwright/test';

const signaling =
  process.env.LIVEROOMS_SIGNALING_URL || 'https://liverooms-signaling.aadithyacps.workers.dev';
const origin = process.env.LIVEROOMS_BASE_URL || 'https://rooms.aadithya.dev';
async function join(page: Page, room: string, name: string) {
  await page.goto(`/room/${room}`);
  await expect(page.getByRole('heading', { name: 'Come as you are.' })).toBeVisible();
  await page.getByLabel('What should we call you?').fill(name);
  await expect(page.getByRole('button', { name: 'Join room', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
}

test('hosted routes, security headers and backend origin restrictions', async ({ request }) => {
  const home = await request.get('/');
  expect(home.status()).toBe(200);
  expect(home.headers()['x-frame-options']).toBe('DENY');
  const room = await request.get(`/room/${crypto.randomUUID()}`);
  expect(room.status()).toBe(200);
  expect(await room.text()).toContain('LiveRooms');
  const health = await request.get(`${signaling}/health`);
  expect(await health.json()).toEqual({ status: 'ok' });
  const ice = await request.get(`${signaling}/ice`, { headers: { Origin: origin } });
  expect(ice.status()).toBe(200);
  expect(ice.headers()['access-control-allow-origin']).toBe(origin);
  expect(ice.headers()['cache-control']).toBe('no-store');
  expect(
    (
      await request.get(`${signaling}/ice`, { headers: { Origin: 'https://untrusted.example' } })
    ).status(),
  ).toBe(403);
});

test('hosted video call, media controls, room capacity and peer replacement', async ({
  browser,
}) => {
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ permissions: ['camera', 'microphone'] })),
  );
  const [a, b, c] = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  for (const page of [a, b, c]) page.on('pageerror', (error) => errors.push(error.message));
  const room = crypto.randomUUID();
  try {
    await join(a, room, 'Deployment check A');
    await expect(a.getByRole('heading', { name: 'Waiting for your person.' })).toBeVisible();
    await join(b, room, 'Deployment check B');
    await expect(a.getByText('You’re connected', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(b.getByText('You’re connected', { exact: true })).toBeVisible();
    await expect
      .poll(() => a.locator('.remote-tile video').evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(2);
    await b.getByRole('button', { name: 'Turn camera off', exact: true }).click();
    await expect(a.getByText('Camera is off. The conversation is still on.')).toBeVisible();
    await b.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Unmute microphone', exact: true })).toBeVisible();
    await join(c, room, 'Deployment check C');
    await expect(c.getByRole('heading', { name: 'This room is full…' })).toBeVisible();
    await expect(c.getByRole('alert')).toContainText('already has two people');
    await b.getByRole('button', { name: 'Leave call', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Waiting for your person.' })).toBeVisible();
    await c.getByRole('button', { name: 'Rejoin room', exact: true }).click();
    await expect(a.getByText('You’re connected', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(c.getByText('You’re connected', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('TURN-only call proves real relay connectivity', async ({ browser, request }) => {
  const response = await request.get(`${signaling}/ice`, { headers: { Origin: origin } });
  const config = (await response.json()) as { relayConfigured: boolean };
  test.skip(!config.relayConfigured, 'TURN credentials have not been provisioned.');
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ permissions: ['camera', 'microphone'] })),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  for (const page of pages)
    await page.addInitScript(() => {
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(configuration?: RTCConfiguration) {
          super({ ...configuration, iceTransportPolicy: 'relay' });
        }
      };
    });
  const room = crypto.randomUUID();
  try {
    await join(pages[0], room, 'Relay check A');
    await join(pages[1], room, 'Relay check B');
    for (const page of pages) {
      await expect(page.getByText('You’re connected', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('button', { name: 'Room details', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Room details' })).toContainText('TURN relay', {
        timeout: 10_000,
      });
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
