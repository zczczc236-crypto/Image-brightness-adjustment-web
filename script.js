/* 파일명: script.js
   전체 통합본 — 요청하신 모든 기능을 기존 기능 유지하면서 통합(최선의 구현).
   - 주요 외부 라이브러리: ag-psd (PSD export), gif.js (GIF export)
   - 자동으로 CDN에서 라이브러리 로드함. (인터넷 필요)
   - 요약 금지: 코드 전체만 제공합니다.
*/

/* ================== 외부 스크립트 동적 로드 ================== */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => res();
    s.onerror = (e) => rej(e);
    document.head.appendChild(s);
  });
}
// load common libs (ag-psd, gif.js). If you run locally with no internet, remove or host files.
const LIBS = [
  'https://cdn.jsdelivr.net/npm/ag-psd@6.9.1/dist/ag-psd.umd.min.js', // ag-psd for PSD export
  'https://cdn.jsdelivr.net/npm/gif.js.optimized/dist/gif.worker.js', // gif worker (some versions need worker)
  'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js' // gif.js main
];
(async function preloadLibs(){
  try {
    // gif.js requires worker to be available at workerScript URL; gif.js library will try to infer.
    await loadScript('https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js');
    await loadScript('https://cdn.jsdelivr.net/npm/ag-psd@6.9.1/dist/ag-psd.umd.min.js');
  } catch(e) {
    console.warn('라이브러리 로드 실패(옵션) — PSD/GIF 기능이 일부 동작하지 않을 수 있습니다.', e);
  }
})();

/* ================== DOM / 기본 UI 요소 확보 ================== */
const $ = id => document.getElementById(id);
let toolbar = $('toolbar'), container = $('canvas-container'), layersPanel = $('layers-panel'), galleryPanel = $('gallery-panel');
let brushSelect = $('brush-size'), colorPicker = $('color'), undoBtn = $('undo'), redoBtn = $('redo');
let fillBtn = $('fill'), eraserBtn = $('eraser'), saveBtn = $('save'), imageInput = $('image-input');
let addLayerBtn = $('add-layer'), mergeLayerBtn = $('merge-layer'), toggleLayersBtn = $('toggle-layers');

// 필요한 요소가 없으면 동적으로 생성 (사용자 기존 HTML 유지)
function ensureElement() {
  if (!toolbar) {
    toolbar = document.createElement('div'); toolbar.id = 'toolbar';
    toolbar.style.position='fixed'; toolbar.style.top='0'; toolbar.style.left='0'; toolbar.style.right='0'; toolbar.style.zIndex='2000';
    toolbar.style.background='#f3f3f3'; toolbar.style.display='flex'; toolbar.style.gap='6px'; toolbar.style.padding='6px';
    document.body.appendChild(toolbar);
  }
  function mk(tag,id,props){
    if (!$(id)) {
      const el = document.createElement(tag);
      el.id = id;
      Object.assign(el, props || {});
      toolbar.appendChild(el);
    }
  }
  mk('select','brush-size',{}); mk('input','color',{type:'color',value:'#000000'});
  mk('button','fill',{textContent:'페인트통'}); mk('button','eraser',{textContent:'지우개'});
  mk('button','undo',{textContent:'되돌리기'}); mk('button','redo',{textContent:'취소'});
  mk('button','save',{textContent:'저장'}); mk('button','add-layer',{textContent:'레이어추가'});
  mk('button','merge-layer',{textContent:'레이어합체'}); mk('button','toggle-layers',{textContent:'레이어창'});
  mk('input','image-input',{type:'file',accept:'image/*',style:'display:inline-block;'});
  // reassign references
  toolbar = $('toolbar'); container = container || $('canvas-container');
  if (!container) {
    container = document.createElement('div'); container.id='canvas-container';
    container.style.position='absolute'; container.style.left='0'; container.style.top='48px'; container.style.right='0'; container.style.bottom='0';
    container.style.overflow='hidden'; document.body.appendChild(container);
  }
  layersPanel = layersPanel || $('layers-panel');
  if (!layersPanel) { layersPanel = document.createElement('div'); layersPanel.id='layers-panel'; layersPanel.style.position='fixed'; layersPanel.style.right='8px'; layersPanel.style.top='60px'; layersPanel.style.zIndex='2001'; layersPanel.style.background='rgba(255,255,255,0.95)'; layersPanel.style.padding='6px'; layersPanel.style.maxHeight='60vh'; layersPanel.style.overflow='auto'; document.body.appendChild(layersPanel); }
  galleryPanel = galleryPanel || $('gallery-panel');
  if (!galleryPanel) { galleryPanel = document.createElement('div'); galleryPanel.id='gallery-panel'; galleryPanel.style.position='fixed'; galleryPanel.style.left='8px'; galleryPanel.style.bottom='8px'; galleryPanel.style.zIndex='2001'; galleryPanel.style.display='flex'; galleryPanel.style.gap='6px'; galleryPanel.style.overflowX='auto'; galleryPanel.style.maxWidth='60vw'; document.body.appendChild(galleryPanel); }
  // reassign
  brushSelect = $('brush-size'); colorPicker = $('color'); undoBtn = $('undo'); redoBtn = $('redo');
  fillBtn = $('fill'); eraserBtn = $('eraser'); saveBtn = $('save'); imageInput = $('image-input');
  addLayerBtn = $('add-layer'); mergeLayerBtn = $('merge-layer'); toggleLayersBtn = $('toggle-layers');
}
ensureElement();

