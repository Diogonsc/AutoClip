#!/usr/bin/env node
// Local, read-only readiness check. It reports only names and status; values
// are deliberately never printed, including when validation fails.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const PRODUCTION_CALLBACK_ORIGIN = 'https://autoclipe.vercel.app';
const UNUSED_SELLER_CONFIGURATION = [
  'TIKTOK_SHOP_SELLER_AUTH_URL',
  'TIKTOK_SHOP_SELLER_REDIRECT_URI',
];

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAes256Base64(value) {
  if (!hasText(value)) return false;
  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}

function item(name, valid, message, severity = 'required') {
  return { name, status: valid ? 'READY' : severity === 'required' ? 'BLOCKED' : 'WARNING', message };
}

/**
 * Validates the Seller-only backend configuration without returning any value.
 * The callback is intentionally fixed in the OAuth builder; accepting a
 * caller-controlled redirect URL would create an open-redirect risk.
 */
export function validateSellerOAuthConfiguration(environment = process.env) {
  const firstWebOrigin = (environment.WEB_URL ?? '').split(',')[0]?.trim().replace(/\/+$/, '');
  const items = [
    item('TIKTOK_SHOP_APP_KEY', hasText(environment.TIKTOK_SHOP_APP_KEY), 'identificador do app Seller presente'),
    item('TIKTOK_SHOP_APP_SECRET', hasText(environment.TIKTOK_SHOP_APP_SECRET), 'segredo backend Seller presente'),
    item(
      'TIKTOK_SHOP_SELLER_SERVICE_ID',
      hasText(environment.TIKTOK_SHOP_SELLER_SERVICE_ID) && !/\s/.test(environment.TIKTOK_SHOP_SELLER_SERVICE_ID),
      'service_id Seller presente e sem espaços',
    ),
    item(
      'TIKTOK_SHOP_SELLER_TOKEN_ENCRYPTION_KEY',
      isAes256Base64(environment.TIKTOK_SHOP_SELLER_TOKEN_ENCRYPTION_KEY),
      'chave AES-256-GCM base64 de 32 bytes presente',
    ),
    item('WEB_URL', firstWebOrigin === PRODUCTION_CALLBACK_ORIGIN, 'primeira origem corresponde ao callback Seller cadastrado'),
    item(
      'TIKTOK_SHOP_SANDBOX_ENABLED',
      !hasText(environment.TIKTOK_SHOP_SANDBOX_ENABLED) || environment.TIKTOK_SHOP_SANDBOX_ENABLED === 'false',
      'permanece false; a feature flag de código é a autoridade',
    ),
    ...UNUSED_SELLER_CONFIGURATION.map((name) => item(
      name,
      !hasText(environment[name]),
      'não é consumida pelo builder Seller; manter ausente para evitar divergência',
      'warning',
    )),
  ];
  return { ready: items.every(({ status }) => status !== 'BLOCKED'), items };
}

export function formatSellerOAuthConfigurationReport(report) {
  return report.items.map(({ name, status, message }) => `${status} ${name}: ${message}`).join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = validateSellerOAuthConfiguration();
  process.stdout.write(`${formatSellerOAuthConfigurationReport(report)}\n`);
  process.exitCode = report.ready ? 0 : 1;
}
