const SCHEME = 'agilecampus-pet';
function serverOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('仅支持 HTTPS 或本机平台地址');
  return url.origin;
}
function parseLaunch(value) {
  const url = new URL(value);
  if (url.protocol !== `${SCHEME}:` || url.hostname !== 'connect' || url.pathname || url.username || url.password || url.hash || url.port) throw new Error('无效的桌宠连接地址');
  if ([...url.searchParams.keys()].some(key => !['server', 'ticket'].includes(key)) || url.searchParams.getAll('server').length !== 1 || url.searchParams.getAll('ticket').length !== 1) throw new Error('连接参数无效');
  const ticket = url.searchParams.get('ticket');
  if (!/^acpair_[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('连接邀请格式无效');
  return { origin: serverOrigin(url.searchParams.get('server')), ticket };
}
function validateAppearance(value) {
  if (!value || !['image', 'spritesheet'].includes(value.type)) throw new Error('桌宠外观格式无效');
  const validSize = n => Number.isInteger(n) && n >= 1 && n <= 4096;
  if (value.type === 'image') { if (!validSize(value.width) || !validSize(value.height)) throw new Error('图片尺寸无效'); }
  else {
    if (!validSize(value.frameWidth) || !validSize(value.frameHeight) || !Number.isInteger(value.columns) || value.columns < 1 || value.columns > 32 || !Number.isInteger(value.rows) || value.rows < 1 || value.rows > 32) throw new Error('图集尺寸无效');
    for (const action of [value.idle, value.greet].filter(Boolean)) if (!Number.isInteger(action.start) || action.start < 0 || !Number.isInteger(action.count) || action.count < 1 || action.count > 256 || action.start + action.count > value.rows * value.columns || !Number.isFinite(action.fps) || action.fps < 0 || action.fps > 30) throw new Error('动画帧无效');
    if (!value.idle) throw new Error('缺少待机动作');
  }
  // Never pass a remote resource URL to the renderer; only the authenticated asset gateway is used.
  const { src, ...appearance } = value;
  void src;
  return appearance;
}
function clampBounds(bounds, area) {
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width), y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height) };
}
module.exports = { SCHEME, serverOrigin, parseLaunch, validateAppearance, clampBounds };
