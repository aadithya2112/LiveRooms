import { test, expect, type Page } from '@playwright/test';
async function enter(page: Page, room: string, name: string) {
  await page.goto(`/room/${room}`);
  await page.getByLabel('What should we call you?').fill(name);
  await expect(page.getByRole('button', { name: 'Join room', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
}
test('home validates invitations and creates a pre-call lobby', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good company.');
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('valid room');
  await page.getByLabel('Already have an invite?').fill('https://example.test/room/hello-friend');
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page).toHaveURL(/room\/hello-friend/);
  await expect(page.getByRole('heading', { name: 'Come as you are.' })).toBeVisible();
});
test('two browsers connect, toggle media, survive a peer replacement, and release devices', async ({
  browser,
}) => {
  const a = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const b = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const first = await a.newPage();
  const second = await b.newPage();
  const room = crypto.randomUUID();
  await first.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        (window as Window & { roomSocket?: WebSocket }).roomSocket = this;
      }
    };
  });
  await second.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#355e44';
      ctx.fillRect(0, 0, 320, 240);
      const stream = canvas.captureStream(5);
      (window as Window & { screenTrack?: MediaStreamTrack }).screenTrack =
        stream.getVideoTracks()[0];
      return stream;
    };
  });
  try {
    await enter(first, room, 'Alex');
    await expect(first.getByRole('heading', { name: 'Waiting for your person.' })).toBeVisible();
    await enter(second, room, 'Sam');
    await expect(first.getByText('You’re connected', { exact: true })).toBeVisible({
      timeout: 25000,
    });
    await expect(second.getByText('You’re connected', { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        first.locator('.remote-tile video').evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    const cameraTrackId = await second
      .locator('.local-tile video')
      .evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0].id);
    await second.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(first.getByText('Sam’s screen', { exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(first.getByText('Sam’s screen', { exact: true })).not.toBeVisible();
    await second.getByRole('button', { name: 'Share screen', exact: true }).click();
    await second.evaluate(() => {
      const track = (window as Window & { screenTrack?: MediaStreamTrack }).screenTrack!;
      track.stop();
      track.dispatchEvent(new Event('ended'));
    });
    await expect(second.getByRole('button', { name: 'Share screen', exact: true })).toBeVisible();
    await expect
      .poll(() =>
        second
          .locator('.local-tile video')
          .evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0].id),
      )
      .toBe(cameraTrackId);
    await first.evaluate(() =>
      (window as Window & { roomSocket?: WebSocket }).roomSocket!.close(
        4000,
        'Simulated interruption',
      ),
    );
    await expect(first.getByText('Reconnecting', { exact: true })).toBeVisible();
    await expect(first.getByText('You’re connected', { exact: true })).toBeVisible({
      timeout: 25000,
    });
    await expect(second.getByText('You’re connected', { exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await expect(
      second.getByRole('button', { name: 'Unmute microphone', exact: true }),
    ).toBeVisible();
    await second.getByRole('button', { name: 'Turn camera off', exact: true }).click();
    await expect(first.getByText('Camera is off. The conversation is still on.')).toBeVisible();
    // Keep references across SPA navigation to verify cleanup, rather than merely checking the UI.
    await second.evaluate(() => {
      (window as Window & { previousTracks?: MediaStreamTrack[] }).previousTracks = [
        ...document.querySelectorAll('video'),
      ].flatMap((v) => (v.srcObject as MediaStream | null)?.getTracks() || []);
    });
    await second.getByRole('button', { name: 'Leave call', exact: true }).click();
    await expect
      .poll(() =>
        second.evaluate(() =>
          (window as Window & { previousTracks?: MediaStreamTrack[] }).previousTracks
            ?.map((t) => ({ kind: t.kind, label: t.label, state: t.readyState }))
            .filter((t) => t.state !== 'ended'),
        ),
      )
      .toEqual([]);
    await expect(first.getByRole('heading', { name: 'Waiting for your person.' })).toBeVisible();
    await enter(second, room, 'Taylor');
    await expect(first.getByText('You’re connected', { exact: true })).toBeVisible({
      timeout: 25000,
    });
    await first.getByRole('button', { name: 'Room details' }).click();
    await expect(first.getByRole('dialog', { name: 'Room details' })).toContainText(
      'TURN not configured',
    );
  } finally {
    await a.close();
    await b.close();
  }
});
test('permission denial remains actionable and allows receive-only joining', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Blocked', 'NotAllowedError');
    };
  });
  try {
    await page.goto('/room/permission-test');
    await expect(page.getByRole('alert')).toContainText('access was blocked');
    await page.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for your person.' })).toBeVisible();
  } finally {
    await context.close();
  }
});
test('mobile home, lobby and call fit the viewport with accessible controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Start a conversation' }).click();
  await expect(page.getByRole('heading', { name: 'Come as you are.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Join room', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Leave call' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('invalid room IDs show a recovery action', async ({ page }) => {
  await page.goto('/room/abc');
  await expect(page.getByRole('heading')).toContainText('doesn’t look right');
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
});

test('microphone-only retry works when camera capture fails', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.video) throw new DOMException('No camera', 'NotFoundError');
      return original(constraints);
    };
  });
  await page.goto('/room/audio-only-test');
  await expect(page.getByRole('alert')).toContainText('No camera or microphone found');
  await page.getByRole('button', { name: 'Use microphone only' }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn camera on', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
});
test('server failure offers recovery without leaving the room', async ({ page }) => {
  await page.route('**/ice', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await enter(page, 'offline-server-test', 'Alex');
  await expect(page.getByRole('alert')).toContainText('Could not reach the room server');
  await expect(page.getByRole('button', { name: 'Rejoin room', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/room\/offline-server-test/);
});
