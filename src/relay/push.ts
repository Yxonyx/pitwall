import type { PushSub } from './store.js';

export interface PushNote {
  title: string;
  body: string;
  url: string;
}

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  note: PushNote,
) => Promise<void>;

export async function loadWebPush(): Promise<typeof import('web-push')> {
  const imported = (await import('web-push')) as typeof import('web-push') & { default?: typeof import('web-push') };
  return imported.default ?? imported;
}

export function webPushSender(publicKey: string, privateKey: string): PushSender {
  let ready = false;
  return async (sub, note) => {
    const webpush = await loadWebPush();
    if (!ready) {
      webpush.setVapidDetails('mailto:raj@localhost', publicKey, privateKey);
      ready = true;
    }
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(note),
    );
  };
}

export async function deliverPush(sender: PushSender, subs: readonly PushSub[], note: PushNote): Promise<string[]> {
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, note);
      } catch (error) {
        const status =
          typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0;
        if (status === 404 || status === 410) gone.push(sub.endpoint);
      }
    }),
  );
  return gone;
}