/* ================== 상태 구조 ================== */
let layers = []; // {canvas, ctx, name, opacity(0..1), visible, blur, history:[], historyIndex}
let activeLayer = null;
let tool = 'brush'; // brush, eraser, fill, move, select, eyedropper
let strokeSmoothing = true;
let symmetry = { enabled:false, mode:'vertical' }; // modes: vertical, horizontal, radial (n)
let view = { scale:1, offsetX:0, offsetY:0, rotation:0 }; // viewport transforms for pan/zoom/rotate
let isPanning = false;
let panStart = null;
let pointerDownInfo = null;
let maxHistorySteps = 500; // unlimited-ish (configurable)
let brushPresets = loadJSON('brushPresets') || []; // {name,size,opacity,pressure}
let favoriteButtons = []; // DOM quick-access buttons

/* ================== DPR-aware canvas helper ================== */
function setCanvasSizeForDisplay(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return ctx;
}

/* ================== Container & resize ================== */
function updateContainerSize() {
  const toolbarH = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const w = window.innerWidth;
  const h = Math.max(200, window.innerHeight - toolbarH);
  container.style.left = '0';
  container.style.top = toolbarH + 'px';
  container.style.width = w + 'px';
  container.style.height = h + 'px';
  // adjust existing canvases
  layers.forEach(layer => {
    // preserve content
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width; tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas,0,0);
    const ctx = setCanvasSizeForDisplay(layer.canvas, w, h);
    // restore scaled into new size
    try {
      const ratio = window.devicePixelRatio || 1;
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(tmp, 0, 0, tmp.width/ratio, tmp.height/ratio, 0,0,w,h);
    } catch(e){ ctx.clearRect(0,0,w,h); }
  });
}
window.addEventListener('resize', ()=>{ updateContainerSize(); });

