(function () {
  'use strict';

  var api = window.App.api;
  var show = window.App.show;
  var hide = window.App.hide;

  var form = document.getElementById('login-form');
  var usernameInput = document.getElementById('username');
  var passwordInput = document.getElementById('password');
  var usernameError = document.getElementById('username-error');
  var passwordError = document.getElementById('password-error');
  var formError = document.getElementById('form-error');
  var button = document.getElementById('submit-btn');

  // Si ya hay una sesión activa, se va directo a la lista de usuarios.
  api('/api/auth/me').then(
    function () { location.replace('/users.html'); },
    function () { /* sin sesión: se queda en el login */ }
  );

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    hide(usernameError);
    hide(passwordError);
    hide(formError);

    var username = usernameInput.value;
    var password = passwordInput.value;
    var valid = true;
    if (!username.trim()) {
      show(usernameError, 'Ingresa tu usuario');
      valid = false;
    }
    if (!password) {
      show(passwordError, 'Ingresa tu contraseña');
      valid = false;
    }
    if (!valid) return;

    button.disabled = true;
    button.textContent = 'Entrando…';
    try {
      await api('/api/auth/login', { method: 'POST', body: { username: username, password: password } });
      location.assign('/users.html');
    } catch (err) {
      show(formError, err.status === 401 ? 'Usuario o contraseña incorrectos' : err.message);
      button.disabled = false;
      button.textContent = 'Iniciar sesión';
    }
  });
})();
