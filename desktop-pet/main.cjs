const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, screen, dialog, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SCHEME, parseLaunch, serverOrigin, validateAppearance, clampBounds } = require('./lib/protocol.cjs');
const { encryptToken, decryptToken } = require('./lib/secure-config.cjs');

const testMode = process.argv.includes('--test-mode');
const page = path.join(__dirname, 'ui', 'index.html');
let win, tray, timer, saveTimer, quitting = false, busy = false;
let config = { origin: 'http://127.0.0.1:3000', token: null, expiresAt: null, bounds: null };
let payload = { connected: false, status: 'offline', name: '', message: '在家园点击“开启桌面陪伴”连接当前账号。' };
let assetCache = { key: '', fetchedAt: 0, data: null };
let failures = 0, lastAck = 0, connecting = false, demoMode = false;
const storeFile = () => path.join(app.getPath('userData'), 'connection.json');

function publish() { if (win && !win.isDestroyed()) win.webContents.send('pet:state', payload); }
async function saveConfig() {
  if (testMode) return;
  const stored = { origin: config.origin, expiresAt: config.expiresAt, bounds: config.bounds };
  if (config.token) Object.assign(stored, await encryptToken(safeStorage, config.token));
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const temporary = storeFile() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(stored), { mode: 0o600 });
  await fs.rename(temporary, storeFile());
}
async function restoreConfig() {
  try {
    const value = JSON.parse(await fs.readFile(storeFile(), 'utf8'));
    config.origin = serverOrigin(value.origin);
    if (value.bounds && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(value.bounds[k])) && value.bounds.width >= 180 && value.bounds.width <= 400 && value.bounds.height >= 200 && value.bounds.height <= 450) config.bounds = value.bounds;
    if (value.encryptedToken && Date.parse(value.expiresAt) > Date.now()) {
      const token = await decryptToken(safeStorage, value);
      if (/^acpet_[A-Za-z0-9_-]{43}$/.test(token)) { config.token = token; config.expiresAt = value.expiresAt; }
    }
  } catch { /* Missing, expired or unreadable credentials require a fresh browser pairing. */ }
}
async function limitedBody(response, limit) {
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new Error('服务返回内容过大');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
async function request(endpoint, options = {}) {
  const response = await fetch(config.origin + endpoint, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000), headers: {
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers,
  } });
  if (response.status === 401) {
    config.token = null; assetCache = { key: '', fetchedAt: 0, data: null }; void saveConfig();
    throw new Error('连接已失效，请从家园重新连接');
  }
  if (!response.ok) {
    const bytes = await limitedBody(response, 8192);
    let message = '服务暂不可用'; try { message = JSON.parse(bytes.toString()).error ?? message; } catch { /* No raw HTML is shown. */ }
    throw new Error(String(message).slice(0, 180));
  }
  return response;
}
async function heartbeat(status = win?.isVisible() ? 'visible' : 'hidden') {
  if (!config.token || demoMode) return;
  await request('/api/home/desktop/state', { method: 'POST', body: JSON.stringify({ status, ackSequence: lastAck }) });
}
async function poll() {
  if (busy || quitting || demoMode || !config.token) return;
  busy = true;
  try {
    const response = await request('/api/home/desktop/state');
    const state = JSON.parse((await limitedBody(response, 128 * 1024)).toString());
    if (state.schemaVersion !== 1) throw new Error('桌宠协议版本不兼容');
    const next = { connected: true, status: state.status, name: '', message: '', appearance: null, asset: null };
    if (state.pet) {
      next.name = String(state.pet.name).slice(0, 40);
      next.appearance = validateAppearance(state.pet.appearance);
      const key = JSON.stringify(state.pet);
      try {
        if (assetCache.key !== key || Date.now() - assetCache.fetchedAt > 30000) {
          const asset = await request('/api/home/desktop/asset');
          if (asset.headers.get('x-pet-id') !== state.pet.id) throw new Error('桌宠已切换，正在重新读取');
          const mime = asset.headers.get('content-type')?.split(';')[0];
          if (!['image/png', 'image/webp', 'image/gif', 'image/jpeg'].includes(mime)) throw new Error('桌宠图片格式不受支持');
          const bytes = await limitedBody(asset, 5 * 1024 * 1024);
          assetCache = { key, fetchedAt: Date.now(), data: `data:${mime};base64,${bytes.toString('base64')}` };
        }
        next.asset = assetCache.data;
      } catch (error) { next.message = error.message; next.appearance = null; }
    } else {
      assetCache = { key: '', fetchedAt: 0, data: null };
      next.message = state.status === 'unavailable' ? '原桌宠暂不可用，请在家园重新选择。' : '连接成功。请在家园选择自定义桌宠。';
    }
    payload = next; publish(); failures = 0;
    if (state.command && Number.isSafeInteger(state.command.sequence) && state.command.sequence > lastAck) {
      lastAck = state.command.sequence;
      if (state.command.action === 'show') showPet();
      else if (state.command.action === 'hide') win.hide();
      else if (state.command.action === 'quit') { busy = false; await quitApp(); return; }
    }
    await heartbeat(); updateTray();
  } catch (error) {
    failures++;
    payload = { ...payload, connected: Boolean(config.token), message: error.message, offline: true };
    if (!config.token) { payload.asset = null; payload.appearance = null; payload.status = 'offline'; }
    publish();
  } finally {
    busy = false;
    if (!quitting && !demoMode && config.token) timer = setTimeout(poll, Math.min(30000, 5000 * 2 ** Math.min(failures, 3)));
  }
}
function fitWindow() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  win.setBounds(clampBounds(bounds, area));
}
function showPet() { fitWindow(); win.showInactive(); win.setAlwaysOnTop(true, 'floating'); updateTray(); }
async function openHome(courtyard = false) {
  try {
    await shell.openExternal(config.origin + (courtyard ? '/home?view=courtyard' : '/home'));
  } catch {
    payload.message = '未能打开浏览器，请手动访问家园网页。'; publish();
  } finally {
    // Opening the browser transfers foreground ownership on Windows. Restore the
    // companion without taking keyboard focus away from the browser.
    if (!quitting && win && !win.isDestroyed()) showPet();
  }
}
async function quitApp() {
  if (quitting) return;
  quitting = true; clearTimeout(timer);
  await Promise.race([heartbeat('stopped').catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
  await saveConfig().catch(() => {}); app.quit();
}
function resizePet(width, height) {
  win.setBounds({ ...win.getBounds(), width, height }); fitWindow();
  config.bounds = win.getBounds(); void saveConfig().catch(() => {});
}
async function loadDemo() {
  clearTimeout(timer);
  while (busy) await new Promise(resolve => setTimeout(resolve, 25));
  clearTimeout(timer);
  if (config.token && !demoMode) await heartbeat('hidden').catch(() => {});
  demoMode = true;
  try {
    const filename = app.isPackaged ? path.join(__dirname, 'ui', 'assets', 'demo-qing-bot.png') : path.join(__dirname, '..', 'public', 'pets', 'demo', 'qing-bot.png');
    const bytes = await fs.readFile(filename);
    payload = { connected: false, status: 'demo', name: '小青（演示）', message: '',
      appearance: { type: 'image', width: 1214, height: 1295 }, asset: `data:image/png;base64,${bytes.toString('base64')}` };
  } catch { payload = { connected: false, status: 'demo', name: '', message: '演示素材未安装，请使用最新客户端。' }; }
  publish(); showPet();
}
function menuItems() {
  return [
    { label: '体验演示桌宠：小青', click: () => void loadDemo() },
    ...(demoMode && config.token ? [{ label: '恢复已连接桌宠', click: () => { demoMode = false; void poll(); } }] : []),
    { type: 'separator' },
    { label: '打开我的家园', click: () => void openHome() },
    { label: '前往团队庭院', click: () => void openHome(true) },
    { type: 'separator' },
    { label: win?.isVisible() ? '暂时隐藏' : '显示桌宠', click: () => { if (win.isVisible()) win.hide(); else showPet(); void heartbeat().catch(() => {}); updateTray(); } },
    { label: '调整大小', submenu: [
      { label: '小', click: () => resizePet(180, 220) }, { label: '中', click: () => resizePet(240, 280) }, { label: '大', click: () => resizePet(300, 340) },
    ] },
    { label: '找回屏幕内', click: showPet },
    { type: 'separator' },
    { label: '退出桌面陪伴', click: () => void quitApp() },
  ];
}
function updateTray() { if (tray) tray.setContextMenu(Menu.buildFromTemplate(menuItems())); }
function icon() {
  const bitmap = Buffer.alloc(32 * 32 * 4);
  for (let y = 3; y < 29; y++) for (let x = 3; x < 29; x++) {
    const i = (y * 32 + x) * 4;
    const white = ((x >= 9 && x <= 12 && y >= 12 && y <= 23) || (x >= 12 && x <= 22 && (y >= 9 && y <= 12 || y >= 20 && y <= 23)));
    bitmap[i] = white ? 245 : 20; bitmap[i + 1] = white ? 250 : 125; bitmap[i + 2] = white ? 249 : 104; bitmap[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(bitmap, { width: 32, height: 32 });
}
async function connect(value) {
  if (connecting) return;
  let link;
  try { link = parseLaunch(value); } catch { payload.message = '连接地址无效，请从家园重新开启。'; publish(); return; }
  connecting = true;
  if (!testMode) {
    const result = await dialog.showMessageBox(win, { type: 'question', title: '连接桌面陪伴', message: `连接到 ${link.origin}？`, detail: '仅授权读取当前账号选中的桌宠。不会获得项目或任务操作权限。', buttons: ['连接', '取消'], defaultId: 0, cancelId: 1 });
    if (result.response !== 0) { connecting = false; return; }
  }
  clearTimeout(timer);
  while (busy) await new Promise(resolve => setTimeout(resolve, 25));
  clearTimeout(timer);
  const old = { ...config };
  try {
    const response = await fetch(link.origin + '/api/home/desktop/pair', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: link.ticket }) });
    const result = JSON.parse((await limitedBody(response, 8192)).toString());
    if (!response.ok || !/^acpet_[A-Za-z0-9_-]{43}$/.test(result.token)) throw new Error(result.error ?? '连接失败，请重新生成邀请');
    demoMode = false;
    config = { ...config, origin: link.origin, token: result.token, expiresAt: result.expiresAt }; lastAck = 0;
    assetCache = { key: '', fetchedAt: 0, data: null };
    await saveConfig().catch(() => {}); showPet(); await poll();
  } catch (error) { config = old; payload.message = String(error.message).slice(0, 180); publish(); if (config.token) timer = setTimeout(poll, 5000); }
  finally { connecting = false; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setName('AgileCampus Pet');
  app.on('second-instance', (_event, args) => { const link = args.find(value => value.startsWith(`${SCHEME}://`)); if (args.includes('--demo')) void loadDemo(); else if (link) void connect(link); else if (win) showPet(); });
  app.on('open-url', (event, url) => { event.preventDefault(); if (win) void connect(url); });
  app.whenReady().then(async () => {
    if (process.argv.includes('--unregister')) {
      if (process.defaultApp) app.removeAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(__dirname)]);
      else app.removeAsDefaultProtocolClient(SCHEME);
      quitting = true; app.quit(); return;
    }
    if (!testMode) await restoreConfig();
    app.setAppUserModelId('org.agilecampus.desktop-pet');
    if (!testMode) {
      if (process.defaultApp) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(__dirname)]);
      else app.setAsDefaultProtocolClient(SCHEME);
    }
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = clampBounds(config.bounds ?? { width: 180, height: 220, x: area.x + area.width - 220, y: area.y + area.height - 260 }, area);
    win = new BrowserWindow({ ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true,
      resizable: false, fullscreenable: false, hasShadow: false, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.on('context-menu', () => Menu.buildFromTemplate(menuItems()).popup({ window: win }));
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); updateTray(); void heartbeat().catch(() => {}); } });
    win.on('blur', () => {
      if (!quitting && win.isVisible()) win.setAlwaysOnTop(true, 'floating');
    });
    win.on('moved', () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { config.bounds = win.getBounds(); void saveConfig().catch(() => {}); }, 400); });
    screen.on('display-removed', fitWindow);
    const trusted = event => event.sender === win.webContents && event.senderFrame?.url === pathToFileURL(page).href;
    ipcMain.handle('pet:ready', event => trusted(event) ? payload : null);
    ipcMain.handle('pet:action', (event, action) => {
      if (!trusted(event)) return;
      if (action === 'home') return openHome();
      if (action === 'hide') { win.hide(); updateTray(); void heartbeat().catch(() => {}); }
      else if (action === 'quit') return quitApp();
      else if (action === 'menu') Menu.buildFromTemplate(menuItems()).popup({ window: win });
      else if (action === 'capture') win.setIgnoreMouseEvents(false);
      else if (action === 'passthrough') win.setIgnoreMouseEvents(true, { forward: true });
    });
    ipcMain.on('pet:drag', (event, delta) => {
      if (!trusted(event) || !Number.isFinite(delta?.dx) || !Number.isFinite(delta?.dy) || Math.abs(delta.dx) > 500 || Math.abs(delta.dy) > 500) return;
      const current = win.getBounds(), display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      win.setBounds(clampBounds({ ...current, x: current.x + Math.round(delta.dx), y: current.y + Math.round(delta.dy) }, display.workArea));
    });
    tray = new Tray(icon()); tray.setToolTip('AgileCampus 桌面陪伴'); tray.on('double-click', showPet); updateTray();
    await win.loadFile(page); showPet();
    const link = process.argv.find(value => value.startsWith(`${SCHEME}://`));
    if (process.argv.includes('--demo')) await loadDemo(); else if (link) await connect(link); else if (config.token) await poll();
    if (testMode) globalThis.desktopPetTest = { connect, poll, showPet, loadDemo, getWindow: () => win, getPayload: () => payload, quit: quitApp,
      secureRoundTrip: async value => { const stored = await encryptToken(safeStorage, value); return { mode: stored.encryption, match: await decryptToken(safeStorage, stored) === value, containsPlainText: JSON.stringify(stored).includes(value) }; },
    };
  });
  app.on('before-quit', () => { quitting = true; clearTimeout(timer); clearTimeout(saveTimer); tray?.destroy(); });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
}
