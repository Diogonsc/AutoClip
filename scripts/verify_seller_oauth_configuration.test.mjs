import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSellerOAuthConfigurationReport,
  validateSellerOAuthConfiguration,
} from './verify_seller_oauth_configuration.mjs';

const valid = {
  TIKTOK_SHOP_APP_KEY: 'synthetic-app-key',
  TIKTOK_SHOP_APP_SECRET: 'synthetic-app-secret',
  TIKTOK_SHOP_SELLER_SERVICE_ID: 'synthetic-service-id',
  TIKTOK_SHOP_SELLER_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  WEB_URL: 'https://autoclipe.vercel.app,http://localhost:5173',
  TIKTOK_SHOP_SANDBOX_ENABLED: 'false',
};

test('Seller config verifier accepts only the expected backend-only shape', () => {
  const report = validateSellerOAuthConfiguration(valid);
  assert.equal(report.ready, true);
  assert.match(formatSellerOAuthConfigurationReport(report), /READY TIKTOK_SHOP_APP_SECRET/);
});

test('Seller config verifier blocks missing secrets, wrong callback and unsafe enablement without echoing values', () => {
  const report = validateSellerOAuthConfiguration({
    ...valid,
    TIKTOK_SHOP_APP_SECRET: '',
    WEB_URL: 'https://evil.example',
    TIKTOK_SHOP_SANDBOX_ENABLED: 'true',
  });
  const output = formatSellerOAuthConfigurationReport(report);
  assert.equal(report.ready, false);
  assert.match(output, /BLOCKED TIKTOK_SHOP_APP_SECRET/);
  assert.doesNotMatch(output, /synthetic-app-secret|evil\.example/);
});

test('Seller config verifier warns about stale redirect or authorization host variables', () => {
  const report = validateSellerOAuthConfiguration({
    ...valid,
    TIKTOK_SHOP_SELLER_AUTH_URL: 'https://untrusted.example',
    TIKTOK_SHOP_SELLER_REDIRECT_URI: 'https://untrusted.example/callback',
  });
  assert.equal(report.ready, true);
  assert.equal(report.items.filter(({ status }) => status === 'WARNING').length, 2);
});