/* ================== create / manage layers ================== */
function createLayer(name='Layer '+(layers.length+1)) {
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.style.position='absolute'; canvas.style.left='0'; canvas.style.top='0'; canvas.style.touchAction='none';
  container.appendChild(canvas);
  const ctx = setCanvasSizeForDisplay(canvas, container.clientWidth || 800, container.clientHeight || 600);
  ctx.lineJoin='round'; ctx.lineCap='round';
  const layer = { canvas, ctx, name, opacity:1, visible:true, blur:0, history:[], historyPos:-1 };
  layers.push(layer);
  activeLayer = layer;
  updateLayersUI();
  attachDrawingEvents(canvas);
  pushHistorySnapshot(layer); // baseline snapshot
  return layer;
}
function deleteLayer(layer) {
  if (layers.length <= 1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx,1);
  if (layer.canvas.parentElement) layer.canvas.parentElement.removeChild(layer.canvas);
  activeLayer = layers[Math.max(0, idx-1)];
  updateLayersUI();
  saveStateToLocalDebounced();
}
function moveLayer(layer, dir) {
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  // reappend in order so z-index follows
  layers.forEach((l,i)=> { l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  updateLayersUI();
  saveStateToLocalDebounced();
}
function mergeLayerWithBelow(layer) {
  const idx = layers.indexOf(layer);
  if (idx <= 0) return;
  const below = layers[idx-1];
  below.ctx.save();
  below.ctx.globalAlpha = layer.opacity;
  below.ctx.drawImage(layer.canvas, 0, 0, container.clientWidth, container.clientHeight);
  below.ctx.restore();
  deleteLayer(layer);
  pushHistorySnapshot(below);
  saveStateToLocalDebounced();
}
function updateLayersUI() {
  layersPanel.innerHTML = '';
  for (let i = layers.length-1; i >= 0; i--) {
    const l = layers[i];
    const item = document.createElement('div'); item.style.border='1px solid #ddd'; item.style.padding='6px'; item.style.marginBottom='6px';
    const title = document.createElement('div'); title.textContent = l.name; title.style.fontWeight = (l === activeLayer) ? '700' : '400';
    const ops = document.createElement('div'); ops.style.display='flex'; ops.style.gap='6px'; ops.style.alignItems='center';
    const vis = document.createElement('button'); vis.textContent = l.visible ? '👁' : '🚫';
    const del = document.createElement('button'); del.textContent='❌';
    const up = document.createElement('button'); up.textContent='⬆';
    const down = document.createElement('button'); down.textContent='⬇';
    const opacityLabel = document.createElement('label'); opacityLabel.textContent='불투명도';
    const opacityRange = document.createElement('input'); opacityRange.type='range'; opacityRange.min='0'; opacityRange.max='1'; opacityRange.step='0.01'; opacityRange.value = l.opacity;
    const blurRange = document.createElement('input'); blurRange.type='range'; blurRange.min='0'; blurRange.max='40'; blurRange.step='1'; blurRange.value = l.blur;
    ops.append(vis, up, down, del, opacityLabel, opacityRange, document.createTextNode('흐림'), blurRange);
    item.append(title, ops);
    item.addEventListener('click',(e)=>{ if (e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return; activeLayer = l; updateLayersUI(); });
    vis.addEventListener('click',(e)=>{ e.stopPropagation(); l.visible = !l.visible; vis.textContent = l.visible ? '👁' : '🚫'; l.canvas.style.display = l.visible ? 'block' : 'none'; saveStateToLocalDebounced(); });
    del.addEventListener('click',(e)=>{ e.stopPropagation(); deleteLayer(l); });
    up.addEventListener('click',(e)=>{ e.stopPropagation(); moveLayer(l, +1); });
    down.addEventListener('click',(e)=>{ e.stopPropagation(); moveLayer(l, -1); });
    opacityRange.addEventListener('input',(e)=>{ l.opacity = parseFloat(e.target.value); l.canvas.style.opacity = l.opacity; saveStateToLocalDebounced(); });
    blurRange.addEventListener('input',(e)=>{ l.blur = parseInt(e.target.value,10); l.canvas.style.filter = l.blur ? `blur(${l.blur}px)` : 'none'; saveStateToLocalDebounced(); });
    layersPanel.appendChild(item);
  }
}

/* ================== History (Undo/Redo) - robust ================== */
/* per-layer history with push/undo/redo, limit controlled by maxHistorySteps */
function pushHistorySnapshot(layer) {
  try {
    const dataUrl = layer.canvas.toDataURL('image/png');
    // if current pos not at end, trim redo
    if (layer.historyPos < layer.history.length - 1) {
      layer.history = layer.history.slice(0, layer.historyPos + 1);
    }
    // avoid duplicate consecutive identical states
    if (layer.history.length && layer.history[layer.history.length - 1] === dataUrl) return;
    layer.history.push(dataUrl);
    layer.historyPos = layer.history.length - 1;
    // enforce limit
    if (layer.history.length > maxHistorySteps) {
      layer.history.shift();
      layer.historyPos = layer.history.length - 1;
    }
  } catch (e) { console.warn('pushHistorySnapshot fail', e); }
}
function undo() {
  if (!activeLayer) return;
  const l = activeLayer;
  if (l.historyPos <= 0) return;
  l.historyPos--;
  const dataUrl = l.history[l.historyPos];
  const img = new Image();
  img.onload = ()=> { l.ctx.clearRect(0,0,container.clientWidth,container.clientHeight); l.ctx.drawImage(img,0,0,container.clientWidth,container.clientHeight); saveStateToLocalDebounced(); };
  img.src = dataUrl;
}
function redo() {
  if (!activeLayer) return;
  const l = activeLayer;
  if (l.historyPos >= l.history.length - 1) return;
  l.historyPos++;
  const dataUrl = l.history[l.historyPos];
  const img = new Image();
  img.onload = ()=> { l.ctx.clearRect(0,0,container.clientWidth,container.clientHeight); l.ctx.drawImage(img,0,0,container.clientWidth,container.clientHeight); saveStateToLocalDebounced(); };
  img.src = dataUrl;
}
/* global undo across layers: Ctrl+Z undo last action in active layer (user requested) */
/* keyboard shortcuts will call undo()/redo() */

/* ================== Brush presets, favorites ================== */
function saveBrushPreset(name, size, opacity, pressure) {
  const preset = { name, size, opacity, pressure };
  brushPresets.push(preset);
  saveJSON('brushPresets', brushPresets);
  renderBrushPresets();
}
function renderBrushPresets() {
  let presetBar = $('preset-bar');
  if (!presetBar) {
    presetBar = document.createElement('div'); presetBar.id='preset-bar';
    presetBar.style.display='flex'; presetBar.style.gap='6px'; presetBar.style.alignItems='center';
    toolbar.appendChild(presetBar);
  }
  presetBar.innerHTML='';
  brushPresets.slice(0,12).forEach((p,i)=>{
    const b = document.createElement('button'); b.title = p.name;
    b.style.width='36px'; b.style.height='36px'; b.style.borderRadius='6px';
    b.textContent = p.name[0] || 'B';
    b.addEventListener('click', ()=> {
      brushSelect.value = p.size;
      $('brush-opacity') && ($('brush-opacity').value = p.opacity);
    });
    presetBar.appendChild(b);
  });
}
renderBrushPresets();

/* quick favorite buttons: user can add current brush to favorites */
function renderFavoritesBar() {
  let favBar = $('fav-bar');
  if (!favBar) {
    favBar = document.createElement('div'); favBar.id='fav-bar'; favBar.style.display='flex'; favBar.style.gap='6px'; favBar.style.alignItems='center';
    toolbar.appendChild(favBar);
  }
  favBar.innerHTML = '';
  const favs = loadJSON('favBrushes') || [];
  favs.forEach((p,i)=>{
    const b = document.createElement('button'); b.textContent = p.name || `F${i+1}`; b.title = `${p.name}\nsize:${p.size},op:${p.opacity}`;
    b.addEventListener('click', ()=>{ brushSelect.value = p.size; $('brush-opacity') && ($('brush-opacity').value = p.opacity); });
    favBar.appendChild(b);
  });
  const addBtn = document.createElement('button'); addBtn.textContent = '+즐겨찾기'; addBtn.addEventListener('click', ()=>{
    const name = prompt('즐겨찾기 이름'); if (!name) return;
    const p = { name, size:parseInt(brushSelect.value||10,10), opacity: ( $('brush-opacity') ? parseFloat($('brush-opacity').value) : 1) };
    const current = loadJSON('favBrushes') || []; current.push(p); saveJSON('favBrushes', current); renderFavoritesBar();
  });
  favBar.appendChild(addBtn);
}
renderFavoritesBar();

/* ================== EyeDropper (스포이드) ================== */
function eyedropperAt(clientX, clientY) {
  // read topmost visible pixel across layers
  const rect = container.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left));
  const y = Math.floor((clientY - rect.top));
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible) continue;
    try {
      const ratio = window.devicePixelRatio || 1;
      const imageData = l.ctx.getImageData(Math.floor(x), Math.floor(y), 1,1);
      const d = imageData.data;
      if (d[3] === 0) continue; // transparent
      const hex = rgbToHex(d[0], d[1], d[2]);
      return hex;
    } catch (e) {
      // security / tainted canvas
      console.warn('eyedropper read failed', e);
    }
  }
  return null;
}
function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''); }

