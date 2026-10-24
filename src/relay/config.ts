import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadWebPush } from './push.js';

export interface RelayConfig {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  radioRepo: string | null;
}

export function configPath(dataDir: string): string {
  return path.join(dataDir, 'config.json');
}

export async function createConfig(dataDir: string): Promise<RelayConfig> {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const file = configPath(dataDir);
  if (existsSync(file)) throw new Error('Raj is already initialized in this folder.');
  const keys = await vapidKeys();
  const config: RelayConfig = {
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    radioRepo: null,
  };
  writeConfig(dataDir, config);
  return config;
}

export function readConfig(dataDir: string): RelayConfig {
  const file = configPath(dataDir);
  if (!existsSync(file)) throw new Error('Run raj relay init first.');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RelayConfig>;
  if (typeof parsed.vapidPublicKey !== 'string' || typeof parsed.vapidPrivateKey !== 'string') {
    throw new Error('The relay config is missing its push keys. Run raj relay init in a fresh folder.');
  }
  return {
    vapidPublicKey: parsed.vapidPublicKey,
    vapidPrivateKey: parsed.vapidPrivateKey,
    radioRepo: typeof parsed.radioRepo === 'string' && parsed.radioRepo ? parsed.radioRepo : null,
  };
}

export function writeConfig(dataDir: string, config: RelayConfig): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = configPath(dataDir);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const webpush = await loadWebPush();
  return webpush.generateVAPIDKeys();
}
