(function () {
  'use strict';

  var api = window.App.api;
  var show = window.App.show;
  var hide = window.App.hide;

  var $ = function (id) { return document.getElementById(id); };
  var FIELDS = ['name', 'username', 'email', 'role', 'password'];

  var me = null;
  var editingId = null;
  var pendingDelete = null;
  var searchTimer = null;
  var statusTimer = null;

  var userDialog = $('user-dialog');
  var confirmDialog = $('confirm-dialog');
  var form = $('user-form');

  function flash(message, isError) {
    var el = $('status');
    el.textContent = message;
    el.className = isError ? 'status error' : 'status';
    el.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { hide(el); }, 6000);
  }

  function formatDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function textCell(row, text) {
    var td = document.createElement('td');
    td.textContent = text;
    row.appendChild(td);
    return td;
  }

  function actionButton(label, ariaLabel, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost btn-small';
    b.textContent = label;
    b.setAttribute('aria-label', ariaLabel);
    b.addEventListener('click', onClick);
    return b;
  }

  function render(users) {
    var body = $('users-body');
    body.replaceChildren();
    $('empty').hidden = users.length > 0;
    $('count').textContent = users.length + (users.length === 1 ? ' usuario' : ' usuarios');

    users.forEach(function (u) {
      var row = document.createElement('tr');
      row.dataset.username = u.username;
      textCell(row, u.name);
      textCell(row, u.username);
      textCell(row, u.email || '—');

      var roleCell = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = u.role === 'admin' ? 'badge badge-admin' : 'badge';
      badge.textContent = u.role;
      roleCell.appendChild(badge);
      row.appendChild(roleCell);

      textCell(row, formatDate(u.created_at));

      var actionsCell = document.createElement('td');
      if (me.role === 'admin') {
        var box = document.createElement('div');
        box.className = 'row-actions';
        box.appendChild(actionButton('Editar', 'Editar ' + u.username, function () { openForm(u); }));
        if (u.id !== me.id) {
          box.appendChild(actionButton('Eliminar', 'Eliminar ' + u.username, function () { askDelete(u); }));
        }
        actionsCell.appendChild(box);
      } else {
        actionsCell.textContent = '—';
      }
      row.appendChild(actionsCell);
      body.appendChild(row);
    });
  }

  async function loadUsers() {
    var q = $('search').value.trim();
    try {
      var data = await api('/api/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
      render(data.users);
    } catch (err) {
      if (err.status === 401) { location.replace('/'); return; }
      flash('No se pudo cargar la lista: ' + err.message, true);
    }
  }

  // ------------------------------------------------------------ formulario crear / editar
  function clearFormErrors() {
    FIELDS.forEach(function (f) { hide($('err-' + f)); });
    hide($('form-error'));
  }

  function openForm(user) {
    editingId = user ? user.id : null;
    form.reset();
    clearFormErrors();
    $('dialog-title').textContent = user ? 'Editar usuario' : 'Nuevo usuario';
    $('password-hint').textContent = user ? 'Déjala vacía para conservar la contraseña actual.' : 'Mínimo 8 caracteres.';
    if (user) {
      $('f-name').value = user.name;
      $('f-username').value = user.username;
      $('f-email').value = user.email || '';
      $('f-role').value = user.role;
    } else {
      $('f-role').value = 'user';
    }
    userDialog.showModal();
    $('f-name').focus();
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearFormErrors();

    var payload = {
      name: $('f-name').value,
      username: $('f-username').value,
      email: $('f-email').value,
      role: $('f-role').value
    };
    var password = $('f-password').value;
    if (!editingId || password) payload.password = password;

    var save = $('save-user');
    save.disabled = true;
    try {
      if (editingId) {
        await api('/api/users/' + editingId, { method: 'PUT', body: payload });
        flash('Usuario actualizado correctamente');
      } else {
        await api('/api/users', { method: 'POST', body: payload });
        flash('Usuario creado correctamente');
      }
      userDialog.close();
      await loadUsers();
    } catch (err) {
      if (err.status === 401) { location.replace('/'); return; }
      var shown = false;
      FIELDS.forEach(function (f) {
        if (err.details && err.details[f]) { show($('err-' + f), err.details[f]); shown = true; }
      });
      if (!shown) show($('form-error'), err.message);
    } finally {
      save.disabled = false;
    }
  });

  $('cancel-form').addEventListener('click', function () { userDialog.close(); });
  $('new-user').addEventListener('click', function () { openForm(null); });

  // ------------------------------------------------------------ eliminar
  function askDelete(user) {
    pendingDelete = user;
    $('confirm-text').textContent =
      '¿Seguro que quieres eliminar a ' + user.name + ' (' + user.username + ')? Esta acción no se puede deshacer.';
    confirmDialog.showModal();
  }

  $('cancel-delete').addEventListener('click', function () {
    pendingDelete = null;
    confirmDialog.close();
  });

  $('confirm-delete').addEventListener('click', async function () {
    if (!pendingDelete) return;
    var target = pendingDelete;
    pendingDelete = null;
    confirmDialog.close();
    try {
      await api('/api/users/' + target.id, { method: 'DELETE' });
      flash('Usuario eliminado correctamente');
      await loadUsers();
    } catch (err) {
      if (err.status === 401) { location.replace('/'); return; }
      flash(err.message, true);
    }
  });

  // ------------------------------------------------------------ búsqueda y sesión
  $('search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadUsers, 250);
  });

  $('logout-btn').addEventListener('click', async function () {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* se ignora */ }
    location.assign('/');
  });

  async function init() {
    try {
      me = (await api('/api/auth/me')).user;
    } catch (err) {
      location.replace('/');
      return;
    }
    $('who').textContent = me.name;
    var badge = $('role-badge');
    badge.textContent = me.role;
    if (me.role === 'admin') badge.classList.add('badge-admin');
    $('new-user').hidden = me.role !== 'admin';
    await loadUsers();
  }

  init();
})();