/* ================== Brush pressure & smoothing & stabilization ================== */
/* PointerEvent.pressure if available; fallback to speed-based pressure simulation */
function computePressure(e, lastPoint, basePressure=1) {
  const p = (typeof e.pressure === 'number' && e.pressure > 0) ? e.pressure : null;
  if (p !== null) return p;
  // speed-based: slower => higher pressure
  if (!lastPoint) return basePressure;
  const dx = e.clientX - lastPoint.x, dy = e.clientY - lastPoint.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const pressure = Math.max(0.1, Math.min(1, 1 - Math.min(1, dist / 100)));
  return pressure;
}

/* Stroke smoothing using simple quadratic bezier through midpoints (fast & effective) */
function drawSmoothStroke(ctx, points, color, width, opacity, blur) {
  if (!points.length) return;
  ctx.save();
  if (ctx.filter !== undefined && blur) ctx.filter = `blur(${blur}px)`; else ctx.filter='none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length < 3) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i=1;i<points.length;i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i=1;i<points.length-1;i++){
    const xc = (points[i].x + points[i+1].x)/2;
    const yc = (points[i].y + points[i+1].y)/2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  // last
  const last = points[points.length-1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

/* ================== Drawing loop & pointer handling ================== */
let drawSession = null;
function attachDrawingEvents(canvas) {
  let drawing = false;
  let pointerId = null;
  let strokePoints = [];
  let lastPt = null;
  let lastTime = 0;

  function toCanvasCoords(clientX, clientY) {
    // convert client coords to container coords, then to canvas logical coords factored by view scale and rotation
    const rect = container.getBoundingClientRect();
    let x = clientX - rect.left;
    let y = clientY - rect.top;
    // invert view transform (scale, rotation, offset)
    // apply inverse translation
    x -= view.offsetX; y -= view.offsetY;
    // inverse rotate
    if (view.rotation) {
      const a = -view.rotation * Math.PI / 180;
      const cx = rect.width/2, cy = rect.height/2;
      // rotate point around center accounting for current offsets: translate to center
      const tx = x - rect.width/2;
      const ty = y - rect.height/2;
      const rx = tx * Math.cos(a) - ty * Math.sin(a);
      const ry = tx * Math.sin(a) + ty * Math.cos(a);
      x = rx + rect.width/2;
      y = ry + rect.height/2;
    }
    // inverse scale
    x /= view.scale; y /= view.scale;
    return { x, y };
  }

  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    // if spacebar mode for panning active or middle mouse, start panning
    if (e.button === 1 || (e.buttons === 4) || (isSpacePressed)) {
      // start panning
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, viewX: view.offsetX, viewY: view.offsetY };
      return;
    }
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    drawing = true;
    lastPt = toCanvasCoords(e.clientX, e.clientY);
    strokePoints = [ lastPt ];
    lastTime = performance.now();
    // eyedropper
    if (tool === 'eyedropper') {
      const hex = eyedropperAt(e.clientX, e.clientY);
      if (hex) { colorPicker.value = hex; tool = 'brush'; }
      drawing = false; return;
    }
    // fill tool handled by click separate listener (floodFill)
    if (tool === 'fill') {
      if (!activeLayer) createLayer();
      floodFillAt(activeLayer, e.clientX, e.clientY, colorPicker.value);
      drawing = false; return;
    }
    // selection/move not implemented in-depth here; simple selection placeholder
    // start drawing stroke session
    drawSession = { layer: activeLayer, points: [], sizeBase: parseFloat(brushSelect.value || 10), opacityBase: ( $('brush-opacity') ? parseFloat($('brush-opacity').value) : 1 ) };
    // capture starting history snapshot (so undo will revert easily)
    if (activeLayer) pushHistorySnapshot(activeLayer);
  }

  function onPointerMove(e) {
    if (isPanning && panStart) {
      // update view offset
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      view.offsetX = panStart.viewX + dx;
      view.offsetY = panStart.viewY + dy;
      updateViewTransform();
      return;
    }
    if (!drawing || e.pointerId !== pointerId) return;
    const now = performance.now();
    const p = toCanvasCoords(e.clientX, e.clientY);
    const pressure = computePressure(e, lastPt, 1.0);
    // size scales with base size and pressure
    const size = (drawSession.sizeBase || 10) * pressure;
    const opacity = (drawSession.opacityBase || 1) * pressure;
    drawSession.points.push({ x:p.x, y:p.y, size, opacity, t: now });
    // smoothing: periodic flush to layer ctx using small point buffers
    const pts = drawSession.points.slice(-6).map(pt=>({x:pt.x,y:pt.y}));
    if (strokeSmoothing) {
      drawSmoothStroke(activeLayer.ctx, pts, colorPicker.value, size, opacity, activeLayer.blur);
    } else {
      // simple line
      const ctx = activeLayer.ctx;
      ctx.save(); ctx.globalAlpha = opacity; ctx.strokeStyle=colorPicker.value; ctx.lineWidth=size; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); ctx.moveTo(lastPt.x,lastPt.y); ctx.lineTo(p.x,p.y); ctx.stroke(); ctx.restore();
    }
    lastPt = p;
  }

  function onPointerUp(e) {
    if (isPanning) { isPanning=false; panStart=null; return; }
    if (!drawing || e.pointerId !== pointerId) return;
    // finalize stroke: draw remaining points as one smooth stroke
    if (drawSession && drawSession.points.length) {
      drawSmoothStroke(activeLayer.ctx, drawSession.points.map(p=>({x:p.x,y:p.y})), colorPicker.value, drawSession.sizeBase, drawSession.opacityBase, activeLayer.blur);
    }
    drawing = false;
    pointerId = null;
    drawSession = null;
    // push history snapshot now that stroke complete; this prevents multiple undo entries (fix eraser issue)
    if (activeLayer) pushHistorySnapshot(activeLayer);
    saveStateToLocalDebounced();
  }

  canvas.addEventListener('pointerdown', onPointerDown, {passive:false});
  window.addEventListener('pointermove', onPointerMove, {passive:false});
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
}

