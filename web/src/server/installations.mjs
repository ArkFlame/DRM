import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { snapshotWriter } from './persistence.mjs';

export const ENTITLEMENT_TTL_MS = 12 * 3600000;
export const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function secureEqual(a, b) {
  const x = Buffer.from(a || '', 'utf8');
  const y = Buffer.from(b || '', 'utf8');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function validate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (payload.protocolVersion !== 1 || typeof payload.productId !== 'string' ||
      !PRODUCT_ID.test(payload.productId) || typeof payload.installationId !== 'string' ||
      !UUID_ID.test(payload.installationId)) return false;
  for (const field of ['productVersion', 'serverVersion', 'javaVersion']) {
    if (typeof payload[field] !== 'string' || payload[field].length > 160) return false;
  }
  return typeof payload.distributionNonce === 'string' && payload.distributionNonce.length <= 256 &&
    (!payload.distributionNonce || /^[a-zA-Z0-9_-]{8,256}$/.test(payload.distributionNonce));
}

export function digest(nonce, key) {
  return nonce ? createHmac('sha256', key).update(nonce, 'utf8').digest('hex') : '';
}

const VALID_STATUSES = ['NONE', 'ALLOW', 'REVIEW', 'BLOCK'];
const VALID_RIGHTS = ['UNKNOWN', 'NONCE_RIGHTS_YES', 'NONCE_RIGHTS_NO'];
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function validStoredInstallation(key, row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) ||
      typeof row.productId !== 'string' || !PRODUCT_ID.test(row.productId) ||
      typeof row.installationId !== 'string' || !UUID_ID.test(row.installationId) ||
      key !== `${row.productId}:${row.installationId}`) return false;
  return ['productVersion', 'serverVersion', 'javaVersion'].every(field =>
    typeof row[field] === 'string' && row[field].length <= 160) &&
    typeof row.downloadDigest === 'string' && (!row.downloadDigest || /^[a-f0-9]{64}$/.test(row.downloadDigest)) &&
    typeof row.observedIp === 'string' && row.observedIp.length <= 128 &&
    timestamp(row.firstSeen) && timestamp(row.lastSeen) &&
    Number.isSafeInteger(row.reports) && row.reports >= 1 &&
    VALID_STATUSES.includes(row.manualStatus) &&
    typeof row.manualReason === 'string' && row.manualReason.length <= 500 &&
    VALID_RIGHTS.includes(row.entitlement) &&
    typeof row.entitlementCheckedAt === 'string' &&
    (!row.entitlementCheckedAt || timestamp(row.entitlementCheckedAt));
}

function validAudit(row) {
  return row && typeof row === 'object' && !Array.isArray(row) && timestamp(row.at) &&
    typeof row.productId === 'string' && PRODUCT_ID.test(row.productId) &&
    typeof row.installationId === 'string' && UUID_ID.test(row.installationId) &&
    VALID_STATUSES.includes(row.status) && typeof row.reason === 'string' && row.reason.length <= 500;
}

