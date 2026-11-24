'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const COOKIE_NAME = 'session';

/** Hash de contraseña con scrypt (incluido en Node, sin dependencias). */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, saltHex, keyHex] = String(stored).split('$');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** Token de sesión firmado (HMAC-SHA256) con fecha de expiración. */
function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const raw = part.slice(index + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      /* cookie mal codificada: se usa tal cual y fallará la verificación de firma */
    }
    out[part.slice(0, index).trim()] = value;
  }
  return out;
}

function sessionCookie(token, ttlSeconds) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  parseCookies,
  sessionCookie,
  clearCookie,
};