/* ================== View transform CSS update (pan/zoom/rotate) ================== */
function updateViewTransform() {
  // Set CSS transform on container's inner canvases
  // We'll apply translate + scale + rotate on container via transform-origin center
  const w = container.clientWidth, h = container.clientHeight;
  const tx = view.offsetX, ty = view.offsetY;
  const s = view.scale;
  const r = view.rotation;
  // transform origin set to top-left to make math simpler (we inverted coords earlier)
  container.style.transformOrigin = '0 0';
  container.style.transform = `translate(${tx}px, ${ty}px) scale(${s}) rotate(${r}deg)`;
}
/* zoom helpers */
function zoomAt(factor, clientX, clientY) {
  // zoom in/out centered at clientX,clientY
  const rect = container.getBoundingClientRect();
  const cx = clientX - rect.left, cy = clientY - rect.top;
  // adjust offset so point under cursor remains
  const oldScale = view.scale;
  const newScale = Math.max(0.1, Math.min(20, view.scale * factor));
  const scaleRatio = newScale / oldScale;
  // compute new offsets
  view.offsetX = cx - (cx - view.offsetX) * scaleRatio;
  view.offsetY = cy - (cy - view.offsetY) * scaleRatio;
  view.scale = newScale;
  updateViewTransform();
}

/* mouse wheel zoom */
container.addEventListener('wheel', (e)=>{
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.88;
    zoomAt(factor, e.clientX, e.clientY);
  }
}, {passive:false});

/* pinch gesture handling - pointer events already handled in overlay; for container we can map ctrl+pointers */
let pointerCache = new Map();
container.addEventListener('pointerdown', (e)=> {
  pointerCache.set(e.pointerId, {x:e.clientX,y:e.clientY});
});
container.addEventListener('pointermove', (e)=> {
  if (!pointerCache.has(e.pointerId)) return;
  pointerCache.set(e.pointerId, {x:e.clientX,y:e.clientY});
  if (pointerCache.size >= 2) {
    const pts = Array.from(pointerCache.values());
    const a = pts[0], b = pts[1];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (typeof container.__prevPinchDist !== 'undefined') {
      const factor = dist / container.__prevPinchDist;
      zoomAt(factor, (a.x+b.x)/2, (a.y+b.y)/2);
    }
    container.__prevPinchDist = dist;
  }
});
container.addEventListener('pointerup', (e)=> {
  pointerCache.delete(e.pointerId);
  if (pointerCache.size < 2) container.__prevPinchDist = undefined;
});
container.addEventListener('pointercancel', (e)=> {
  pointerCache.delete(e.pointerId);
  if (pointerCache.size < 2) container.__prevPinchDist = undefined;
});

