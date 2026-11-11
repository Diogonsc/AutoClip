import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSellerOAuthPreflight,
  validateSellerOAuthPreflightEvidence,
} from './verify_seller_oauth_preflight.mjs';

const evidence = {
  redirect_uri: 'https://autoclipe.vercel.app/tiktok/callback',
  service_id_confirmed: true,
  seller_main_account_confirmed: true,
  service_authorization_status: 'INITIAL_AUTHORIZATION_READY',
  partner_center_scopes: ['seller.authorization.info', 'seller.product.basic'],
};

test('Seller preflight accepts sanitised evidence only when both required scopes are active', () => {
  const report = validateSellerOAuthPreflightEvidence(evidence);
  assert.equal(report.ready, true);
  assert.match(formatSellerOAuthPreflight(report), /READY scope:seller.product.basic/);
});

test('Seller preflight distinguishes missing Partner Center scope and incomplete service authorization', () => {
  const report = validateSellerOAuthPreflightEvidence({
    ...evidence,
    service_authorization_status: 'RENEWAL_ONLY',
    partner_center_scopes: ['seller.authorization.info'],
  });
  assert.equal(report.ready, false);
  assert.match(formatSellerOAuthPreflight(report), /BLOCKED seller_service/);
  assert.match(formatSellerOAuthPreflight(report), /BLOCKED scope:seller.product.basic/);
});

test('Seller preflight records Partner Center context without mistaking it for an OAuth grant', () => {
  const report = validateSellerOAuthPreflightEvidence({
    ...evidence,
    service_public: true,
    market: 'BR',
    app_status: 'DRAFT',
    development_shop_available: true,
    oauth_grant_proven: false,
  });

  assert.equal(report.ready, true, 'static readiness permits a first authorization attempt');
  const output = formatSellerOAuthPreflight(report);
  assert.match(output, /CONFIRMED partner_context:service_public/);
  assert.match(output, /OBSERVED partner_context:app_status/);
  assert.match(output, /PENDING oauth_grant/);
});
