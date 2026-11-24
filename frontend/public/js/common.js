(function () {
  'use strict';

  /** Llama a la API con la cookie de sesión y devuelve el JSON (o lanza un Error con status/details). */
  async function api(path, options) {
    const opts = options || {};
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, init);
    let data = null;
    if (res.status !== 204) {
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
    }
    if (!res.ok) {
      const err = new Error((data && data.message) || 'No se pudo completar la solicitud');
      err.status = res.status;
      err.code = data && data.error;
      err.details = (data && data.details) || {};
      throw err;
    }
    return data;
  }

  function show(element, text) {
    element.textContent = text;
    element.hidden = false;
  }

  function hide(element) {
    element.textContent = '';
    element.hidden = true;
  }

  window.App = { api: api, show: show, hide: hide };
})();