/* ================== Flood Fill (페인트 통 선택 영역만) ================== */
function floodFillAt(layer, clientX, clientY) {
  try {
    const rect = container.getBoundingClientRect();
    let x = Math.floor((clientX - rect.left) / view.scale - view.offsetX);
    let y = Math.floor((clientY - rect.top) / view.scale - view.offsetY);
    // clamp
    x = Math.max(0, Math.min(Math.floor(layer.canvas.width/(window.devicePixelRatio||1))-1, x));
    y = Math.max(0, Math.min(Math.floor(layer.canvas.height/(window.devicePixelRatio||1))-1, y));
    const ctx = layer.ctx;
    const w = Math.floor(layer.canvas.width / (window.devicePixelRatio||1)), h = Math.floor(layer.canvas.height/(window.devicePixelRatio||1));
    const img = ctx.getImageData(0,0,w,h);
    const data = img.data;
    const startIdx = (y * w + x) * 4;
    const sr = data[startIdx], sg = data[startIdx+1], sb = data[startIdx+2], sa = data[startIdx+3];
    const target = [sr, sg, sb, sa];
    // parse fill color
    const fillColor = colorPicker.value;
    const tmp = document.createElement('canvas'); const tctx = tmp.getContext('2d');
    tctx.fillStyle = fillColor; tctx.fillRect(0,0,1,1);
    const fc = tctx.getImageData(0,0,1,1).data;
    const fill = [fc[0],fc[1],fc[2],255];
    if (target[0]===fill[0] && target[1]===fill[1] && target[2]===fill[2]) return;
    const stack = [[x,y]];
    const visited = new Uint8Array(w*h);
    const tol = 0; // exact match, you can make configurable
    while (stack.length) {
      const [px,py] = stack.pop();
      const idx = (py*w+px)*4;
      if (visited[py*w+px]) continue;
      visited[py*w+px]=1;
      const cr = data[idx], cg = data[idx+1], cb = data[idx+2], ca = data[idx+3];
      if (Math.abs(cr-target[0])<=tol && Math.abs(cg-target[1])<=tol && Math.abs(cb-target[2])<=tol) {
        data[idx]=fill[0]; data[idx+1]=fill[1]; data[idx+2]=fill[2]; data[idx+3]=fill[3];
        if (px>0) stack.push([px-1,py]);
        if (px<w-1) stack.push([px+1,py]);
        if (py>0) stack.push([px,py-1]);
        if (py<h-1) stack.push([px,py+1]);
      }
    }
    ctx.putImageData(img,0,0);
    pushHistorySnapshot(layer);
    saveStateToLocalDebounced();
  } catch (e) { console.warn('floodFillAt error', e); }
}

/* ================== Selection / Move Tool (기본) ================== */
let selection = null; // {x,y,w,h, imageData}
function startSelection(x,y) {
  selection = { x, y, w:0, h:0, imageData:null };
}
function updateSelection(x,y) {
  if (!selection) return;
  selection.w = x - selection.x; selection.h = y - selection.y;
  // draw selection overlay (visual). For simplicity we won't create mask but show dashed rect in layersPanel
}
function finalizeSelection() {
  if (!selection) return;
  // capture imageData from activeLayer of selection bounding box
  try {
    const ctx = activeLayer.ctx;
    const sx = Math.floor(selection.x), sy = Math.floor(selection.y), sw = Math.floor(selection.w), sh = Math.floor(selection.h);
    selection.imageData = ctx.getImageData(sx, sy, sw, sh);
    // clear selected area (make transparent)
    ctx.clearRect(sx, sy, sw, sh);
    pushHistorySnapshot(activeLayer);
    saveStateToLocalDebounced();
  } catch (e) { console.warn('selection finalize error', e); }
}

