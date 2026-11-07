/* Account isolation, durable pending writes and revision-checked cloud sync. */
(() => {
  'use strict';
  const LOCAL_KEY = 'nutripath.v1';
  const DATA_KEYS = ['goals', 'logs', 'custom', 'extraStores', 'profile', 'measurements', 'autoGoals', 'theme'];
  const config = window.NUTRIPATH_CONFIG || {};
  const bar = document.getElementById('accountBar');
  const overlay = document.getElementById('accountOverlay');
  const shell = document.querySelector('.app-shell');
  let client, user, data = null, revision = 0, dirty = false, sequence = 0;
  let conflict = false, syncing = false, timer, status = '', recovery = false;
  let configured = false, initialised = false, storageFailed = false, changingAccount = false, refreshing = false, blockingLoad = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cacheKey = () => `nutripath.account.${user.id}`;
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
  function clean(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const result = {};
    for (const k of DATA_KEYS) if (Object.hasOwn(value, k)) result[k] = copy(value[k]);
    for (const k of ['logs', 'custom', 'extraStores', 'measurements']) if (!Array.isArray(result[k])) result[k] = [];
    for (const k of ['profile', 'goals']) if (!result[k] || typeof result[k] !== 'object' || Array.isArray(result[k])) result[k] = {};
    return result;
  }
  function writeCache() {
    try {
      if (user) localStorage.setItem(cacheKey(), JSON.stringify({data, revision, dirty}));
      else localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      storageFailed = false;
    } catch {
      storageFailed = true;
      status = '端末への保存に失敗しました。バックアップを書き出してください。';
    }
  }
  function publish() {
    window.dispatchEvent(new CustomEvent('nutripath:data', {detail: copy(data)}));
  }
  function draw() {
    const actions = user
      ? `<button class="btn btn-sm" data-account="refresh">同期する</button><button class="btn btn-sm" data-account="import">端末データを取り込む</button><button class="btn btn-sm" data-account="logout">ログアウト</button>`
      : `<button class="btn btn-sm btn-primary" data-account="login" ${configured ? '' : 'disabled'}>ログイン・新規登録</button>`;
    bar.classList.toggle('account-conflict', conflict);
    bar.innerHTML = `<div><strong class="account-email">${user ? esc(user.email || 'ログイン中') : 'この端末だけで利用中'}</strong><p role="status" aria-live="polite">${esc(status || (user ? '同期済み' : configured ? 'ログインすると別の端末でも同じ記録を使えます。' : 'アカウント同期は接続先の設定後に利用できます。'))}</p></div><div class="account-actions">${actions}</div>${conflict ? '<div><p>別の端末で更新されています。端末の未送信データをバックアップしてから、使用する内容を選んでください。</p><div class="account-actions"><button class="btn" data-account="backup">未送信データを保存</button><button class="btn" data-account="cloud">クラウドの内容を使う</button><button class="btn" data-account="replace">この端末の内容で置き換える</button></div></div>' : ''}`;
    const foot = document.querySelector('.side-foot');
    if (foot) foot.textContent = user ? 'アカウントに同期・端末にも一時保存' : 'データはこのブラウザに保存';
  }
  function closeDialog() {
    if (blockingLoad) return;
    overlay.hidden = true;
    overlay.innerHTML = '';
    shell.inert = false;
    document.querySelector('[data-account="login"]')?.focus();
  }
  function openDialog(html) {
    overlay.innerHTML = `<section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="accountTitle">${html}</section>`;
    overlay.hidden = false;
    shell.inert = true;
    overlay.querySelector('input,button')?.focus();
  }
  function authDialog(mode = 'login') {
    const titles = {login:'ログイン', signup:'新規アカウント登録', reset:'パスワード再設定メール', password:'新しいパスワード'};
    openDialog(`<h2 id="accountTitle">${titles[mode]}</h2><p>同じアカウントでログインすると、食事・目標・身体データを端末間で共有できます。身体データもクラウドに保存されます。</p><form id="accountForm" data-mode="${mode}">${mode !== 'password' ? '<label>メールアドレス<input name="email" type="email" autocomplete="email" maxlength="254" required></label>' : ''}${mode !== 'reset' ? `<label>パスワード<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8" required></label>` : ''}<button class="btn btn-primary" type="submit">${mode === 'reset' ? 'メールを送信' : mode === 'password' ? 'パスワードを更新' : titles[mode]}</button><p id="accountMessage" class="account-message" role="status" aria-live="polite"></p></form><div class="account-actions">${mode === 'login' ? '<button class="btn" data-account="signup">新規登録</button><button class="btn" data-account="reset">パスワードを忘れた</button>' : mode !== 'password' ? '<button class="btn" data-account="login">ログインへ</button>' : ''}${mode === 'password' ? '' : '<button class="btn" data-account="close">閉じる</button>'}</div>`);
  }
  async function fetchRow() {
    const result = await client.from('nutripath_accounts').select('data,revision').eq('user_id', user.id).maybeSingle();
    if (result.error) throw result.error;
    if (result.data && !clean(result.data.data)) throw new Error('Invalid account data');
    return result.data;
  }
  function adopt(row) {
    data = clean(row?.data);
    revision = Number(row?.revision || 0);
    dirty = false;
    conflict = false;
    writeCache();
    status = storageFailed ? status : '同期済み';
    draw();
  }
  async function flush() {
    if (!user || !dirty || syncing || conflict || changingAccount) return;
    syncing = true;
    status = 'クラウドに保存中…'; draw();
    try {
      // Edits made during a request stay dirty and are sent in the next pass.
      while (dirty && !conflict) {
        const sentSequence = sequence;
        const result = await client.rpc('save_nutripath_state', {p_data: copy(data), p_expected_revision: revision, p_user_id: user.id});
        if (result.error) {
          if (result.error.code === 'PT409' || result.status === 409) {
            conflict = true;
            status = '同期の競合：内容を選んでください。';
            break;
          }
          throw result.error;
        }
        const row = result.data?.[0];
        if (!row || !Number.isSafeInteger(Number(row.revision))) throw new Error('Invalid sync response');
        revision = Number(row.revision);
        dirty = sentSequence !== sequence;
        writeCache();
      }
      if (!conflict) status = storageFailed ? status : '同期済み';
    } catch {
      status = '未同期：通信・ログイン状態を確認し「同期する」を押してください。端末の変更は保持しています。';
    } finally { syncing = false; draw(); }
  }
  function save(value) {
    if (changingAccount) throw new Error('アカウント切り替え中です。');
    data = clean(value);
    sequence++;
    if (user) dirty = true;
    writeCache();
    if (storageFailed && !user) throw new Error(status);
    if (user) {
      if (!conflict && !storageFailed) status = '変更を端末に保存・同期待ち';
      draw(); clearTimeout(timer); timer = setTimeout(flush, 600);
    }
  }
  async function refresh() {
    if (!user || syncing || conflict || changingAccount || refreshing) return;
    if (dirty) { await flush(); return; }
    refreshing = true;
    try {
      const startSequence = sequence;
      const row = await fetchRow();
      if (dirty || syncing || changingAccount || sequence !== startSequence || Number(row?.revision || 0) < revision) return;
      if (Number(row?.revision || 0) !== revision) { adopt(row); publish(); }
      else { status = '同期済み'; draw(); }
    } catch { status = '同期の確認に失敗しました。通信・ログイン状態を確認してください。'; draw(); }
    finally { refreshing = false; }
  }
  function backup() {
    const blob = new Blob([JSON.stringify({format:'nutripath-v2', exportedAt:new Date().toISOString(), ...data}, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'nutripath-pending-backup.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function logout() {
    if (syncing) { status = '保存中です。完了後にログアウトしてください。'; draw(); return; }
    if (dirty && !confirm('未同期の変更があります。先にJSONバックアップを保存してください。未同期の変更を破棄してログアウトしますか？')) return;
    const result = await client.auth.signOut({scope:'local'});
    if (result.error) throw result.error;
    dirty = false; changingAccount = true;
    if (user) localStorage.removeItem(cacheKey());
    location.reload();
  }
  async function action(name) {
    if (['login','signup','reset'].includes(name)) { authDialog(name); return; }
    if (name === 'close') { closeDialog(); return; }
    if (name === 'reload') { location.reload(); return; }
    if (name === 'logout') { await logout(); return; }
    if (name === 'refresh') { await refresh(); return; }
    if (name === 'backup') { backup(); return; }
    if (name === 'import') {
      const local = clean(read(LOCAL_KEY));
      if (!local) { status = 'このブラウザに未ログイン時のデータはありません。'; draw(); return; }
      if (syncing || conflict) { status = '同期完了または競合の解決後に取り込んでください。'; draw(); return; }
      if (!confirm('このブラウザの端末データをクラウドに送信し、現在のアカウントの記録全体を置き換えます。必要なら先にバックアップしてください。実行しますか？')) return;
      save(local); publish(); await flush(); return;
    }
    if (name === 'cloud' || name === 'replace') {
      if (!confirm(name === 'cloud' ? 'この端末の未同期の変更を破棄し、クラウドの最新内容を使いますか？' : 'クラウドの最新内容を、この端末の未同期データで置き換えますか？')) return;
      const row = await fetchRow();
      if (name === 'cloud') { adopt(row); publish(); }
      else { revision = Number(row?.revision || 0); conflict = false; writeCache(); await flush(); }
    }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-account]');
    if (!button) return;
    event.preventDefault();
    action(button.dataset.account).catch(() => { status = '操作に失敗しました。通信・接続設定を確認してください。'; draw(); });
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !recovery) { closeDialog(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...overlay.querySelectorAll('button:not(:disabled),input,a[href]')];
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
  });
  overlay.addEventListener('submit', async event => {
    if (event.target.id !== 'accountForm') return;
    event.preventDefault();
    const form = event.target, fields = new FormData(form), mode = form.dataset.mode;
    const button = form.querySelector('button'), message = document.getElementById('accountMessage');
    button.disabled = true; message.classList.remove('error'); message.textContent = '処理中…';
    try {
      const email = String(fields.get('email') || '').trim(), password = String(fields.get('password') || '');
      const redirectTo = new URL('./', location.href).href;
      let result;
      if (mode === 'signup') result = await client.auth.signUp({email, password, options:{emailRedirectTo:redirectTo}});
      else if (mode === 'reset') result = await client.auth.resetPasswordForEmail(email, {redirectTo});
      else if (mode === 'password') result = await client.auth.updateUser({password});
      else result = await client.auth.signInWithPassword({email, password});
      if (result.error) throw result.error;
      if (mode === 'reset' || (mode === 'signup' && !result.data.session)) {
        message.textContent = '確認メールをご確認ください。届かない場合は迷惑メールフォルダーも確認してください。';
      } else if (mode === 'password') { recovery = false; location.reload(); }
      else location.reload();
    } catch (error) {
      message.classList.add('error');
      message.textContent = error.code === 'invalid_credentials' ? 'メールアドレスまたはパスワードが違います。' : error.code === 'email_not_confirmed' ? 'メール内のリンクからアドレスを確認してください。' : '処理に失敗しました。入力内容・通信状態を確認し、時間をおいて再試行してください。';
    } finally { button.disabled = false; }
  });
  async function init() {
    try {
      const parsed = new URL(config.supabaseUrl);
      configured = parsed.protocol === 'https:' && !!config.supabasePublishableKey;
      if (/^(sb_secret_|eyJ)/.test(config.supabasePublishableKey || '')) {
        // Legacy anon JWTs are public; reject service-role JWTs before use.
        if (config.supabasePublishableKey.startsWith('sb_secret_')) configured = false;
        else {
          try { const claims = JSON.parse(atob(config.supabasePublishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if (claims.role !== 'anon') configured = false; }
          catch { configured = false; }
        }
      }
    } catch { configured = false; }
    if (!configured) { data = clean(read(LOCAL_KEY)); draw(); resolveReady(copy(data)); return; }
    try {
      client = window.NutriSupabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth:{storageKey:'nutripath-auth-'+new URL(config.supabaseUrl).hostname, autoRefreshToken:true, persistSession:true, detectSessionInUrl:true},
        global:{fetch:(input, options) => fetch(input, {...options, signal:options?.signal || AbortSignal.timeout(15000)})}
      });
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') { recovery = true; setTimeout(() => authDialog('password'), 0); }
        if (initialised && (session?.user?.id || null) !== (user?.id || null)) {
          changingAccount = true; clearTimeout(timer);
          shell.inert = true;
          // Immediately hide the previous account's data on cross-tab auth changes.
          document.getElementById('app').replaceChildren();
          setTimeout(() => location.reload(), 0);
        }
      });
      const result = await client.auth.getSession();
      if (result.error) throw result.error;
      user = result.data.session?.user || null;
      if (!user) data = clean(read(LOCAL_KEY));
      else {
        const cached = read(cacheKey());
        data = clean(cached?.data); revision = Number(cached?.revision || 0); dirty = !!cached?.dirty;
        try {
          const row = await fetchRow();
          if (dirty) {
            conflict = Number(row?.revision || 0) !== revision;
            status = conflict ? '同期の競合：内容を選んでください。' : '端末に未同期の変更があります。';
          } else adopt(row);
        } catch (error) {
          if (!cached || !data) throw error;
          status = 'オフライン：このアカウントの端末保存データを表示中';
        }
      }
      initialised = true; draw(); resolveReady(copy(data));
      if (dirty && !conflict) await flush();
      setInterval(() => {
        if (!document.hidden && overlay.hidden && !document.querySelector('#modalRoot form') && !document.activeElement?.matches('input,textarea,select')) refresh();
      }, 15000);
      window.addEventListener('online', () => refresh());
      document.addEventListener('visibilitychange', () => { if (!document.hidden && !document.activeElement?.matches('input,textarea,select')) refresh(); });
    } catch {
      status = 'アカウントの読み込みに失敗しました。接続先・DB設定・通信を確認してください。'; draw();
      // Never initialise an empty account on a failed initial read.
      blockingLoad = true;
      openDialog('<h2 id="accountTitle">データを読み込めませんでした</h2><p>既存データの上書きを避けるため、編集を停止しています。通信またはSupabaseの設定を確認してください。</p><div class="account-actions"><button class="btn btn-primary" data-account="reload">再読み込み</button><button class="btn" data-account="logout">ログアウト</button></div>');
    }
  }
  window.NutriAccount = {ready, save, isSignedIn:() => !!user};
  window.addEventListener('beforeunload', event => { if (user && dirty && !changingAccount) { event.preventDefault(); event.returnValue = ''; } });
  init();
})();
