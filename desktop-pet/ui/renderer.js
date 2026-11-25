/* global petDesktop */
const canvas = document.getElementById('pet'), context = canvas.getContext('2d');
const widget = document.getElementById('widget'), figure = document.getElementById('pet-figure');
const empty = document.getElementById('empty'), body = document.getElementById('pet-body');
let current = null, image = null, renderKey = '', frame = 0, lastTime = 0, action = 'idle', animationId, greetTimer;
function draw(time = 0) {
  if (!image || !current?.appearance) return;
  const appearance = current.appearance;
  const animation = appearance.type === 'spritesheet' ? action === 'greet' && appearance.greet ? appearance.greet : appearance.idle : null;
  if (animation && animation.fps > 0 && time - lastTime >= 1000 / animation.fps) { frame = (frame + 1) % animation.count; lastTime = time; }
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (appearance.type === 'image') context.drawImage(image, 0, 0, canvas.width, canvas.height);
  else {
    const index = animation.start + frame % animation.count;
    context.drawImage(image, index % appearance.columns * appearance.frameWidth, Math.floor(index / appearance.columns) * appearance.frameHeight, appearance.frameWidth, appearance.frameHeight, 0, 0, canvas.width, canvas.height);
  }
  if (animation && animation.fps > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) animationId = requestAnimationFrame(draw);
}
function render(state) {
  if (!state) return;
  current = state;
  widget.classList.toggle('demo', state.status === 'demo');
  widget.classList.toggle('local', state.status === 'local');
  document.getElementById('name').textContent = state.name ?? '';
  document.getElementById('hint').textContent = state.status === 'demo' ? '演示模式，不关联账号' : state.status === 'local' ? '本机预览，连接网页后同步' : state.offline ? '暂时离线，正在重连' : state.connected && state.status === 'ready' ? '跟随网页桌宠' : '';
  document.getElementById('message').textContent = state.message ?? '';
  document.getElementById('empty-title').textContent = state.connected ? '等待桌宠入住' : '桌面陪伴';
  const key = (state.asset ?? '') + JSON.stringify(state.appearance);
  if (key === renderKey) return;
  renderKey = key; cancelAnimationFrame(animationId); image = null; frame = 0;
  figure.hidden = true; empty.hidden = false;
  if (!state.asset || !state.appearance) return;
  const next = new Image();
  next.onload = () => {
    if (renderKey !== key) return;
    image = next; const a = state.appearance;
    const width = a.type === 'image' ? a.width : a.frameWidth, height = a.type === 'image' ? a.height : a.frameHeight;
    const scale = Math.min(1, 512 / width, 512 / height); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    figure.hidden = false; empty.hidden = true; draw();
  };
  next.onerror = () => { document.getElementById('message').textContent = '桌宠资源无法显示，请在家园重新选择。'; };
  next.src = state.asset;
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => petDesktop.action(button.dataset.action)));
function greet() {
  if (!image) return;
  action = 'greet'; frame = 0; cancelAnimationFrame(animationId); draw();
  const speech = document.getElementById('speech'); speech.hidden = false;
  clearTimeout(greetTimer); greetTimer = setTimeout(() => { speech.hidden = true; action = 'idle'; frame = 0; cancelAnimationFrame(animationId); draw(); }, 1600);
}
let drag = null;
body.addEventListener('pointerdown', event => {
  if (drag || event.button !== 0 || event.target.closest('button')) return;
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  body.setPointerCapture(event.pointerId);
  widget.classList.add('dragging');
  petDesktop.drag('start');
});
body.addEventListener('pointermove', event => {
  if (drag?.pointerId !== event.pointerId) return;
  drag.moved ||= Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4;
  if (drag.moved) petDesktop.drag('move');
});
function endDrag(event) {
  if (drag?.pointerId !== event.pointerId) return;
  const clicked = event.type === 'pointerup' && !drag.moved;
  drag = null;
  widget.classList.remove('dragging');
  petDesktop.drag('end');
  if (clicked) greet();
}
body.addEventListener('pointerup', endDrag);
body.addEventListener('pointercancel', endDrag);
body.addEventListener('lostpointercapture', endDrag);
body.addEventListener('keydown', event => { if (event.target === body && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); greet(); } });
document.addEventListener('mousemove', event => {
  if (drag) return;
  let interactive = Boolean(event.target.closest('[data-interactive]'));
  if (event.target === canvas && image) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * canvas.width / rect.width), y = Math.floor((event.clientY - rect.top) * canvas.height / rect.height);
    interactive = x >= 0 && y >= 0 && x < canvas.width && y < canvas.height && context.getImageData(x, y, 1, 1).data[3] > 10;
  }
  petDesktop.action(interactive ? 'capture' : 'passthrough');
});
document.addEventListener('mouseleave', () => { if (!drag) petDesktop.action('passthrough'); });
petDesktop.onState(render); petDesktop.ready().then(render);