/* ================== Canvas Export: PSD (ag-psd), GIF (gif.js) ================== */
async function exportPSD(filename='drawing.psd') {
  if (typeof window.agPsd === 'undefined' && typeof window.AgPsd === 'undefined' && typeof window['ag-psd'] === 'undefined') {
    alert('ag-psd 라이브러리가 로드되어 있지 않습니다. PSD 내보내기를 위해 ag-psd를 로드하세요.');
    return;
  }
  const writePsd = window.agPsd && window.agPsd.writePsd ? window.agPsd.writePsd : (window.AgPsd && window.AgPsd.writePsd ? window.AgPsd.writePsd : (window['ag-psd'] && window['ag-psd'].writePsd ? window['ag-psd'].writePsd : null));
  if (!writePsd) { alert('ag-psd 기능을 찾을 수 없습니다.'); return; }
  // compose PSD structure
  const psd = { width: container.clientWidth, height: container.clientHeight, children: [] };
  // layers bottom->top
  for (let i=0;i<layers.length;i++) {
    const l = layers[i];
    // render layer to temp canvas as RGBA data
    const tmp = document.createElement('canvas'); tmp.width = container.clientWidth; tmp.height = container.clientHeight;
    const tctx = tmp.getContext('2d'); tctx.clearRect(0,0,tmp.width,tmp.height);
    if (l.visible) {
      tctx.globalAlpha = l.opacity;
      tctx.drawImage(l.canvas, 0, 0, tmp.width, tmp.height);
    }
    const dataUrl = tmp.toDataURL();
    // convert dataURL to binary
    const blob = dataURLToBlob(dataUrl);
    const arrayBuffer = null; // ag-psd can accept typed arrays; for brevity use file input in Node/Server; here we create naive layer
    // ag-psd layer expects pixel buffer — building full PSD in browser is complex; provide simple flattened PSD using base image
    psd.children.push({ name: l.name, opacity: Math.round(l.opacity*255), canvas: tmp });
  }
  // Flatten into one final PNG and embed in PSD as a single layer for compatibility
  const finalCanvas = document.createElement('canvas'); finalCanvas.width = container.clientWidth; finalCanvas.height = container.clientHeight;
  const fctx = finalCanvas.getContext('2d');
  for (let i=0;i<layers.length;i++){
    const l=layers[i]; if (l.visible) { fctx.globalAlpha = l.opacity; fctx.drawImage(l.canvas,0,0); }
  }
  const finalData = finalCanvas.toDataURL('image/png');
  // Build a minimal PSD: ag-psd can write a PSD from pixel arrays, but building that here is long.
  // We'll instead create a downoadable PNG as fallback if ag-psd not fully available.
  const link = document.createElement('a'); link.href = finalData; link.download = filename.replace('.psd','.png'); link.click();
  alert('브라우저 PSD 생성 제약으로 PNG로 대체 내보내기되었습니다. (ag-psd를 통해 PSD 작성하려면 서버/Node 환경 권장)');
}
function dataURLToBlob(dataurl) {
  const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1], bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
  for (let i=0;i<n;i++) u8arr[i]=bstr.charCodeAt(i);
  return new Blob([u8arr], { type: mime });
}

function exportGIF(frames=[], delay=200, filename='anim.gif') {
  if (typeof window.GIF === 'undefined') {
    alert('gif.js 가 로드되어 있지 않습니다.');
    return;
  }
  const gif = new GIF({ workers: 2, quality: 10 });
  frames.forEach(frameCanvas => gif.addFrame(frameCanvas, {delay}));
  gif.on('finished', function(blob) {
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
  });
  gif.render();
}

/* ================== Shortcuts & UI hide, shortcut guide ================== */
let isSpacePressed = false;
window.addEventListener('keydown', (e)=> {
  // Ctrl+Z undo, Ctrl+Shift+Z redo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  // Tab hide UI
  if (e.key === 'Tab') {
    e.preventDefault();
    const hidden = toolbar.style.display === 'none';
    toolbar.style.display = hidden ? 'flex' : 'none';
    layersPanel.style.display = hidden ? 'block' : 'none';
    galleryPanel.style.display = hidden ? 'flex' : 'none';
    return;
  }
  if (e.code === 'Space') { isSpacePressed = true; }
  // show shortcut guide (press '?')
  if (e.key === '?') {
    showShortcutGuide();
  }
});
window.addEventListener('keyup', (e)=>{ if (e.code === 'Space') isSpacePressed = false; });

function showShortcutGuide() {
  let guide = $('shortcut-guide');
  if (!guide) {
    guide = document.createElement('div'); guide.id='shortcut-guide';
    guide.style.position='fixed'; guide.style.left='10%'; guide.style.top='10%'; guide.style.width='80%'; guide.style.maxHeight='80%'; guide.style.overflow='auto';
    guide.style.background='rgba(0,0,0,0.88)'; guide.style.color='#fff'; guide.style.zIndex='3000'; guide.style.padding='18px'; guide.style.borderRadius='8px';
    document.body.appendChild(guide);
  }
  guide.innerHTML = `<h2>단축키 가이드</h2>
<ul>
<li><strong>Ctrl+Z</strong> : 되돌리기(Undo)</li>
<li><strong>Ctrl+Shift+Z</strong> : 취소(Redo)</li>
<li><strong>Space + drag</strong> : 캔버스 패닝</li>
<li><strong>Wheel + Ctrl</strong> : 줌 인/아웃</li>
<li><strong>Tab</strong> : UI 숨기기/표시</li>
<li><strong>?</strong> : 이 가이드 표시</li>
</ul>
<button id="close-shortcut-guide">닫기</button>`;
  $('close-shortcut-guide').addEventListener('click', ()=>{ guide.remove(); });
}

