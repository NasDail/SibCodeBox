/* Основная логика автомата. Сессия продолжает идти по expires_at даже без сети. */
(() => {
  'use strict';
  const CFG = window.SCBB_CONFIG;
  const S = window.ScbbShared;
  if (!CFG || !S) {
    document.getElementById('catalogStatus').textContent = 'Не загружена конфигурация автомата. Проверь app-config.js и js/shared.js.';
    return;
  }

  const $ = id => document.getElementById(id);
  const sb = window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } }
  }) : null;

  const state = {
    games: [], index: 0, activeSession: null, rotateTimer: null, clockTimer: null,
    sessionTimer: null, scanRaf: null, cameraStream: null, scanCanvas: null,
    scanBusy: false, isGameRunning: false, lastScore: 0, lastGame: null,
    maintenance: false, swReady: false, serialPort: null, serialReader: null,
    lastSyncAt: null, syncInProgress: false, scoreSubmitting: false
  };

  function setCloud(online, label) {
    const el = $('cloudBadge');
    el.classList.toggle('online', !!online);
    el.classList.toggle('offline', !online);
    el.querySelector('span').textContent = label || (online ? 'Онлайн' : 'Нет интернета');
    $('scannerNetwork').textContent = online ? 'ONLINE' : 'OFFLINE';
    $('scannerNetwork').classList.toggle('offline', !online);
  }

  function toast(message, error = false) {
    const el = $('scannerStatus');
    if (el) {
      el.textContent = message;
      el.style.color = error ? '#ff8792' : '#9be8c9';
      clearTimeout(el._resetTimer);
      el._resetTimer = setTimeout(() => {
        if (!state.activeSession) el.textContent = navigator.onLine ? 'Наведите QR-код на камеру' : 'Для новой сессии нужен интернет';
        el.style.color = '';
      }, 5000);
    }
  }

  function setModal(id, open) { $(id).classList.toggle('hidden', !open); }

  function updateClock() {
    const now = new Date();
    $('clockText').textContent = now.toLocaleString('ru-RU', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function drawParticles() {
    const canvas = $('particles');
    const ctx = canvas.getContext('2d');
    const particles = [];
    let count = 180;
    let w = 0, h = 0;
    function resize() {
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      w = canvas.width = Math.floor(innerWidth * ratio);
      h = canvas.height = Math.floor(innerHeight * ratio);
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
    }
    function makeParticle(randomY = true) {
      return { x: Math.random() * w, y: randomY ? Math.random() * h : h + 8, r: Math.random() * 1.7 + .4,
        vx: (Math.random() - .5) * .22, vy: -(Math.random() * .55 + .12), alpha: Math.random() * .5 + .12, phase: Math.random() * 6.28 };
    }
    function rebuild(nextCount) { count = nextCount; particles.length = 0; for (let i = 0; i < count; i++) particles.push(makeParticle()); }
    function tick() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.phase += .012; p.x += p.vx + Math.sin(p.phase) * .18; p.y += p.vy;
        if (p.y < -10 || p.x < -10 || p.x > w + 10) Object.assign(p, makeParticle(false));
        ctx.globalAlpha = p.alpha * (.4 + (Number(window.CONFIG?.glowIntensity) || 60) / 125);
        ctx.fillStyle = '#8defff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    }
    resize(); rebuild(count); tick();
    addEventListener('resize', resize);
    return { setCount: rebuild };
  }
  const particles = drawParticles();

  async function initServiceWorker() {
    if (!('serviceWorker' in navigator) || !isSecureContext) {
      $('offlineLabel').textContent = 'ОФЛАЙН-КЭШ: НУЖЕН HTTPS';
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register(new URL('./sw.js', location.href), { scope: new URL('./', location.href).pathname });
      await navigator.serviceWorker.ready;
      state.swReady = !!registration;
      $('offlineLabel').textContent = state.swReady ? 'ОФЛАЙН-КЭШ: ГОТОВ' : 'ОФЛАЙН-КЭШ: ОЖИДАНИЕ';
    } catch (error) {
      console.warn('Service Worker:', error);
      $('offlineLabel').textContent = 'ОФЛАЙН-КЭШ: ОШИБКА';
    }
  }

  function fallbackGames() {
    return [
      { id: 'snake', slug: 'snake', title: 'Змейка', genre: 'АРКАДА', developer: 'СибКодБокс', description: 'Собирай яблоки, управляй змейкой и не сталкивайся со стенами или собственным хвостом.', icon_url: './games/snake/icon.png', entry_url: './games/snake/index.html', files_json: [{ path: 'index.html', raw_url: './games/snake/index.html', mime: 'text/html' }, { path: 'icon.png', raw_url: './games/snake/icon.png', mime: 'image/png' }] },
      { id: 'reaction', slug: 'reaction', title: 'Реакция', genre: 'РЕАКЦИЯ', developer: 'СибКодБокс', description: 'Дождись зелёного сигнала и нажми пробел как можно быстрее. Не торопись на красном.', icon_url: './games/reaction/icon.png', entry_url: './games/reaction/index.html', files_json: [{ path: 'index.html', raw_url: './games/reaction/index.html', mime: 'text/html' }, { path: 'icon.png', raw_url: './games/reaction/icon.png', mime: 'image/png' }] },
      { id: 'guess-number', slug: 'guess-number', title: 'Угадай число', genre: 'ЛОГИКА', developer: 'СибКодБокс', description: 'Найди загаданное число от 1 до 100 за минимальное количество попыток.', icon_url: './games/guess-number/icon.png', entry_url: './games/guess-number/index.html', files_json: [{ path: 'index.html', raw_url: './games/guess-number/index.html', mime: 'text/html' }, { path: 'icon.png', raw_url: './games/guess-number/icon.png', mime: 'image/png' }] }
    ];
  }

  function getMime(path, fallback = 'application/octet-stream') {
    const ext = String(path).split('.').pop().toLowerCase();
    return ({ html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', wasm: 'application/wasm', txt: 'text/plain; charset=utf-8', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2' })[ext] || fallback;
  }

  async function cacheGameFiles(game) {
    const slug = game.slug || game.id;
    let files = Array.isArray(game.files_json) ? game.files_json : S.safeJson(game.files_json, []);
    if (!files.length && game.entry_url) files = [{ path: 'index.html', raw_url: game.entry_url, mime: 'text/html' }];
    if (game.icon_url && !files.some(file => file.path === 'icon.png')) files.push({ path: 'icon.png', raw_url: game.icon_url, mime: 'image/png' });
    if (!files.length) throw new Error(`У игры «${game.title}» нет списка файлов`);
    const indexExists = files.some(file => file.path === 'index.html');
    if (!indexExists && game.entry_url) files.unshift({ path: 'index.html', raw_url: game.entry_url, mime: 'text/html' });

    let total = 0;
    for (const file of files) {
      if (!file || !file.path || file.path.split('/').includes('..')) continue;
      const key = `${slug}/${file.path}`;
      let response;
      const localUrl = file.raw_url && file.raw_url.startsWith('./') ? new URL(file.raw_url, location.href).href : file.raw_url;
      const url = localUrl || `https://raw.githubusercontent.com/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/${CFG.GITHUB_BRANCH}/${CFG.GAMES_ROOT}/${slug}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
      try {
        response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${file.path}`);
        const body = await response.arrayBuffer();
        total += body.byteLength;
        if (total > CFG.MAX_GAME_BYTES) throw new Error(`Игра «${game.title}» превышает лимит кэша`);
        await S.idbPut('files', { key, slug, path: file.path, mime: file.mime || getMime(file.path, response.headers.get('content-type') || undefined), body, saved_at: new Date().toISOString() });
      } catch (error) {
        const cached = await S.idbGet('files', key);
        if (!cached) throw error;
      }
    }
    const index = await S.idbGet('files', `${slug}/index.html`);
    if (!index) throw new Error(`Не удалось сохранить index.html игры «${game.title}»`);
    return true;
  }

  async function cacheBundledDemos() {
    const demos = fallbackGames();
    for (const game of demos) {
      try { await cacheGameFiles(game); } catch (error) { console.warn('Демо-кэш:', game.id, error); }
    }
    return demos;
  }

  async function loadCachedCatalog() {
    const row = await S.idbGet('meta', 'catalog');
    if (row && Array.isArray(row.value) && row.value.length) return row.value;
    return [];
  }

  async function syncCatalog(force = false) {
    if (state.syncInProgress) return;
    const cached = await loadCachedCatalog().catch(() => []);
    if (cached.length) {
      state.games = cached;
      renderCarousel();
      $('catalogStatus').textContent = 'Каталог загружен из локального кэша. Проверяем обновления.';
    }
    const lastSync = Number(localStorage.getItem('sib_last_game_sync') || 0);
    state.remoteCatalogRevision = null;
    let revisionChanged = false;
    if (navigator.onLine && sb) {
      try {
        // Проверяем маркер даже до истечения 24 часов: так киоск, бывший офлайн,
        // увидит принудительную синхронизацию, которую он пропустил в Realtime.
        const [{ data: revisionRow }, savedRevision] = await Promise.all([
          sb.from('config').select('value').eq('key', 'catalog_sync_version').maybeSingle(),
          S.idbGet('meta', 'catalog_revision').catch(() => null)
        ]);
        const remoteRevision = String(revisionRow?.value || '1');
        revisionChanged = !savedRevision || String(savedRevision.value) !== remoteRevision;
        if (revisionChanged) state.remoteCatalogRevision = remoteRevision;
      } catch (error) { console.warn('Маркер версии каталога недоступен:', error); }
    }
    const due = force || revisionChanged || !lastSync || Date.now() - lastSync > CFG.SYNC_INTERVAL_MS;
    if (!navigator.onLine || !sb) {
      if (!state.games.length) state.games = await cacheBundledDemos();
      if (!state.games.length) state.games = fallbackGames();
      renderCarousel();
      $('catalogStatus').textContent = state.games.length ? 'Нет сети. Доступны ранее сохранённые игры; новые QR-сессии не принимаются.' : 'Нет подключения к интернету.';
      return;
    }
    if (!due && cached.length) {
      state.lastSyncAt = lastSync;
      $('catalogStatus').textContent = `Каталог синхронизирован ${S.formatDate(lastSync)}. Следующая проверка — через 24 часа.`;
      updateSyncInfo();
      return;
    }

    state.syncInProgress = true;
    setCloud(true, 'Синхронизация');
    try {
      const { data, error } = await sb.from('games')
        .select('id,slug,title,description,genre,developer,icon_url,repo_url,entry_url,files_json,created_at,updated_at')
        .eq('is_active', true).order('created_at', { ascending: true });
      if (error) throw error;
      const remoteGames = (data || []).map(game => ({ ...game, slug: game.slug || game.id }));
      if (!remoteGames.length) throw new Error('В таблице games пока нет активных игр');

      const ready = [];
      for (const game of remoteGames) {
        try {
          await cacheGameFiles(game);
          ready.push(game);
        } catch (error) {
          console.warn('Не удалось кэшировать игру', game.id, error);
          const hasCachedIndex = await S.idbGet('files', `${game.slug || game.id}/index.html`);
          if (hasCachedIndex) ready.push(game);
        }
      }
      if (!ready.length) throw new Error('Не удалось загрузить ни одной игры');
      await S.idbPut('meta', { key: 'catalog', value: ready, saved_at: new Date().toISOString() });
      if (state.remoteCatalogRevision) await S.idbPut('meta', { key: 'catalog_revision', value: state.remoteCatalogRevision });
      else {
        const revision = await sb.from('config').select('value').eq('key', 'catalog_sync_version').maybeSingle();
        if (!revision.error && revision.data?.value) await S.idbPut('meta', { key: 'catalog_revision', value: String(revision.data.value) });
      }
      localStorage.setItem('sib_last_game_sync', String(Date.now()));
      state.games = ready;
      state.lastSyncAt = Date.now();
      renderCarousel();
      $('catalogStatus').textContent = `Синхронизировано игр: ${ready.length}. Игры и файлы сохранены для офлайн-запуска.`;
      setCloud(true, 'Онлайн');
      updateSyncInfo();
    } catch (error) {
      console.error('Синхронизация каталога:', error);
      if (!state.games.length) state.games = cached.length ? cached : await cacheBundledDemos();
      if (!state.games.length) state.games = fallbackGames();
      renderCarousel();
      $('catalogStatus').textContent = `Синхронизация не выполнена: ${error.message}. Используется локальная копия.`;
      setCloud(false, 'Нет синхронизации');
    } finally {
      state.syncInProgress = false;
    }
  }

  function updateSyncInfo() {
    const value = localStorage.getItem('sib_last_game_sync');
    $('syncInfo').textContent = `Последняя синхронизация: ${value ? S.formatDate(Number(value)) : 'ещё не выполнялась'}`;
  }

  function gameIconUrl(game) {
    const slug = game.slug || game.id;
    const cached = S.idbGet('files', `${slug}/icon.png`);
    return cached;
  }

  function renderCarousel() {
    const rail = $('carouselRail');
    rail.replaceChildren();
    if (!state.games.length) {
      $('heroTitle').textContent = 'Каталог недоступен';
      $('heroDescription').textContent = 'Подключите автомат к интернету для первой синхронизации каталога.';
      $('heroGenre').textContent = 'ОЖИДАНИЕ';
      $('heroDeveloper').textContent = 'СИБКОДБОКС';
      $('catalogCount').textContent = '0';
      return;
    }
    state.index = Math.max(0, Math.min(state.index, state.games.length - 1));
    state.games.forEach((game, index) => {
      const card = document.createElement('article');
      card.className = `game-card${index === state.index ? ' selected' : ''}`;
      card.setAttribute('aria-label', game.title);
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      const slugForIcon = game.slug || game.id;
      image.src = new URL(`__scbb_offline__/${encodeURIComponent(slugForIcon)}/icon.png`, location.href).href;
      image.onerror = () => {
        const remoteIcon = game.icon_url || game.iconUrl || '';
        if (remoteIcon && image.src !== remoteIcon) { image.onerror = () => image.remove(); image.src = remoteIcon; }
        else image.remove();
      };
      const fallback = document.createElement('div');
      fallback.className = 'card-fallback';
      fallback.textContent = game.emoji || '🎮';
      const overlay = document.createElement('div');
      overlay.className = 'card-overlay';
      const title = document.createElement('div');
      title.className = 'card-title'; title.textContent = game.title || 'Без названия';
      const number = document.createElement('div');
      number.className = 'card-num'; number.textContent = `${String(index + 1).padStart(2, '0')}`;
      card.append(fallback, image, overlay, number, title);
      rail.appendChild(card);
    });
    const active = rail.children[state.index];
    const activeCenter = active.offsetLeft + active.offsetWidth / 2;
    const viewportCenter = $('carouselRail').parentElement.clientWidth / 2;
    rail.style.transform = `translateX(${Math.max(-rail.scrollWidth + viewportCenter * 2, Math.min(0, viewportCenter - activeCenter))}px)`;
    const game = state.games[state.index];
    $('heroTitle').textContent = game.title || 'Без названия';
    $('heroDescription').textContent = game.description || game.desc || 'Описание игры пока не добавлено.';
    $('heroGenre').textContent = String(game.genre || 'АРКАДА').toUpperCase();
    $('heroDeveloper').textContent = game.developer || game.author || 'Не указан разработчик';
    $('carouselIndex').textContent = `${String(state.index + 1).padStart(2, '0')} / ${String(state.games.length).padStart(2, '0')}`;
    $('catalogCount').textContent = String(state.games.length);
    updateRecordsFilter();
  }

  function moveGame(delta) {
    if (!state.activeSession || state.isGameRunning || !state.games.length) return;
    state.index = (state.index + delta + state.games.length) % state.games.length;
    renderCarousel();
    SoundMaster?.focus?.();
  }

  function startAutoRotate() {
    stopAutoRotate();
    state.rotateTimer = setInterval(() => {
      if (state.activeSession || state.isGameRunning || state.games.length < 2) return;
      state.index = (state.index + 1) % state.games.length;
      renderCarousel();
    }, 4300);
  }
  function stopAutoRotate() { if (state.rotateTimer) clearInterval(state.rotateTimer); state.rotateTimer = null; }

  function parseQr(raw) {
    const text = String(raw || '').trim();
    try {
      const payload = JSON.parse(text);
      if (payload && payload.type === 'scbb-session' && typeof payload.token === 'string') return payload;
    } catch (_) { /* QR не JSON */ }
    return { type: 'scbb-session', token: text };
  }

  async function redeemQr(raw) {
    if (state.scanBusy || state.activeSession) return;
    if (!sb) { toast('Нет библиотеки облачного соединения. QR недоступен.', true); return; }
    if (!navigator.onLine) { toast('Нет интернета. Новые QR-сессии принимаются только онлайн.', true); return; }
    const payload = parseQr(raw);
    if (!payload.token || payload.token.length < 32) { toast('QR-код не распознан.', true); return; }
    state.scanBusy = true;
    toast('Проверяем QR-код…');
    try {
      const { data, error } = await sb.functions.invoke('kiosk-api', { body: { action: 'redeem_session', token: payload.token } });
      if (error) throw new Error(await readFunctionError(error));
      if (!data?.ok) throw new Error(data?.error || 'QR-код не принят');
      state.activeSession = {
        id: data.session_id,
        session_key: data.session_key,
        expires_at: data.expires_at,
        owner_name: data.owner_name || 'Игрок'
      };
      sessionStorage.setItem('scbb_active_session', JSON.stringify(state.activeSession));
      stopAutoRotate();
      $('scannerDock').classList.add('hidden');
      $('sessionHud').classList.remove('hidden');
      $('heroTitle').textContent = 'Сессия активирована';
      $('heroDescription').textContent = 'Выбери игру стрелками и нажми Enter. Приятной игры!';
      toast(`Добро пожаловать, ${state.activeSession.owner_name}!`);
      SoundMaster?.secretUnlock?.();
      startSessionTicker();
      updateSessionTimer();
    } catch (error) {
      console.error('QR redeem:', error);
      toast(error.message || 'Не удалось проверить QR-код.', true);
      SoundMaster?.error?.();
    } finally {
      state.scanBusy = false;
    }
  }

  async function readFunctionError(error) {
    try {
      const context = error.context;
      if (context && typeof context.json === 'function') {
        const body = await context.json();
        return body.error || body.message || error.message;
      }
    } catch (_) {}
    return error.message || 'Ошибка серверной функции';
  }

  function restoreSession() {
    const saved = S.safeJson(sessionStorage.getItem('scbb_active_session'), null);
    if (!saved || !saved.session_key || !saved.expires_at) return;
    if (new Date(saved.expires_at).getTime() <= Date.now()) {
      sessionStorage.removeItem('scbb_active_session');
      return;
    }
    state.activeSession = saved;
    stopAutoRotate();
    $('scannerDock').classList.add('hidden');
    $('sessionHud').classList.remove('hidden');
    updateSessionTimer();
  }

  function updateSessionTimer() {
    if (!state.activeSession) return;
    const expiresAt = new Date(state.activeSession.expires_at).getTime();
    const remaining = expiresAt - Date.now();
    $('sessionTimer').textContent = S.formatRemaining(remaining);
    $('runningTimer').textContent = S.formatRemaining(remaining);
    $('sessionTimer').classList.toggle('warn', remaining <= 30000);
    if (remaining <= 0) endSession('Время сессии истекло.');
  }

  async function validateActiveSession() {
    if (!state.activeSession || !navigator.onLine || !sb) return;
    try {
      const { data, error } = await sb.functions.invoke('kiosk-api', {
        body: { action: 'check_session', session_key: state.activeSession.session_key }
      });
      if (error) throw new Error(await readFunctionError(error));
      if (!data?.active) endSession('Сессия отозвана оператором или завершена на сервере.');
    } catch (error) {
      // Ошибка сети не сбрасывает локальную сессию: таймер продолжает идти по expires_at.
      console.warn('Проверка сессии:', error);
    }
  }

  async function endSession(reason = 'Сессия завершена.') {
    if (!state.activeSession) return;
    const old = state.activeSession;
    state.activeSession = null;
    sessionStorage.removeItem('scbb_active_session');
    if (state.sessionTimer) clearInterval(state.sessionTimer);
    state.sessionTimer = null;
    if (state.isGameRunning) exitGame(true);
    setModal('resultModal', false);
    $('sessionHud').classList.add('hidden');
    $('scannerDock').classList.remove('hidden');
    if (state.cameraStream && navigator.onLine) scanFrame();
    state.lastScore = 0; state.lastGame = null;
    $('heroDescription').textContent = reason;
    startAutoRotate();
    if (navigator.onLine && sb) {
      sb.functions.invoke('kiosk-api', { body: { action: 'end_session', session_key: old.session_key } }).catch(() => {});
    }
  }

  function startSessionTicker() {
    if (state.sessionTimer) clearInterval(state.sessionTimer);
    state.sessionTimer = setInterval(updateSessionTimer, 250);
    updateSessionTimer();
  }

  async function startCamera() {
    if (!navigator.onLine) {
      toast('Для сканирования нового QR нужен интернет.', true);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Камера недоступна. Открой автомат через HTTPS.', true);
      return;
    }
    if (state.cameraStream) return;
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const video = $('qrVideo');
      video.srcObject = state.cameraStream;
      await video.play();
      video.classList.add('active');
      $('scannerPlaceholder').style.display = 'none';
      $('scannerPreview')?.classList.add('scanning');
      document.querySelector('.scanner-preview').classList.add('scanning');
      $('btnCamera').textContent = 'КАМЕРА ВКЛЮЧЕНА';
      $('scannerStatus').textContent = 'Наведите QR-код в рамку';
      if (!state.scanCanvas) state.scanCanvas = document.createElement('canvas');
      scanFrame();
    } catch (error) {
      console.warn('Camera permission:', error);
      toast('Разреши доступ к камере в настройках браузера.', true);
      $('btnCamera').textContent = 'ПОВТОРИТЬ';
    }
  }

  function scanFrame() {
    if (!state.cameraStream || state.activeSession) return;
    const video = $('qrVideo');
    if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA && window.jsQR) {
      const canvas = state.scanCanvas;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      if (qr?.data) {
        redeemQr(qr.data);
      }
    }
    state.scanRaf = requestAnimationFrame(scanFrame);
  }

  async function buildSandboxedGameDocument(slug) {
    // Игры остаются в sandbox с непрозрачным origin. Поэтому не выдаём им доступ
    // к IndexedDB автомата и не добавляем allow-same-origin. Ресурсы встраиваются
    // в srcdoc как data URL; это позволяет работать офлайн и сохраняет изоляцию.
    const rows = await S.idbGetByPrefix('files', `${slug}/`);
    if (!rows.length) throw new Error('Файлы игры не найдены в IndexedDB. Подключитесь к интернету и синхронизируйте каталог.');
    const files = new Map(rows.map(row => [String(row.path || row.key.slice(slug.length + 1)).replace(/^\/+/, ''), row]));
    if (!files.has('index.html')) throw new Error('index.html отсутствует в офлайн-кэше.');

    const toBase64 = row => S.bytesToBase64(new Uint8Array(row.body));
    const mimeFor = path => ({ html:'text/html;charset=utf-8', htm:'text/html;charset=utf-8', css:'text/css;charset=utf-8', js:'text/javascript;charset=utf-8', mjs:'text/javascript;charset=utf-8', json:'application/json', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', svg:'image/svg+xml', gif:'image/gif', mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', mp4:'video/mp4', wasm:'application/wasm', txt:'text/plain;charset=utf-8', woff:'font/woff', woff2:'font/woff2' })[String(path).split('.').pop().toLowerCase()] || 'application/octet-stream';
    const pseudoOrigin = 'https://scbb-offline.invalid';
    const slugPath = encodeURIComponent(slug);
    const packageBase = `${pseudoOrigin}/${slugPath}/`;

    function resolvePath(fromPath, reference) {
      const raw = String(reference || '').trim();
      if (!raw || raw.startsWith('#') || /^(data:|blob:|javascript:|mailto:|tel:|https?:|\/\/)/i.test(raw)) return null;
      try {
        let url;
        if (raw.startsWith('/')) url = new URL(`${pseudoOrigin}/${slugPath}/${raw.replace(/^\/+/, '')}`);
        else url = new URL(raw, `${pseudoOrigin}/${slugPath}/${fromPath}`);
        if (url.origin !== pseudoOrigin) return null;
        const prefix = `/${slugPath}/`;
        if (!url.pathname.startsWith(prefix)) return null;
        return decodeURIComponent(url.pathname.slice(prefix.length));
      } catch (_) { return null; }
    }

    function rowDataUri(row) {
      const mime = row.mime || mimeFor(row.path);
      return `data:${mime};base64,${toBase64(row)}`;
    }

    const cssStack = new Set();
    function rewriteCss(cssText, cssPath) {
      let output = String(cssText || '');
      output = output.replace(/@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?\s*;/gi, (match, quote, ref) => {
        const childPath = resolvePath(cssPath, ref);
        const child = childPath && files.get(childPath);
        if (!child || !/\.css$/i.test(childPath) || cssStack.has(childPath)) return match;
        cssStack.add(childPath);
        const nested = rewriteCss(new TextDecoder().decode(child.body), childPath);
        cssStack.delete(childPath);
        const data = `data:text/css;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(nested)))}`;
        return `@import url("${data}");`;
      });
      output = output.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, quote, ref) => {
        const childPath = resolvePath(cssPath, ref);
        const child = childPath && files.get(childPath);
        return child ? `url("${rowDataUri(child)}")` : match;
      });
      return output;
    }

    const htmlRow = files.get('index.html');
    const sourceHtml = new TextDecoder().decode(htmlRow.body);
    const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
    doc.querySelectorAll('base').forEach(node => node.remove());
    const base = doc.createElement('base'); base.href = packageBase; doc.head.prepend(base);

    // Внешние таблицы стилей преобразуем в inline <style>, чтобы их url(...) тоже
    // стали независимыми от сети и от service worker внутри opaque-origin iframe.
    for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
      const path = resolvePath('index.html', link.getAttribute('href'));
      const row = path && files.get(path);
      if (!row) continue;
      const style = doc.createElement('style');
      if (link.media) style.media = link.media;
      style.textContent = rewriteCss(new TextDecoder().decode(row.body), path);
      link.replaceWith(style);
    }
    doc.querySelectorAll('style').forEach(style => { style.textContent = rewriteCss(style.textContent, 'index.html'); });

    // Переписываем ресурсы, заданные в HTML-атрибутах. Ссылки навигации не трогаем.
    for (const element of [...doc.querySelectorAll('*')]) {
      if (element.hasAttribute('style')) element.setAttribute('style', rewriteCss(element.getAttribute('style'), 'index.html'));
      for (const attr of ['src', 'href', 'poster', 'data', 'xlink:href']) {
        if (!element.hasAttribute(attr) || (element.tagName === 'A' && attr === 'href')) continue;
        const original = element.getAttribute(attr);
        const path = resolvePath('index.html', original);
        const row = path && files.get(path);
        if (row) {
          if (element.tagName === 'LINK' && /stylesheet/i.test(element.rel || '')) continue;
          element.setAttribute(attr, rowDataUri(row));
        }
      }
      if (element.hasAttribute('srcset')) {
        const candidates = element.getAttribute('srcset').split(',').map(part => {
          const match = part.trim().match(/^(\S+)(\s+.*)?$/);
          if (!match) return part;
          const path = resolvePath('index.html', match[1]);
          const row = path && files.get(path);
          return row ? `${rowDataUri(row)}${match[2] || ''}` : part;
        });
        element.setAttribute('srcset', candidates.join(', '));
      }
    }

    // Динамические fetch('data.json') и присвоения src='image.png' тоже ищут
    // файлы в упакованном архиве, а не в сети. Для fetch отдаём локальный Response.
    const payloads = {};
    for (const [path, row] of files) payloads[path] = { b64: toBase64(row), mime: row.mime || mimeFor(path) };
    const bootstrap = doc.createElement('script');
    bootstrap.textContent = String.raw`(()=>{
      const P=${JSON.stringify(payloads)};
      const O=${JSON.stringify(pseudoOrigin)};
      const B=${JSON.stringify(packageBase)};
      function pathOf(v){
        try {
          const raw=typeof v==='string'?v:(v&&v.url)||'';
          if(!raw || /^(data:|blob:|javascript:|mailto:|tel:|https?:|\/\/)/i.test(raw)) return null;
          const u=new URL(raw,B);
          if(u.origin!==O) return null;
          const root=new URL(B).pathname;
          const p=decodeURIComponent(u.pathname.startsWith(root)?u.pathname.slice(root.length):u.pathname.replace(/^\/+/,''));
          return P[p]?p:null;
        } catch(_) { return null; }
      }
      function bytes(p){const s=atob(P[p].b64),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a;}
      function uri(p){return 'data:'+P[p].mime+';base64,'+P[p].b64;}
      const nativeFetch=window.fetch.bind(window);
      window.fetch=(input,init)=>{
        const p=pathOf(input);
        if(!p) return nativeFetch(input,init);
        return Promise.resolve(new Response(bytes(p),{status:200,headers:{'Content-Type':P[p].mime}}));
      };
      const nativeSet=Element.prototype.setAttribute;
      Element.prototype.setAttribute=function(name,value){
        if(['src','href','poster','data','xlink:href'].includes(String(name).toLowerCase())){const p=pathOf(value);if(p)value=uri(p);}
        return nativeSet.call(this,name,value);
      };
      window.addEventListener('keydown',event=>{if(event.key==='Escape'){parent.postMessage({type:'SCBB_GAME_ESCAPE'},'*');}else if(event.key.toLowerCase()==='f'){event.preventDefault();parent.postMessage({type:'SCBB_FULLSCREEN'},'*');}else if(event.key.toLowerCase()==='m'){parent.postMessage({type:'SCBB_TOGGLE_MUTE'},'*');}});
      for(const [Ctor,prop] of [[window.HTMLImageElement,'src'],[window.HTMLScriptElement,'src'],[window.HTMLAudioElement,'src'],[window.HTMLSourceElement,'src'],[window.HTMLVideoElement,'src'],[window.HTMLLinkElement,'href']]){if(!Ctor)continue;const d=Object.getOwnPropertyDescriptor(Ctor.prototype,prop);if(d&&d.get&&d.set)Object.defineProperty(Ctor.prototype,prop,{configurable:true,enumerable:d.enumerable,get:d.get,set(value){const p=pathOf(value);return d.set.call(this,p?uri(p):value);}});}
      if(window.CSSStyleDeclaration){
        const nativeProp=CSSStyleDeclaration.prototype.setProperty;
        CSSStyleDeclaration.prototype.setProperty=function(name,value,priority){
          value=String(value).replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi,(m,q,ref)=>{const p=pathOf(ref);return p?'url("'+uri(p)+'")':m;});
          return nativeProp.call(this,name,value,priority);
        };
      }
    })();`;
    doc.head.insertBefore(bootstrap, base.nextSibling);
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }

  async function launchGame() {
    if (!state.activeSession || state.isGameRunning || !state.games[state.index]) return;
    if (new Date(state.activeSession.expires_at).getTime() <= Date.now()) { endSession('Время сессии истекло.'); return; }
    const game = state.games[state.index];
    const slug = game.slug || game.id;
    const cachedIndex = await S.idbGet('files', `${slug}/index.html`).catch(() => null);
    if (!cachedIndex && !navigator.onLine) {
      toast('Игра не сохранена для офлайн-запуска. Подключи интернет для синхронизации.', true);
      return;
    }
    state.lastScore = 0;
    state.lastGame = game;
    state.isGameRunning = true;
    $('runningGameTitle').textContent = game.title || 'ИГРА';
    $('gameOverlay').classList.remove('hidden');
    $('scannerDock').classList.add('hidden');
    SoundMaster?.launch?.();
    SoundMaster?.pauseBGM?.();
    const frame = $('gameFrame');
    if (cachedIndex) {
      try {
        frame.removeAttribute('src');
        frame.srcdoc = await buildSandboxedGameDocument(slug);
      } catch (error) {
        state.isGameRunning = false;
        $('gameOverlay').classList.add('hidden');
        $('scannerDock').classList.add('hidden');
        SoundMaster?.resumeBGM?.();
        toast(error.message || 'Не удалось подготовить игру.', true);
        return;
      }
    } else {
      frame.srcdoc = '';
      frame.src = game.entry_url || game.url || 'about:blank';
    }
    setTimeout(() => { try { frame.contentWindow.focus(); } catch (_) {} }, 350);
  }

  function exitGame(expired = false) {
    if (!state.isGameRunning) return;
    state.isGameRunning = false;
    $('gameFrame').srcdoc = '';
    $('gameFrame').src = 'about:blank';
    $('gameOverlay').classList.add('hidden');
    SoundMaster?.back?.();
    SoundMaster?.resumeBGM?.();
    if (!expired && state.activeSession && state.lastScore > 0) showResultModal();
    else if (state.activeSession) $('scannerDock').classList.add('hidden');
    state.lastGame = state.lastGame || null;
  }

  function showResultModal() {
    $('resultScore').textContent = String(state.lastScore);
    $('resultGameName').textContent = state.lastGame?.title || 'Игра';
    $('resultNick').value = state.activeSession?.owner_name || '';
    $('resultStatus').textContent = '';
    setModal('resultModal', true);
    setTimeout(() => $('resultNick').focus(), 50);
  }

  async function saveRecord() {
    if (state.scoreSubmitting) return;
    const nick = $('resultNick').value.trim();
    const normalized = S.normalizeNick(nick);
    if (nick.length < 2 || nick.length > 20 || normalized.length < 2) {
      $('resultStatus').textContent = 'Ник должен содержать от 2 до 20 символов.';
      return;
    }
    const localBadWord = (CFG.DEFAULT_STOP_WORDS || []).some(word => normalized.includes(S.normalizeNick(word)));
    if (localBadWord) {
      $('resultStatus').textContent = 'Этот ник не подходит. Выбери другой.';
      return;
    }
    if (!navigator.onLine || !sb) {
      $('resultStatus').textContent = 'Нет интернета. Рекорд не сохранён; повторной отправки офлайн нет.';
      return;
    }
    if (!state.activeSession || new Date(state.activeSession.expires_at).getTime() <= Date.now()) {
      $('resultStatus').textContent = 'Сессия завершилась. Рекорд не сохранён.';
      return;
    }
    state.scoreSubmitting = true;
    $('btnSaveRecord').disabled = true;
    try {
      const { data, error } = await sb.functions.invoke('kiosk-api', {
        body: { action: 'submit_record', session_key: state.activeSession.session_key, game_id: state.lastGame.id, nick, score: Math.max(0, Math.floor(Number(state.lastScore) || 0)) }
      });
      if (error) throw new Error(await readFunctionError(error));
      if (!data?.ok) throw new Error(data?.error || 'Рекорд не сохранён');
      $('resultStatus').style.color = 'var(--green)';
      $('resultStatus').textContent = `Рекорд сохранён. Место: #${data.rank || '—'}.`;
      setTimeout(() => { setModal('resultModal', false); loadRecords(); }, 1200);
    } catch (error) {
      $('resultStatus').style.color = '#ff8792';
      $('resultStatus').textContent = error.message || 'Не удалось сохранить рекорд.';
    } finally {
      state.scoreSubmitting = false;
      $('btnSaveRecord').disabled = false;
    }
  }

  async function loadRecords() {
    const filter = $('recordsGameFilter').value || 'all';
    const list = $('recordsList');
    list.replaceChildren();
    if (!navigator.onLine || !sb) { list.textContent = 'Таблица рекордов доступна только онлайн.'; return; }
    try {
      let query = sb.from('records').select('id,game_id,nick,player_name,score,created_at').eq('hidden', false).eq('banned', false).order('score', { ascending: false }).limit(100);
      if (filter !== 'all') query = query.eq('game_id', filter);
      const { data, error } = await query;
      if (error) throw error;
      const gamesById = new Map(state.games.map(game => [game.id, game.title]));
      if (!data?.length) { list.textContent = 'Рекордов пока нет.'; list.className = 'records-list empty-state'; return; }
      list.className = 'records-list';
      data.forEach((record, index) => {
        const row = document.createElement('div'); row.className = 'record-row';
        const rank = document.createElement('div'); rank.className = 'record-rank'; rank.textContent = `#${index + 1}`;
        const info = document.createElement('div');
        const nick = document.createElement('div'); nick.className = 'record-name'; nick.textContent = record.nick || record.player_name || 'Игрок';
        const game = document.createElement('div'); game.className = 'record-game'; game.textContent = gamesById.get(record.game_id) || record.game_id;
        info.append(nick, game);
        const score = document.createElement('div'); score.className = 'record-score'; score.textContent = String(record.score);
        const date = document.createElement('div'); date.className = 'record-date'; date.textContent = S.formatDate(record.created_at);
        row.append(rank, info, score, date); list.appendChild(row);
      });
    } catch (error) {
      list.textContent = `Не удалось загрузить рекорды: ${error.message}`;
    }
  }

  function updateRecordsFilter() {
    const select = $('recordsGameFilter');
    const current = select.value || 'all';
    select.replaceChildren(new Option('Все игры', 'all'));
    state.games.forEach(game => select.add(new Option(game.title, game.id)));
    select.value = [...select.options].some(option => option.value === current) ? current : 'all';
  }

  async function checkMaintenance() {
    if (!navigator.onLine || !sb) return;
    try {
      const { data, error } = await sb.from('config').select('key,value').in('key', ['maintenance_mode', 'maintenance_message']);
      if (error) throw error;
      const config = Object.fromEntries((data || []).map(row => [row.key, row.value]));
      const active = config.maintenance_mode === 'on';
      state.maintenance = active;
      $('maintenanceMessage').textContent = config.maintenance_message || 'Автомат временно недоступен.';
      $('maintenanceOverlay').classList.toggle('hidden', !active);
      if (active) {
        if (state.isGameRunning) exitGame(true);
        if (state.activeSession) endSession('Автомат переведён в режим технических работ.');
        SoundMaster?.pauseBGM?.();
      } else SoundMaster?.resumeBGM?.();
    } catch (error) { console.warn('Maintenance check:', error); }
  }

  function subscribeRealtime() {
    if (!sb) return;
    sb.channel('scbb-kiosk-catalog')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => syncCatalog(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config', filter: 'key=eq.catalog_sync_version' }, () => syncCatalog(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config', filter: 'key=eq.maintenance_mode' }, checkMaintenance)
      .subscribe();
  }

  function keyboardHandler(event) {
    if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) {
      if (event.key === 'Escape') { event.target.blur(); setModal('resultModal', false); }
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
      return;
    }
    if (event.key.toLowerCase() === 'm') { SoundMaster?.toggleMute?.(); return; }
    if (event.key === 'F2') { setModal('settingsModal', true); return; }
    if (event.key.toLowerCase() === 'r' && !state.isGameRunning) { setModal('recordsModal', true); loadRecords(); return; }
    if (event.key === 'Escape') {
      if (!$('recordsModal').classList.contains('hidden')) { setModal('recordsModal', false); return; }
      if (!$('settingsModal').classList.contains('hidden')) { setModal('settingsModal', false); return; }
      if (!$('resultModal').classList.contains('hidden')) { setModal('resultModal', false); return; }
      if (state.isGameRunning) exitGame();
      return;
    }
    if (state.isGameRunning || $('maintenanceOverlay').classList.contains('hidden') === false) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveGame(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); moveGame(1); }
    else if (event.key === 'Enter') { event.preventDefault(); if (state.activeSession) launchGame(); }
  }

  function applySettingsToUi() {
    const values = {
      settingBgm: CONFIG.bgmVolume ?? 40,
      settingSfx: CONFIG.sfxVolume ?? 70,
      settingBgmStyle: CONFIG.bgmStyle || 'ambient',
      settingSfxStyle: CONFIG.sfxStyle || 'arcade',
      settingTempo: CONFIG.bgmTempo ?? 5.5,
      settingCutoff: CONFIG.filterCutoff ?? 2400,
      settingBass: CONFIG.bassBoost ?? 50,
      settingReverb: CONFIG.reverb ?? 35,
      settingEcho: CONFIG.echo ?? 0,
      settingChimes: CONFIG.chimesEnabled === false ? 'off' : 'on',
      settingAurora: CONFIG.auroraEnabled === false ? 'off' : 'on',
      settingBlur: CONFIG.blurPx ?? 48,
      settingGlow: CONFIG.glowIntensity ?? 60,
      settingParticles: CONFIG.particleCount ?? 180,
      settingBaud: CONFIG.baudrate ?? 9600
    };
    for (const [id, value] of Object.entries(values)) if ($(id)) $(id).value = String(value);
    const aurora = document.querySelector('.aurora');
    if (aurora) {
      aurora.style.display = CONFIG.auroraEnabled === false ? 'none' : '';
      aurora.style.filter = `blur(${Number(CONFIG.blurPx ?? 48)}px)`;
    }
  }

  function initSettings() {
    const controls = [
      ['settingBgm', value => SoundMaster?.setBgmVolume?.(Number(value) / 100)],
      ['settingSfx', value => SoundMaster?.setSfxVolume?.(Number(value) / 100)],
      ['settingTempo', value => { CONFIG.bgmTempo = Number(value); CONFIG.save(); if (SoundMaster?.ctx && SoundMaster.isBgmPlaying) SoundMaster.startBGM(CONFIG.bgmStyle); }],
      ['settingCutoff', value => SoundMaster?.setFilterCutoff?.(Number(value))],
      ['settingBass', value => SoundMaster?.setBassBoost?.(Number(value))],
      ['settingReverb', value => SoundMaster?.setReverb?.(Number(value))],
      ['settingEcho', value => SoundMaster?.setEcho?.(Number(value))],
      ['settingChimes', value => { CONFIG.chimesEnabled = value === 'on'; CONFIG.save(); }],
      ['settingAurora', value => { CONFIG.auroraEnabled = value === 'on'; CONFIG.save(); const el = document.querySelector('.aurora'); if (el) el.style.display = CONFIG.auroraEnabled ? '' : 'none'; }],
      ['settingBlur', value => { CONFIG.blurPx = Number(value); CONFIG.save(); const el = document.querySelector('.aurora'); if (el) el.style.filter = `blur(${CONFIG.blurPx}px)`; }],
      ['settingGlow', value => { CONFIG.glowIntensity = Number(value); CONFIG.save(); }],
      ['settingBgmStyle', value => { CONFIG.bgmStyle = value; CONFIG.save(); if (SoundMaster?.ctx) SoundMaster.startBGM(value); }],
      ['settingSfxStyle', value => { CONFIG.sfxStyle = value; CONFIG.save(); }],
      ['settingParticles', value => { CONFIG.particleCount = Number(value); CONFIG.save(); particles.setCount(CONFIG.particleCount); }],
      ['settingBaud', value => { CONFIG.baudrate = Number(value); CONFIG.save(); }]
    ];
    for (const [id, callback] of controls) {
      const input = $(id);
      if (!input) continue;
      input.addEventListener('input', () => callback(input.value));
      input.addEventListener('change', () => callback(input.value));
    }
    applySettingsToUi();

    $('btnExportBackup').addEventListener('click', () => {
      const backup = {
        version: 12,
        localConfig: Object.fromEntries(Object.entries(CONFIG).filter(([, value]) => typeof value !== 'function')),
        lastSync: localStorage.getItem('sib_last_game_sync'),
        cachedGames: state.games.map(game => ({ id: game.id, title: game.title }))
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `sibkodbox-settings-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    $('btnImportBackup').addEventListener('click', () => $('backupFile').click());
    $('backupFile').addEventListener('change', async () => {
      const file = $('backupFile').files?.[0];
      if (!file) return;
      try {
        const backup = JSON.parse(await file.text());
        const source = backup.localConfig && typeof backup.localConfig === 'object' ? backup.localConfig : backup;
        const allowed = ['bgmStyle','sfxStyle','bgmTempo','bgmVolume','sfxVolume','filterCutoff','bassBoost','reverb','echo','chimesEnabled','glowIntensity','baudrate','auroraEnabled','blurPx','particleCount'];
        for (const key of allowed) {
          const value = source[key];
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') CONFIG[key] = value;
        }
        CONFIG.save();
        if (SoundMaster?.ctx) {
          SoundMaster.setBgmVolume(Number(CONFIG.bgmVolume ?? 40) / 100);
          SoundMaster.setSfxVolume(Number(CONFIG.sfxVolume ?? 70) / 100);
          SoundMaster.setFilterCutoff(Number(CONFIG.filterCutoff ?? 2400));
          SoundMaster.setBassBoost(Number(CONFIG.bassBoost ?? 50));
          SoundMaster.setReverb(Number(CONFIG.reverb ?? 35));
          SoundMaster.setEcho(Number(CONFIG.echo ?? 0));
          if (SoundMaster.isBgmPlaying) SoundMaster.startBGM(CONFIG.bgmStyle || 'ambient');
        }
        applySettingsToUi();
        toast('Настройки импортированы.');
      } catch (error) { toast(`Не удалось импортировать JSON: ${error.message}`, true); }
      finally { $('backupFile').value = ''; }
    });
  }

  async function connectArduino() {
    if (!('serial' in navigator)) { $('hardwareStatus').textContent = 'Arduino: Web Serial не поддерживается этим браузером'; return; }
    try {
      state.serialPort = await navigator.serial.requestPort();
      await state.serialPort.open({ baudRate: Number(window.CONFIG?.baudrate) || 9600 });
      $('hardwareStatus').textContent = 'Arduino: подключён';
      const decoder = new TextDecoderStream();
      state.serialPort.readable.pipeTo(decoder.writable).catch(() => {});
      state.serialReader = decoder.readable.getReader();
      let buffer = '';
      while (state.serialPort?.readable) {
        const { value, done } = await state.serialReader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          const cleanLine = line.trim();
          const log = $('serialLogBox');
          if (log && cleanLine) { log.textContent = `${log.textContent}\n> ${cleanLine}`.split('\n').slice(-24).join('\n'); log.scrollTop = log.scrollHeight; }
          const command = cleanLine.toUpperCase();
          if (command === 'LEFT') moveGame(-1);
          else if (command === 'RIGHT') moveGame(1);
          else if (['A', 'BTN_A', 'OK'].includes(command)) launchGame();
          else if (['B', 'BTN_B', 'EXIT'].includes(command) && state.isGameRunning) exitGame();
        }
      }
    } catch (error) {
      $('hardwareStatus').textContent = `Arduino: ${error.message}`;
    }
  }

  function setupEvents() {
    addEventListener('keydown', keyboardHandler);
    addEventListener('online', () => { setCloud(true); syncCatalog(false); checkMaintenance(); validateActiveSession(); if (!state.activeSession && state.cameraStream) scanFrame(); });
    addEventListener('offline', () => { setCloud(false); $('catalogStatus').textContent = 'Интернет пропал. Текущая сессия продолжает идти до expires_at; новые QR и рекорды недоступны.'; });
    $('btnFullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    });
    $('btnAudioToggle').addEventListener('click', () => SoundMaster?.toggleMute?.());
    $('btnCamera').addEventListener('click', startCamera);
    $('btnQuitGame').addEventListener('click', () => exitGame());
    $('btnRecords').addEventListener('click', () => { setModal('recordsModal', true); loadRecords(); });
    $('recordsGameFilter').addEventListener('change', loadRecords);
    $('btnSaveRecord').addEventListener('click', saveRecord);
    $('btnSkipRecord').addEventListener('click', () => setModal('resultModal', false));
    $('resultNick').addEventListener('keydown', event => { if (event.key === 'Enter') saveRecord(); });
    $('btnSettings').addEventListener('click', () => setModal('settingsModal', true));
    $('btnArduino').addEventListener('click', connectArduino);
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => setModal(button.dataset.close, false)));
    $('prevGame').setAttribute('aria-hidden', 'true'); $('nextGame').setAttribute('aria-hidden', 'true');
    $('prevGame').style.pointerEvents = 'none'; $('nextGame').style.pointerEvents = 'none';
    $('scannerDock').addEventListener('pointerdown', event => event.preventDefault());
  }

  function subscribeNetworkStatus() { setCloud(navigator.onLine); }

  async function boot() {
    setupEvents();
    initSettings();
    updateClock();
    state.clockTimer = setInterval(updateClock, 1000);
    subscribeNetworkStatus();
    await initServiceWorker();
    const cached = await loadCachedCatalog().catch(() => []);
    if (cached.length) { state.games = cached; renderCarousel(); }
    else {
      state.games = fallbackGames();
      renderCarousel();
      await cacheBundledDemos();
    }
    restoreSession();
    if (!state.activeSession) startAutoRotate(); else { startSessionTicker(); validateActiveSession(); }
    await syncCatalog(false);
    if (state.activeSession) startSessionTicker();
    checkMaintenance();
    subscribeRealtime();
    setInterval(checkMaintenance, 20000);
    setInterval(() => { if (state.activeSession) validateActiveSession(); }, 20000);
    setInterval(() => { if (navigator.onLine) syncCatalog(false); }, 60000);
    updateSyncInfo();
    // Запрашиваем камеру сразу: если браузер уже давал разрешение, QR-сканер стартует без дополнительных действий.
    if (!state.activeSession) startCamera();
  }

  // SCORE-сообщения принимаются только от текущего игрового iframe.
  addEventListener('message', event => {
    if (event.source !== $('gameFrame').contentWindow || !event.data) return;
    if (event.data.type === 'SCBB_GAME_ESCAPE') { if (state.isGameRunning) exitGame(); return; }
    if (event.data.type === 'SCBB_FULLSCREEN') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.().catch(() => {}); return; }
    if (event.data.type === 'SCBB_TOGGLE_MUTE') { SoundMaster?.toggleMute?.(); return; }
    if (event.data.type !== 'SCORE') return;
    const score = Number(event.data.score);
    if (Number.isFinite(score) && score >= 0) state.lastScore = Math.max(state.lastScore, Math.floor(score));
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.activeSession) updateSessionTimer();
  });

  window.SCBBKiosk = Object.freeze({ sync: () => syncCatalog(true), endSession });
  boot().catch(error => {
    console.error('SCBB kiosk boot:', error);
    $('catalogStatus').textContent = `Ошибка запуска: ${error.message}`;
  });
})();
