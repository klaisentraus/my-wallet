/* My Wallet — service worker
   Guarda o app no celular para abrir sem internet.

   A página: primeiro a rede, assim uma atualização chega de imediato.
   Sem internet, usa a cópia guardada.
   Os ícones e o manifest: primeiro o guardado, que quase nunca mudam. */

var CACHE = 'mywallet-v2';
var ASSETS = [
  './',
  './index.html',
  './guia.html',
  './cat.png',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-32.png',
  './icon-maskable.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .catch(function () { /* se faltar alguma coisa, o app funciona online do mesmo jeito */ })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) {
        return Promise.all(ks.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  var esPagina = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').indexOf('text/html') >= 0;

  if (esPagina) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copia); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});


/* =========================================================================
   LEMBRETES

   O servidor manda um push sem conteudo nenhum — so um toque no ombro.
   O texto e montado aqui, com o que esta gravado neste aparelho. O
   servidor nunca fica sabendo quanto voce tem nem o que vence.

   Se qualquer coisa der errado na leitura, ainda assim mostramos algo:
   um push que nao vira notificacao faz o navegador cancelar a inscricao.
   ========================================================================= */

/* preencha os dois depois de publicar o servidor (os mesmos do index.html) */
var PUSH_SERVIDOR = 'https://mywallet-lembretes.mw2026.workers.dev';
var PUSH_CHAVE = 'BCBeo8IDY4lY2wjFd62_dON-l0bs9XsvE-t3rNdnvuWQk9KH0MXdL0MNiFvuKpcrIR0T7PMgXvt92ay-naaeDd0';
var PUSH_TOKEN = 'mw2026';

function lerEstado() {
  return new Promise(function (res) {
    var pronto = false;
    var fim = function (v) { if (!pronto) { pronto = true; res(v); } };
    setTimeout(function () { fim(null); }, 2000);
    try {
      if (!self.indexedDB) return fim(null);
      var r = indexedDB.open('mywallet', 1);
      r.onerror = function () { fim(null); };
      r.onupgradeneeded = function () { try { r.transaction.abort(); } catch (e) {} };
      r.onsuccess = function () {
        try {
          var db = r.result;
          if (!db.objectStoreNames.contains('kv')) return fim(null);
          var g = db.transaction('kv', 'readonly').objectStore('kv').get('state');
          g.onsuccess = function () { fim(g.result || null); };
          g.onerror = function () { fim(null); };
        } catch (e) { fim(null); }
      };
    } catch (e) { fim(null); }
  });
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function diaISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function reais(c) {
  var v = Math.round(Math.abs(c || 0));
  return 'R$ ' + (v / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Uma versao enxuta do que a tela Inicio calcula: aqui so precisa sair
   uma frase. Nao tenta reproduzir o app inteiro de proposito. */
function mensagem(S) {
  if (!S || !S.mov) return null;

  var hoje = new Date();
  var amanha = new Date(hoje.getTime() + 86400000);
  var hojeISO = diaISO(hoje), ym = hojeISO.slice(0, 7);
  var dHoje = hoje.getDate(), dAmanha = amanha.getDate();

  var pagos = {};
  S.mov.forEach(function (m) { if (m.ref && m.refMes === ym) pagos[m.ref] = 1; });

  var hj = [], am = [];
  (S.fijos || []).forEach(function (f) {
    if (pagos[f.id] || !f.dia) return;
    if (+f.dia === dHoje) hj.push(f);
    else if (+f.dia === dAmanha) am.push(f);
  });
  (S.deudas || []).forEach(function (d) {
    if (pagos[d.id] || !d.dia || (d.saldo || 0) <= 0) return;
    var v = { id: d.id, nombre: d.nombre, monto: d.cuota || 0 };
    if (+d.dia === dHoje) hj.push(v);
    else if (+d.dia === dAmanha) am.push(v);
  });

  function frase(lista, quando) {
    if (!lista.length) return null;
    if (lista.length === 1) {
      var u = lista[0];
      return u.nombre + (u.monto ? ' · ' + reais(u.monto) : '') + ' vence ' + quando + '.';
    }
    var t = 0;
    lista.forEach(function (x) { t += (x.monto || 0); });
    return lista.length + ' contas vencem ' + quando + (t ? ' · ' + reais(t) : '') + '.';
  }

  var f = frase(hj, 'hoje');
  if (f) return { t: 'Vence hoje', b: f };
  f = frase(am, 'amanhã');
  if (f) return { t: 'Vence amanhã', b: f };

  var anotouHoje = S.mov.some(function (m) { return (m.creado || '').slice(0, 10) === hojeISO; });
  if (!anotouHoje) return { t: 'My Wallet', b: 'Você não anotou nada hoje. São cinco segundos. 🐾' };

  return { t: 'My Wallet', b: 'Tudo em dia por aqui. 🐾' };
}

self.addEventListener('push', function (e) {
  e.waitUntil(
    lerEstado()
      .then(function (S) { return mensagem(S); })
      .catch(function () { return null; })
      .then(function (m) {
        if (!m) m = { t: 'My Wallet', b: 'Dá uma olhada nas suas contas.' };
        return self.registration.showNotification(m.t, {
          body: m.b,
          icon: './icon-192.png',
          badge: './icon-32.png',
          tag: 'lembrete',
          data: { url: './' }
        });
      })
  );
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ls) {
      for (var i = 0; i < ls.length; i++) {
        if ('focus' in ls[i]) return ls[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

/* o navegador pode trocar o endereco de push sozinho; aqui a gente
   reinscreve e avisa o servidor, senao os lembretes somem em silencio */
self.addEventListener('pushsubscriptionchange', function (e) {
  if (!PUSH_SERVIDOR || !PUSH_CHAVE) return;
  e.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64paraBytes(PUSH_CHAVE)
    }).then(function (nova) {
      return fetch(PUSH_SERVIDOR + '/inscrever', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: PUSH_TOKEN,
          sub: nova.toJSON(),
          fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
          hora: 20
        })
      });
    }).catch(function () {})
  );
});

function b64paraBytes(b64) {
  var s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  var bin = atob(s);
  var u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