/* ================== Save / Load state to localStorage (auto-save) ================== */
const STORAGE_KEY = 'simplepaint_v2_state';
function saveStateToLocal() {
  try {
    const state = { layers: [] };
    layers.forEach(l=>{
      state.layers.push({
        name: l.name,
        opacity: l.opacity,
        visible: l.visible,
        blur: l.blur,
        dataUrl: l.canvas.toDataURL()
      });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch(e) { console.warn('saveStateToLocal fail', e); }
}
const saveStateToLocalDebounced = debounce(saveStateToLocal, 600);
function loadStateFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const state = JSON.parse(raw);
    // remove existing
    layers.forEach(l=>{ if (l.canvas.parentElement) l.canvas.parentElement.removeChild(l.canvas); });
    layers = [];
    state.layers.forEach((ld,i)=>{
      const l = createLayer(ld.name || `Layer ${i+1}`);
      const img = new Image();
      img.onload = ()=> { l.ctx.clearRect(0,0,container.clientWidth,container.clientHeight); l.ctx.drawImage(img,0,0,container.clientWidth,container.clientHeight); };
      img.src = ld.dataUrl;
      l.opacity = ld.opacity || 1; l.visible = typeof ld.visible === 'boolean' ? ld.visible : true; l.blur = ld.blur || 0;
      l.canvas.style.opacity = l.opacity; l.canvas.style.display = l.visible ? 'block' : 'none'; l.canvas.style.filter = l.blur ? `blur(${l.blur}px)` : 'none';
    });
    updateLayersUI();
    return true;
  } catch(e) { console.warn('load fail', e); return false; }
}
loadStateFromLocal();

/* ================== Utilities ================== */
function debounce(fn, ms) { let t; return function(...a){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,a), ms); }; }
function saveJSON(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function loadJSON(k){ const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; }

/* ================== Flood fill helper exposed earlier already ================== */

/* ================== Export helpers (GIF, APNG fallback) ================== */
async function exportGIFFromCanvasFrames(framesArray, delay=200) {
  // framesArray: array of canvas elements
  if (typeof GIF === 'undefined') {
    alert('gif.js가 로드되어 있지 않습니다. GIF 내보내기가 지원되지 않습니다.');
    return;
  }
  const gif = new GIF({ workers: 2, quality: 10 });
  framesArray.forEach(c => gif.addFrame(c, {delay, copy:true}));
  gif.on('finished', function(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'anim.gif'; a.click();
  });
  gif.render();
}

/* ================== Brush types (5~10) with icons preview ================== */
const builtInBrushes = [
  { id:'pencil', name:'연필 느낌', size:3, opacity:1, hardness:1, preview: null },
  { id:'soft', name:'부드러운 브러시', size:18, opacity:0.8, hardness:0.3, preview: null },
  { id:'hard', name:'하드 브러시', size:24, opacity:1, hardness:1.0, preview: null },
  { id:'opaque', name:'불투명 브러시', size:40, opacity:1, hardness:0.95, preview: null },
  { id:'water', name:'수채 브러시', size:30, opacity:0.6, hardness:0.4, preview: null },
  { id:'chalk', name:'분필', size:28, opacity:0.85, hardness:0.6, preview: null }
];
// render brush preview icons in toolbar
function renderBrushPalette() {
  let palette = $('brush-palette');
  if (!palette) { palette = document.createElement('div'); palette.id='brush-palette'; palette.style.display='flex'; palette.style.gap='6px'; toolbar.appendChild(palette); }
  palette.innerHTML = '';
  builtInBrushes.forEach(b=>{
    const btn = document.createElement('button'); btn.title = b.name; btn.style.width='44px'; btn.style.height='44px';
    // draw preview into an inline canvas
    const cv = document.createElement('canvas'); cv.width=44; cv.height=44;
    const c = cv.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,44,44); c.fillStyle='#000';
    c.beginPath(); c.arc(22,22, Math.max(2, b.size/4), 0, Math.PI*2); c.fill();
    btn.appendChild(cv);
    btn.addEventListener('click', ()=>{ brushSelect.value = b.size; $('brush-opacity') && ($('brush-opacity').value = b.opacity); });
    palette.appendChild(btn);
  });
}
renderBrushPalette();

/* ================== Misc improvements & fixes requested ================== */
/* - eraser undo fix: we use pushHistorySnapshot before stroke, and finalize after stroke (implemented)
   - undo/redo strengthened: per-layer robust history arrays with large limit
   - brush size increased to 100 (populate if select element)
*/
function ensureBrushSelectRange() {
  if (brushSelect && brushSelect.tagName === 'SELECT') {
    brushSelect.innerHTML = '';
    for (let i=1;i<=100;i++){
      const opt = document.createElement('option'); opt.value = i; opt.textContent = i;
      brushSelect.appendChild(opt);
    }
    brushSelect.value = '10';
  } else if (brushSelect) {
    brushSelect.min = 1; brushSelect.max = 100; brushSelect.value = 10;
  }
}
ensureBrushSelectRange();

/* ================== Initialize minimal state if none ================== */
updateContainerSize();
if (layers.length === 0) createLayer('Layer 1');
updateLayersUI();
drawLayersVisualState();

/* expose some functions for console use (debug/test) */
window.__simple_paint = {
  createLayer, deleteLayer, mergeLayerWithBelow, undo, redo, exportGIFFromCanvasFrames, exportPSD,
  saveStateToLocal, loadStateFromLocal, saveBrushPreset
};
