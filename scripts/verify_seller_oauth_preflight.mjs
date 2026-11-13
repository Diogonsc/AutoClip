#!/usr/bin/env node
// Validates a manually collected, sanitized Partner Center evidence file.
// It performs no network I/O and never accepts or prints credentials.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const EXPECTED_REDIRECT_URI = 'https://autoclipe.vercel.app/tiktok/callback';
const REQUIRED_SELLER_SCOPES = ['seller.authorization.info', 'seller.product.basic'];

function item(name, valid, message) {
  return { name, status: valid ? 'READY' : 'BLOCKED', message };
}

function contextItem(name, status, message) {
  return { name, status, message };
}

export function validateSellerOAuthPreflightEvidence(evidence) {
  const scopes = Array.isArray(evidence?.partner_center_scopes)
    ? evidence.partner_center_scopes.filter((scope) => typeof scope === 'string')
    : [];
  const items = [
    item('redirect_uri', evidence?.redirect_uri === EXPECTED_REDIRECT_URI, 'Redirect URI cadastrada coincide com a URI fixa do callback'),
    item('service_id', evidence?.service_id_confirmed === true, 'service_id Seller foi confirmado no Partner Center sem registrar o valor'),
    item('seller_main_account', evidence?.seller_main_account_confirmed === true, 'a conta usada é a conta principal autorizadora da Development Shop'),
    item('seller_service', evidence?.service_authorization_status === 'INITIAL_AUTHORIZATION_READY', 'o serviço está pronto para primeira autorização, não apenas renovação'),
    ...REQUIRED_SELLER_SCOPES.map((scope) => item(`scope:${scope}`, scopes.includes(scope), 'escopo ativo no Partner Center')),
  ];
  const context = [
    contextItem(
      'partner_context:service_public',
      evidence?.service_public === true ? 'CONFIRMED' : 'UNVERIFIED',
      'estado público do serviço informado manualmente; não comprova autorização OAuth',
    ),
    contextItem(
      'partner_context:market',
      evidence?.market === 'BR' ? 'CONFIRMED' : 'UNVERIFIED',
      'mercado informado manualmente; a elegibilidade real continua dependente do Partner Center',
    ),
    contextItem(
      'partner_context:app_status',
      typeof evidence?.app_status === 'string' ? 'OBSERVED' : 'UNVERIFIED',
      'status do aplicativo é contexto operacional, não uma prova de concessão OAuth',
    ),
    contextItem(
      'partner_context:development_shop',
      evidence?.development_shop_available === true ? 'CONFIRMED' : 'UNVERIFIED',
      'Development Shop disponível não substitui a autorização da conta principal',
    ),
    contextItem(
      'oauth_grant',
      evidence?.oauth_grant_proven === true ? 'CONFIRMED' : 'PENDING',
      'somente o callback real pode comprovar granted_scopes e a concessão OAuth',
    ),
  ];
  return {
    // "ready" means that static prerequisites permit a first attempt. It never
    // means that an OAuth grant or a Sandbox run has been proven.
    ready: items.every(({ status }) => status === 'READY'),
    items: [...items, ...context],
  };
}

export function formatSellerOAuthPreflight(report) {
  return report.items.map(({ name, status, message }) => `${status} ${name}: ${message}`).join('\n');
}

function readEvidence(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  const report = validateSellerOAuthPreflightEvidence(path ? readEvidence(path) : null);
  process.stdout.write(`${formatSellerOAuthPreflight(report)}\n`);
  process.exitCode = report.ready ? 0 : 1;
}