export class Store {
  constructor(file) {
    this.file = file;
    this.state = { schema: 1, installations: {}, audit: [] };
    this.persist = snapshotWriter(file, () => this.state);
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      if (!raw || raw.schema !== 1 || !raw.installations ||
          typeof raw.installations !== 'object' || Array.isArray(raw.installations) ||
          !Array.isArray(raw.audit) || Object.keys(raw.installations).length > 100000 || raw.audit.length > 5000 ||
          !Object.entries(raw.installations).every(([key, row]) =>
            validStoredInstallation(key, row)) || !raw.audit.every(validAudit))
        throw Error('Invalid schema');
      this.state = raw;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  record(payload, address, hash) {
    const key = `${payload.productId}:${payload.installationId}`;
    const now = new Date().toISOString();
    const prev = this.state.installations[key];
    const install = {
      productId: payload.productId,
      installationId: payload.installationId,
      productVersion: payload.productVersion,
      serverVersion: payload.serverVersion,
      javaVersion: payload.javaVersion,
      downloadDigest: hash,
      observedIp: address,
      firstSeen: prev?.firstSeen || now,
      lastSeen: now,
      reports: Math.min((prev?.reports || 0) + 1, Number.MAX_SAFE_INTEGER),
      manualStatus: prev?.manualStatus || 'NONE',
      manualReason: prev?.manualReason || '',
      entitlement: prev?.downloadDigest === hash ? (prev?.entitlement || 'UNKNOWN') : 'UNKNOWN',
      entitlementCheckedAt: prev?.downloadDigest === hash ? (prev?.entitlementCheckedAt || '') : ''
    };
    this.state.installations[key] = install;
    return install;
  }

  setStatus(productId, installationId, status, reason) {
    const install = this.state.installations[`${productId}:${installationId}`];
    if (!install) return false;
    if (install.manualStatus === status && install.manualReason === reason) return 'unchanged';
    install.manualStatus = status;
    install.manualReason = reason;
    this.state.audit.push({ at: new Date().toISOString(), productId, installationId,
      status, reason });
    if (this.state.audit.length > 5000) this.state.audit.splice(0, this.state.audit.length - 5000);
    return true;
  }

  applyEntitlement(productId, hash, status, checkedAt = new Date().toISOString()) {
    if (!PRODUCT_ID.test(productId) || !hash || !['NONCE_RIGHTS_YES', 'NONCE_RIGHTS_NO'].includes(status)) return false;
    let changed = false;
    for (const item of Object.values(this.state.installations)) {
      if (item.productId === productId && item.downloadDigest === hash && (item.entitlement !== status || item.entitlementCheckedAt !== checkedAt)) {
        item.entitlement = status;
        item.entitlementCheckedAt = checkedAt;
        changed = true;
      }
    }
    return changed;
  }

  prune(now = Date.now(), days = 180, limit = 10000) {
    const beforeRecords = Object.keys(this.state.installations).length;
    const beforeAudit = this.state.audit.length;
    const threshold = now - days * 86400000;
    const records = this.state.installations;
    for (const [key, item] of Object.entries(records)) {
      if (Date.parse(item.lastSeen) < threshold) delete records[key];
    }
    const keys = Object.keys(records);
    if (keys.length > limit) {
      keys.sort((a, b) => records[a].lastSeen.localeCompare(records[b].lastSeen));
      for (let i = 0; i < keys.length - limit; i++) delete records[keys[i]];
    }
    this.state.audit = this.state.audit.filter(row => Date.parse(row.at) >= threshold).slice(-5000);
    return beforeRecords !== Object.keys(records).length || beforeAudit !== this.state.audit.length;
  }

  list({ bbbConfigured = false } = {}) {
    const now = Date.now();
    const counts = new Map();
    for (const item of Object.values(this.state.installations)) {
      if (item.downloadDigest) counts.set(item.downloadDigest, (counts.get(item.downloadDigest) || 0) + 1);
    }
    return Object.values(this.state.installations).map(item => {
      const lastCheck = Date.parse(item.entitlementCheckedAt);
      const fresh = Number.isFinite(lastCheck) && lastCheck + ENTITLEMENT_TTL_MS > now;
      return { ...item,
        entitlement: bbbConfigured && fresh ? item.entitlement : 'UNKNOWN',
        licenseEvidence: !item.downloadDigest ? 'NO_DISTRIBUTION_NONCE' : !bbbConfigured ? 'BUILTBYBIT_NOT_CONFIGURED' : fresh && item.entitlement !== 'UNKNOWN' ? 'NONCE_RIGHTS_ONLY_PRODUCT_UNVERIFIED' : 'NO_CURRENT_RIGHTS_OBSERVATION',
        sharedDownloadInstallations: item.downloadDigest ? counts.get(item.downloadDigest) : 0
      };
    }).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }
}
