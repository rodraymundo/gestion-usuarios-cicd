'use strict';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'user'];

const MSG = {
  name: 'El nombre es obligatorio (2 a 80 caracteres)',
  username: 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo',
  email: 'El correo electrónico no es válido',
  role: 'El rol debe ser admin o user',
  password: 'La contraseña debe tener de 8 a 72 caracteres',
};

/**
 * Valida y normaliza los datos de un usuario.
 * - create=true  : name, username y password son obligatorios.
 * - create=false : solo se validan los campos presentes (actualización parcial).
 * Devuelve { errors, value }; si errors está vacío, value trae los datos limpios.
 */
function validateUser(input, { create = false } = {}) {
  const errors = {};
  const value = {};
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

  if (create || has('name')) {
    const v = typeof body.name === 'string' ? body.name.trim() : '';
    if (v.length < 2 || v.length > 80) errors.name = MSG.name;
    else value.name = v;
  }

  if (create || has('username')) {
    const v = typeof body.username === 'string' ? body.username.trim() : '';
    if (!USERNAME_RE.test(v)) errors.username = MSG.username;
    else value.username = v;
  }

  if (has('email')) {
    const raw = body.email;
    if (raw === null || raw === '') value.email = null;
    else if (typeof raw !== 'string' || raw.trim().length > 120 || !EMAIL_RE.test(raw.trim())) errors.email = MSG.email;
    else value.email = raw.trim();
  } else if (create) {
    value.email = null;
  }

  if (has('role')) {
    if (!ROLES.includes(body.role)) errors.role = MSG.role;
    else value.role = body.role;
  } else if (create) {
    value.role = 'user';
  }

  const passwordProvided = has('password') && body.password !== '' && body.password !== null;
  if (create || passwordProvided) {
    const v = body.password;
    if (typeof v !== 'string' || v.length < 8 || v.length > 72) errors.password = MSG.password;
    else value.password = v;
  }

  return { errors, value };
}

module.exports = { validateUser, USERNAME_RE, EMAIL_RE, ROLES };
