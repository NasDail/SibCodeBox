/* Панель учителя/разработчика. Все привилегированные операции выполняются Edge Functions. */
(() => {
  'use strict';
  const CFG = window.SCBB_CONFIG;
  const S = window.ScbbShared;
  if (!CFG || !window.supabase || !S) return;
  const $ = id => document.getElementById(id);
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const state = { user: null, role: null, games: [], lastQrText: '', sessions: [] };

  function status(id, message, kind = '') {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.className = `status${kind ? ` ${kind}` : ''}`;
  }
  function toast(message, error = false) {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3600);
  }
  function html(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }
  async function invoke(functionName, body) {
    const { data, error } = await sb.functions.invoke(functionName, { body });
    if (error) {
      let message = error.message || 'Ошибка серверной функции';
      try { const payload = await error.context?.json?.(); message = payload?.error || payload?.message || message; } catch (_) {}
      throw new Error(message);
    }
    if (data && data.ok === false) throw new Error(data.error || 'Операция отклонена');
    return data;
  }

  function showApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('roleBadge').textContent = state.role === 'developer' ? 'DEVELOPER' : 'TEACHER';
    $('userEmail').textContent = state.user?.email || '';
    $('developerTools').classList.toggle('hidden', state.role !== 'developer');
    loadAll().catch(error => toast(error.message, true));
  }

  async function authenticateExistingSession() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;
    const { data, error } = await sb.from('admins').select('role').eq('id', user.id).maybeSingle();
    if (error || !data || !['teacher', 'developer'].includes(data.role)) {
      await sb.auth.signOut();
      status('loginStatus', 'У этой учётной записи нет роли teacher/developer.', 'error');
      return false;
    }
    state.user = user; state.role = data.role;
    showApp();
    return true;
  }

  async function login(event) {
    event.preventDefault();
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    $('loginButton').disabled = true;
    status('loginStatus', 'Проверяем учётную запись…');
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: admin, error: roleError } = await sb.from('admins').select('role').eq('id', data.user.id).maybeSingle();
      if (roleError) throw roleError;
      if (!admin || !['teacher', 'developer'].includes(admin.role)) {
        await sb.auth.signOut();
        throw new Error('Учётная запись не добавлена в таблицу admins. Попроси администратора назначить роль.');
      }
      state.user = data.user; state.role = admin.role;
      showApp();
      toast('Вход выполнен.');
    } catch (error) {
      status('loginStatus', error.message || 'Не удалось войти.', 'error');
    } finally {
      $('loginButton').disabled = false;
    }
  }

  async function logout() {
    await sb.auth.signOut();
    state.user = null; state.role = null;
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    $('loginPassword').value = '';
  }

  function setTab(tabId) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabId));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === tabId));
  }

  async function loadAll() {
    await Promise.allSettled([loadSessions(), loadGames(), loadOffenders(), loadMaintenance(), loadStoplist()]);
  }

  async function loadSessions() {
    const data = await invoke('admin-api', { action: 'list_sessions' });
    state.sessions = data.sessions || [];
    $('sessionsCount').textContent = `Сессий: ${state.sessions.length}`;
    const list = $('sessionsList'); list.replaceChildren();
    if (!state.sessions.length) { list.textContent = 'Сессий пока нет.'; list.className = 'list empty-state'; return; }
    list.className = 'list';
    state.sessions.forEach(session => {
      const row = document.createElement('div'); row.className = 'list-row';
      const main = document.createElement('div');
      const title = document.createElement('div'); title.className = 'list-main'; title.textContent = session.owner_name || 'Игрок';
      const sub = document.createElement('div'); sub.className = 'list-sub';
      sub.textContent = `Создана: ${S.formatDate(session.created_at)} · Истекает: ${S.formatDate(session.expires_at || session.qr_expires_at)} · ${session.minutes || '—'} мин.`;
      const badge = document.createElement('span'); badge.className = `badge ${session.status === 'active' ? 'active' : session.status === 'revoked' ? 'banned' : 'used'}`; badge.textContent = session.status;
      main.append(title, sub, badge);
      const actions = document.createElement('div'); actions.className = 'row-actions';
      if (['issued', 'active'].includes(session.status)) {
        const revoke = document.createElement('button'); revoke.className = 'btn danger'; revoke.textContent = 'ОТОЗВАТЬ';
        revoke.addEventListener('click', () => revokeSession(session.id)); actions.appendChild(revoke);
      }
      row.append(main, actions); list.appendChild(row);
    });
  }

  async function revokeSession(id) {
    if (!confirm('Отозвать эту сессию?')) return;
    try { await invoke('admin-api', { action: 'revoke_session', session_id: id }); await loadSessions(); toast('Сессия отозвана.'); }
    catch (error) { toast(error.message, true); }
  }

  function renderQr(qrText, owner, expiresAt) {
    state.lastQrText = qrText;
    $('qrEmpty').classList.add('hidden');
    $('qrResult').classList.remove('hidden');
    $('qrOwnerLabel').textContent = owner || 'Игрок';
    $('qrExpiryLabel').textContent = `Истекает: ${S.formatDate(expiresAt)}`;
    const qr = window.qrcode(0, 'M');
    qr.addData(qrText); qr.make();
    const canvas = $('qrCanvas');
    const ctx = canvas.getContext('2d');
    const size = 280; canvas.width = size; canvas.height = size;
    const count = qr.getModuleCount(); const cell = size / count;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.isDark(y, x)) ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
  }

  async function createSession(event) {
    event.preventDefault();
    $('createSessionButton').disabled = true;
    status('sessionStatus', 'Создаём одноразовый токен…');
    try {
      const minutes = Number($('sessionMinutes').value);
      const ownerName = $('sessionOwner').value.trim();
      const ownerClass = $('sessionClass').value.trim();
      const data = await invoke('admin-api', { action: 'create_session', minutes, owner_name: ownerName, owner_class: ownerClass });
      renderQr(data.qr_payload, data.owner_name || 'Игрок', data.expires_at);
      status('sessionStatus', 'QR создан. Токен показывается только один раз; запись в базе содержит его SHA-256.', 'success');
      await loadSessions();
    } catch (error) { status('sessionStatus', error.message, 'error'); }
    finally { $('createSessionButton').disabled = false; }
  }

  async function loadGames() {
    const { data, error } = await sb.from('games').select('id,slug,title,description,genre,developer,icon_url,repo_url,is_active,created_at').order('created_at', { ascending: false });
    if (error) throw error;
    state.games = data || [];
    $('gamesCount').textContent = `Игр: ${state.games.filter(game => game.is_active).length}`;
    const list = $('gamesList'); list.replaceChildren();
    if (!state.games.length) { list.textContent = 'В каталоге пока нет игр.'; list.className = 'list empty-state'; return; }
    list.className = 'list';
    state.games.forEach(game => {
      const row = document.createElement('div'); row.className = 'list-row';
      const main = document.createElement('div');
      const title = document.createElement('div'); title.className = 'list-main'; title.textContent = `${game.title}${game.is_active ? '' : ' · В архиве'}`;
      const sub = document.createElement('div'); sub.className = 'list-sub'; sub.textContent = `${game.genre || '—'} · ${game.developer || '—'} · ${game.slug || game.id}`;
      main.append(title, sub);
      const actions = document.createElement('div'); actions.className = 'row-actions';
      const open = document.createElement('a'); open.className = 'btn ghost'; open.textContent = 'GITHUB'; open.href = game.repo_url || '#'; open.target = '_blank'; open.rel = 'noopener noreferrer'; actions.appendChild(open);
      if (state.role === 'developer') {
        const edit = document.createElement('button'); edit.className = 'btn'; edit.textContent = 'ИЗМЕНИТЬ'; edit.addEventListener('click', () => openEditGame(game)); actions.appendChild(edit);
        if (game.is_active) {
          const archive = document.createElement('button'); archive.className = 'btn danger'; archive.textContent = 'УДАЛИТЬ'; archive.addEventListener('click', () => archiveGame(game)); actions.appendChild(archive);
        }
      }
      row.append(main, actions); list.appendChild(row);
    });
  }

  function commonZipPrefix(paths) {
    if (!paths.length) return '';
    const firstParts = paths.map(path => path.split('/').filter(Boolean));
    const first = firstParts[0][0];
    if (!first || !first.endsWith('/') && firstParts.some(parts => parts.length === 1)) return '';
    if (!firstParts.every(parts => parts.length > 1 && parts[0] === first)) return '';
    return `${first}/`;
  }

  async function extractZip(file) {
    if (!window.JSZip) throw new Error('Библиотека ZIP не загружена. Проверь подключение к CDN.');
    const archive = await JSZip.loadAsync(file, { checkCRC32: true });
    const fileEntries = Object.values(archive.files).filter(entry => !entry.dir);
    const paths = fileEntries.map(entry => entry.name.replace(/\\/g, '/'));
    const prefix = commonZipPrefix(paths);
    const map = new Map();
    let totalBytes = 0;
    const ignored = [];
    for (const entry of fileEntries) {
      let path = entry.name.replace(/\\/g, '/');
      if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
      path = path.replace(/^\/+/, '');
      if (!path || path.split('/').some(part => part === '..' || part === '.' || part.toLowerCase() === '.git')) throw new Error(`Недопустимый путь в ZIP: ${path}`);
      if (/(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(path) || /\.log$/i.test(path) || path.startsWith('__MACOSX/')) { ignored.push(path); continue; }
      const bytes = await entry.async('uint8array');
      totalBytes += bytes.byteLength;
      if (totalBytes > CFG.MAX_GAME_BYTES) throw new Error('Распакованный архив превышает 4 МБ. Удали лишние файлы и повтори загрузку.');
      map.set(path, { path, content_base64: S.bytesToBase64(bytes), mime: mimeFor(path), size: bytes.byteLength });
      if (map.size > 80) throw new Error('Слишком много файлов: максимум 80 файлов на одну игру.');
    }
    if (!map.has('index.html')) throw new Error('В архиве должен быть index.html в корне (после удаления общей папки-обёртки).');
    if (!map.has('icon.png')) throw new Error('В архиве должен быть icon.png в корне (после удаления общей папки-обёртки).');
    return { files: [...map.values()], totalBytes, ignored, prefix };
  }

  function mimeFor(path) {
    const ext = path.split('.').pop().toLowerCase();
    return ({ html:'text/html; charset=utf-8', htm:'text/html; charset=utf-8', css:'text/css; charset=utf-8', js:'text/javascript; charset=utf-8', mjs:'text/javascript; charset=utf-8', json:'application/json', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', svg:'image/svg+xml', gif:'image/gif', mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', mp4:'video/mp4', wasm:'application/wasm', txt:'text/plain; charset=utf-8', ttf:'font/ttf', woff:'font/woff', woff2:'font/woff2' })[ext] || 'application/octet-stream';
  }

  async function onZipSelected() {
    const file = $('gameZip').files[0];
    if (!file) { $('zipInfo').textContent = 'Архив не выбран.'; return; }
    try {
      $('zipInfo').textContent = 'Проверяем архив…';
      const result = await extractZip(file);
      $('zipInfo').textContent = `${result.files.length} файлов · ${Math.round(result.totalBytes / 1024)} КБ${result.prefix ? ` · папка ${result.prefix} распознана` : ''}${result.ignored.length ? ` · исключено служебных файлов: ${result.ignored.length}` : ''}`;
    } catch (error) { $('zipInfo').textContent = error.message; }
  }

  async function publishGame(event) {
    event.preventDefault();
    const file = $('gameZip').files[0];
    if (!file) { status('uploadStatus', 'Выбери ZIP-архив.', 'error'); return; }
    $('publishGameButton').disabled = true;
    $('uploadProgress').classList.remove('hidden');
    $('uploadProgressBar').style.width = '8%';
    status('uploadStatus', 'Проверяем и распаковываем ZIP…');
    try {
      const archive = await extractZip(file);
      const title = $('gameTitle').value.trim();
      const description = $('gameDescription').value.trim();
      const genre = $('gameGenre').value.trim();
      const developer = $('gameDeveloper').value.trim();
      if (!title || !description || !genre || !developer) throw new Error('Заполни название, описание, жанр и разработчика.');
      const suffix = crypto.getRandomValues(new Uint8Array(3));
      const slug = `${S.slugify(title)}-${Array.from(suffix, byte => byte.toString(16).padStart(2, '0')).join('')}`;
      $('uploadProgressBar').style.width = '20%';
      status('uploadStatus', `Передаём ${archive.files.length} файлов в защищённую функцию публикации…`);
      const result = await invoke('publish-game', {
        action: 'publish',
        game: { id: slug, slug, title, description, genre, developer },
        files: archive.files
      });
      $('uploadProgressBar').style.width = '100%';
      status('uploadStatus', `Игра «${title}» опубликована и добавлена в каталог.`, 'success');
      toast('Публикация завершена.');
      $('gameForm').reset(); $('zipInfo').textContent = 'Архив не выбран.';
      await loadGames();
      setTimeout(() => $('uploadProgress').classList.add('hidden'), 1200);
    } catch (error) {
      status('uploadStatus', error.message, 'error');
      toast(error.message, true);
    } finally { $('publishGameButton').disabled = false; }
  }

  function openEditGame(game) {
    if (state.role !== 'developer') return;
    $('editGameId').value = game.id;
    $('editGameTitle').value = game.title || '';
    $('editGameDescription').value = game.description || '';
    $('editGameGenre').value = game.genre || '';
    $('editGameDeveloper').value = game.developer || '';
    $('editGameModal').classList.remove('hidden');
    status('editGameStatus', '');
  }

  async function saveGameEdits(event) {
    event.preventDefault();
    if (state.role !== 'developer') return;
    try {
      await invoke('admin-api', { action: 'update_game', game: {
        id: $('editGameId').value,
        title: $('editGameTitle').value.trim(),
        description: $('editGameDescription').value.trim(),
        genre: $('editGameGenre').value.trim(),
        developer: $('editGameDeveloper').value.trim()
      } });
      $('editGameModal').classList.add('hidden');
      await loadGames(); toast('Карточка игры обновлена.');
    } catch (error) { status('editGameStatus', error.message, 'error'); }
  }

  async function archiveGame(game) {
    if (state.role !== 'developer' || !confirm(`Убрать «${game.title}» из каталога? Файлы в GitHub останутся для возможности восстановления.`)) return;
    try { await invoke('admin-api', { action: 'delete_game', game_id: game.id }); await loadGames(); toast('Игра архивирована.'); }
    catch (error) { toast(error.message, true); }
  }

  async function loadOffenders() {
    const data = await invoke('admin-api', { action: 'list_offenders' });
    const rows = data.offenders || [];
    $('offendersCount').textContent = `Записей: ${rows.length}`;
    const list = $('offendersList'); list.replaceChildren();
    if (!rows.length) { list.textContent = 'Совпадений со стоп-листом и заблокированных ников нет.'; list.className = 'list empty-state'; return; }
    list.className = 'list';
    rows.forEach(record => {
      const row = document.createElement('div'); row.className = 'list-row';
      const main = document.createElement('div');
      const title = document.createElement('div'); title.className = 'list-main'; title.textContent = record.nick || record.player_name || '—';
      const sub = document.createElement('div'); sub.className = 'list-sub';
      sub.textContent = `Игра: ${record.game_title || record.game_id} · Счёт: ${record.score} · Дата: ${S.formatDate(record.created_at)} · Статус: ${record.banned ? 'забанен' : record.hidden ? 'скрыт' : 'на проверке'}`;
      main.append(title, sub);
      const actions = document.createElement('div'); actions.className = 'row-actions';
      if (!record.hidden) {
        const hide = document.createElement('button'); hide.className = 'btn'; hide.textContent = 'СКРЫТЬ НИК';
        hide.addEventListener('click', () => moderateNick(record.id, 'hidden')); actions.appendChild(hide);
      }
      if (!record.banned) {
        const ban = document.createElement('button'); ban.className = 'btn danger'; ban.textContent = 'ЗАБАНИТЬ';
        ban.addEventListener('click', () => moderateNick(record.id, 'banned')); actions.appendChild(ban);
      }
      row.append(main, actions); list.appendChild(row);
    });
  }

  async function moderateNick(recordId, mode) {
    const label = mode === 'banned' ? 'заблокировать' : 'скрыть';
    if (!confirm(`Подтвердить действие: ${label} этот ник во всех рекордах?`)) return;
    try {
      const data = await invoke('admin-api', { action: 'moderate_nick', record_id: recordId, mode });
      toast(`Ник обработан. Обновлено записей: ${data.updated || 0}.`);
      await loadOffenders();
    } catch (error) { toast(error.message, true); }
  }

  async function loadStoplist() {
    const data = await invoke('admin-api', { action: 'get_stoplist' });
    $('stoplistInput').value = (data.words || []).join(', ');
  }

  async function saveStoplist() {
    const words = $('stoplistInput').value.split(/[\n,;]+/).map(word => word.trim()).filter(Boolean);
    try {
      await invoke('admin-api', { action: 'set_stoplist', words });
      status('stoplistStatus', `Сохранено слов: ${words.length}. Проверка выполняется сервером.`, 'success');
      await loadOffenders();
    } catch (error) { status('stoplistStatus', error.message, 'error'); }
  }

  async function loadMaintenance() {
    const data = await invoke('admin-api', { action: 'get_maintenance' });
    $('maintenanceMode').value = data.mode === 'on' ? 'on' : 'off';
    $('maintenanceMessage').value = data.message || 'Идут технические работы. Автомат скоро вернётся!';
  }

  async function saveMaintenance() {
    try {
      await invoke('admin-api', { action: 'set_maintenance', mode: $('maintenanceMode').value, message: $('maintenanceMessage').value.trim() });
      status('maintenanceStatus', 'Настройки сохранены. Онлайн-автоматы получат обновление через Realtime или следующую проверку.', 'success');
    } catch (error) { status('maintenanceStatus', error.message, 'error'); }
  }

  async function forceSync() {
    if (state.role !== 'developer') return;
    $('forceSyncButton').disabled = true;
    status('forceSyncStatus', 'Отправляем новую версию каталога…');
    try {
      const data = await invoke('admin-api', { action: 'force_sync' });
      status('forceSyncStatus', `Запрос создан: ${S.formatDate(data.requested_at)}. Автоматы синхронизируются при активном интернет-соединении.`, 'success');
    } catch (error) { status('forceSyncStatus', error.message, 'error'); }
    finally { $('forceSyncButton').disabled = false; }
  }

  function printQr() {
    if (!state.lastQrText) return;
    const canvas = $('qrCanvas');
    const dataUrl = canvas.toDataURL('image/png');
    const popup = window.open('', '_blank', 'width=480,height=620');
    if (!popup) { toast('Разреши всплывающее окно для печати.', true); return; }
    popup.opener = null;
    popup.document.write(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>QR СибКодБокс</title><body style="font-family:Arial;text-align:center;padding:35px"><h2>СибКодБокс</h2><p>${html($('qrOwnerLabel').textContent)}</p><img style="width:300px;height:300px" src="${dataUrl}"><p>${html($('qrExpiryLabel').textContent)}</p><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  }

  function setup() {
    $('loginForm').addEventListener('submit', login);
    $('logoutButton').addEventListener('click', logout);
    $('sessionForm').addEventListener('submit', createSession);
    $('refreshSessionsButton').addEventListener('click', () => loadSessions().catch(error => toast(error.message, true)));
    $('gameZip').addEventListener('change', onZipSelected);
    $('gameForm').addEventListener('submit', publishGame);
    $('refreshGamesButton').addEventListener('click', () => loadGames().catch(error => toast(error.message, true)));
    $('refreshOffendersButton').addEventListener('click', () => loadOffenders().catch(error => toast(error.message, true)));
    $('saveStoplistButton').addEventListener('click', saveStoplist);
    $('saveMaintenanceButton').addEventListener('click', saveMaintenance);
    $('forceSyncButton').addEventListener('click', forceSync);
    $('editGameForm').addEventListener('submit', saveGameEdits);
    $('printQrButton').addEventListener('click', printQr);
    $('copyQrButton').addEventListener('click', async () => {
      if (!state.lastQrText) return;
      try { await navigator.clipboard.writeText(state.lastQrText); toast('QR-текст скопирован.'); }
      catch (_) { toast('Браузер запретил доступ к буферу обмена.', true); }
    });
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.tab)));
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).classList.add('hidden')));
    $('editGameModal').addEventListener('click', event => { if (event.target === $('editGameModal')) $('editGameModal').classList.add('hidden'); });
    $('globalStatus').textContent = 'Защищённое соединение Supabase Auth.';
  }

  async function boot() {
    setup();
    try { await authenticateExistingSession(); } catch (error) { console.warn('Auth restore:', error); }
  }

  boot();
})();
