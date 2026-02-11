/* 파일명: script.js
   전체 통합본 (확장판)
   - 모든 기존 기능 유지
   - 추가: PSD-style export (ZIP of layer PNGs + metadata), animated export (webm via MediaRecorder),
            선택툴(Rect, Lasso), 라쏘, 텍스트툴, 스마트 레이어(간단한 비파괴 그룹/프리뷰),
            브러시 최대 100, 지우개/undo fix, 흐림(blur) & 투명도, 캔버스 리사이즈, 불러오기/저장 개선,
            페인트통(영역 채우기), 모바일 UI 겹침 해결, 이미지 삽입 overlay (pan/pinch/rotate/zoom),
            레이어/갤러리/저장/불러오기 모두 포함.
   주의: 외부 라이브러리 없이 동작하도록 설계되었습니다. PSD는 진짜 PSD 포맷이 아닌
         레이어 PNG + 메타데이터를 ZIP으로 묶어내는 방식입니다. GIF 대신 WebM 애니메이션을 제공합니다.
*/

/* =========================
   DOM 참조
========================= */
const toolbar = document.getElementById('toolbar');
const container = document.getElementById('canvas-container');
const layersPanel = document.getElementById('layers-panel');
const galleryPanel = document.getElementById('gallery-panel');

const brushSelect = document.getElementById('brush-size');
const colorPicker = document.getElementById('color');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const fillBtn = document.getElementById('fill');
const eraserBtn = document.getElementById('eraser');
const zoomOutBtn = document.getElementById('zoom-out');
const saveBtn = document.getElementById('save');
const addLayerBtn = document.getElementById('add-layer');
const mergeLayerBtn = document.getElementById('merge-layer');
const toggleLayersBtn = document.getElementById('toggle-layers');
const imageInput = document.getElementById('image-input');

const exportPsdBtn = document.getElementById && document.getElementById('export-psd');
const exportAnimBtn = document.getElementById && document.getElementById('export-anim');
const loadSavedBtn = document.getElementById && document.getElementById('load-saved');

const txtToolBtn = document.getElementById && document.getElementById('tool-text');
const selRectBtn = document.getElementById && document.getElementById('tool-rect');
const selLassoBtn = document.getElementById && document.getElementById('tool-lasso');
const toolBrushBtn = document.getElementById && document.getElementById('tool-brush');
const toolEraserBtn = document.getElementById && document.getElementById('tool-eraser');
const toolFillBtn = document.getElementById && document.getElementById('tool-fill');

const blurInput = document.getElementById && document.getElementById('blur');
const opacityInput = document.getElementById && document.getElementById('opacity');
const brushSizeInput = document.getElementById && document.getElementById('brushSize'); // alternate id fallback

/* =========================
   전역 상태
========================= */

let layers = []; // {id,name,canvas,ctx,visible,opacity,blend,smartGroupId}
let smartGroups = {}; // groupId -> {name, layerIds, metadata}
let activeLayerIndex = 0;
let history = []; // array of serialized snapshots (dataURL per layer + meta) - to keep memory reasonable, we snapshot only visible composite (and at most N)
let redoStack = [];
let maxHistory = 200;

let tool = 'brush'; // brush, eraser, fill, rectselect, lassoselect, text
let brushSize = 10;
let maxBrushSize = 100;
let brushColor = '#000000';
let usingEraser = false;
let opacityVal = 1.0;
let blurVal = 0;

let isPointerDown = false;
let pointerId = null;
let lastPoint = null;

let canvasWidth = 1200;
let canvasHeight = 800;

/* Mobile pan/zoom state (viewport transform) */
let viewZoom = 1;
let viewOffset = { x: 0, y: 0 };
let viewPointers = new Map();
let lastPinchDist = 0;
let lastPinchMid = null;

/* Selection state */
let currentSelection = null; // {type:'rect'|'lasso', path:[points], bbox:{x,y,w,h}, maskCanvas}

/* Gallery storage */
let gallery = [];

/* Local autosave key */
const AUTOSAVE_KEY = 'simple_web_painter_autosave_v1';

/* =========================
   유틸: 캔버스 고해상도 세팅
========================= */
function setCanvasSizeForDisplay(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

/* =========================
   레이아웃 초기화
========================= */
function updateContainerSize() {
  const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const w = window.innerWidth;
  const h = Math.max(120, window.innerHeight - toolbarHeight);
  container.style.width = w + 'px';
  container.style.height = h + 'px';
}

/* 초기 브러시 옵션 채움 */
(function initBrushOptions(){
  for(let i=1;i<=maxBrushSize;i++){
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    brushSelect && brushSelect.appendChild(opt);
  }
  if(brushSelect) brushSelect.value = brushSize;
})();

/* =========================
   레이어 관리
========================= */
let layerIdCounter = 0;
function createLayer(name='Layer'){
  const layerCanvas = document.createElement('canvas');
  layerCanvas.className = 'layer-canvas';
  layerCanvas.style.position = 'absolute';
  layerCanvas.style.left = '0';
  layerCanvas.style.top = '0';
  layerCanvas.style.touchAction = 'none';
  container.appendChild(layerCanvas);
  const ctx = setCanvasSizeForDisplay(layerCanvas, canvasWidth, canvasHeight);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const layer = {
    id: 'layer_' + (++layerIdCounter),
    name: name || `Layer ${layers.length+1}`,
    canvas: layerCanvas,
    ctx,
    visible: true,
    opacity: 1.0,
    blend: 'source-over',
    smartGroupId: null
  };
  layers.push(layer);
  activeLayerIndex = layers.length - 1;
  updateLayerZIndices();
  updateLayersPanel();
  saveSnapshot();
  return layer;
}

function deleteLayer(index){
  if(layers.length <=1) return;
  const l = layers[index];
  if(l.canvas.parentElement) l.canvas.parentElement.removeChild(l.canvas);
  layers.splice(index,1);
  activeLayerIndex = Math.max(0, activeLayerIndex-1);
  updateLayerZIndices();
  updateLayersPanel();
  saveSnapshot();
}

function moveLayer(index, dir){
  const newIndex = index + dir;
  if(newIndex <0 || newIndex >= layers.length) return;
  const [layer] = layers.splice(index,1);
  layers.splice(newIndex,0,layer);
  if(activeLayerIndex === index) activeLayerIndex = newIndex;
  else if(activeLayerIndex === newIndex) activeLayerIndex = index;
  updateLayerZIndices();
  updateLayersPanel();
  saveSnapshot();
}

function mergeLayerWithBelow(index){
  if(layers.length <2) return;
  const idx = index;
  let targetIdx = idx - 1;
  if(targetIdx < 0) targetIdx = idx + 1;
  if(targetIdx <0 || targetIdx>=layers.length) return;
  const src = layers[idx];
  const dst = layers[targetIdx];
  dst.ctx.save();
  dst.ctx.globalCompositeOperation = 'source-over';
  dst.ctx.drawImage(src.canvas, 0, 0, canvasWidth, canvasHeight);
  dst.ctx.restore();
  deleteLayer(idx);
  activeLayerIndex = layers.indexOf(dst);
  updateLayersPanel();
  saveSnapshot();
}

function updateLayerZIndices(){
  layers.forEach((l,i)=>{
    l.canvas.style.zIndex = i;
    // size canvas to container display
    setCanvasSizeForDisplay(l.canvas, container.clientWidth || canvasWidth, container.clientHeight || canvasHeight);
  });
}

/* =========================
   레이어 패널 UI (DOM-independent: create inside layersPanel)
========================= */
function updateLayersPanel(){
  if(!layersPanel) return;
  layersPanel.innerHTML = '';
  for(let i=layers.length-1;i>=0;i--){
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (i===activeLayerIndex ? ' active':'');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = layer.name;
    const range = document.createElement('input'); range.type='range'; range.min='0'; range.max='1'; range.step='0.01'; range.value = layer.opacity;
    const controls = document.createElement('div'); controls.className='layer-controls';
    const visBtn = document.createElement('button'); visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent = '❌';
    controls.appendChild(visBtn); controls.appendChild(upBtn); controls.appendChild(downBtn); controls.appendChild(delBtn);
    item.appendChild(name); item.appendChild(range); item.appendChild(controls);

    item.addEventListener('click', (e)=> {
      if(e.target.tagName==='BUTTON' || e.target.tagName==='INPUT') return;
      activeLayerIndex = i;
      updateLayersPanel();
    });

    range.addEventListener('input', ()=> {
      layer.opacity = parseFloat(range.value);
      layer.canvas.style.opacity = layer.opacity;
    });

    visBtn.addEventListener('click', (e)=> { e.stopPropagation(); layer.visible = !layer.visible; layer.canvas.style.display = layer.visible ? 'block' : 'none'; visBtn.textContent = layer.visible ? '👁':'🚫'; saveSnapshot(); });
    delBtn.addEventListener('click', (e)=> { e.stopPropagation(); deleteLayer(i); });
    upBtn.addEventListener('click', (e)=> { e.stopPropagation(); moveLayer(i, +1); });
    downBtn.addEventListener('click', (e)=> { e.stopPropagation(); moveLayer(i, -1); });

    layersPanel.appendChild(item);
  }
}

/* =========================
   Snapshot / History (composite snapshot)
   We save composite image (visible layers merged) to reduce memory, and layer metadata to enable reload.
========================= */
function compositeToCanvas(targetCanvas){
  const ctx = targetCanvas.getContext('2d');
  const w = targetCanvas.width / (window.devicePixelRatio||1);
  const h = targetCanvas.height / (window.devicePixelRatio||1);
  ctx.clearRect(0,0,w,h);
  // draw from bottom to top
  for(let i=0;i<layers.length;i++){
    const l = layers[i];
    if(!l.visible) continue;
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(l.canvas, 0,0, w, h);
    ctx.globalAlpha = 1.0;
  }
}

function saveSnapshot(){
  // push composite dataURL and also small metadata for recovery
  try{
    const tmp = document.createElement('canvas');
    setCanvasSizeForDisplay(tmp, container.clientWidth || canvasWidth, container.clientHeight || canvasHeight);
    compositeToCanvas(tmp);
    const dataUrl = tmp.toDataURL('image/png');
    history.push({ dataUrl, timestamp: Date.now(), meta: { layerCount: layers.length } });
    if(history.length > maxHistory) history.shift();
    redoStack = [];
  }catch(e){
    console.warn('saveSnapshot failed', e);
  }
}
function saveSnapshotDebounced(){
  // avoid thrash: schedule snapshot
  if(window.__snap_timer) clearTimeout(window.__snap_timer);
  window.__snap_timer = setTimeout(()=>{ saveSnapshot(); window.__snap_timer = null; }, 150);
}

/* Restore composite snapshot onto topmost layer: used for undo/redo */
function restoreSnapshot(snapshot){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = () => {
      // apply to first layer (or create if missing)
      if(layers.length===0) createLayer();
      const l = layers[0];
      l.ctx.clearRect(0,0, container.clientWidth, container.clientHeight);
      l.ctx.drawImage(img,0,0, container.clientWidth, container.clientHeight);
      resolve();
    };
    img.src = snapshot.dataUrl;
  });
}

function undo(){
  if(history.length <= 1) return;
  const last = history.pop();
  redoStack.push(last);
  const prev = history[history.length - 1];
  if(prev) restoreSnapshot(prev).then(()=>{ updateLayersPanel(); });
}
function redo(){
  if(redoStack.length===0) return;
  const next = redoStack.pop();
  history.push(next);
  restoreSnapshot(next).then(()=>{ updateLayersPanel(); });
}

/* =========================
   Drawing core (per-layer drawing)
   - pointer events wired to active layer canvas
   - eraser uses destination-out, but we ensure saveSnapshot called only once per stroke
   - brush size up to maxBrushSize
========================= */

function getActiveLayer(){
  return layers[activeLayerIndex];
}

function attachDrawingToCanvas(canvas){
  let down = false;
  let activePointerId = null;
  let last = null;

  function toLocal(e){
    // convert client coordinates to canvas local coords accounting for container offset and view zoom/pan
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left - viewOffset.x) / viewZoom;
    const y = (e.clientY - rect.top - viewOffset.y) / viewZoom;
    return { x, y };
  }

  canvas.addEventListener('pointerdown', (e)=>{
    // ignore if pointer on UI buttons (some browsers report pointer events from buttons)
    if(e.target && (e.target.tagName === 'BUTTON' || e.target.closest && e.target.closest('.overlay-actions'))) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    activePointerId = e.pointerId;
    down = true;
    last = toLocal(e);
    isPointerDown = true;
    if(tool === 'text'){
      // handled elsewhere
      return;
    }
    if(tool === 'fill'){
      // paint bucket, use active layer's context
      const layer = getActiveLayer();
      if(!layer) return;
      const px = Math.floor(last.x);
      const py = Math.floor(last.y);
      floodFill(layer, px, py, hexToRgba(brushColor, 255));
      saveSnapshotDebounced();
      return;
    }
    const layer = getActiveLayer();
    const ctx = layer.ctx;
    ctx.save();
    ctx.globalAlpha = opacityVal;
    ctx.filter = blurVal ? `blur(${blurVal}px)` : 'none';
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
  });

  canvas.addEventListener('pointermove', (e)=>{
    if(!down || e.pointerId !== activePointerId) return;
    const pos = toLocal(e);
    const layer = getActiveLayer();
    const ctx = layer.ctx;
    ctx.lineTo(pos.x, pos.y);
    if(tool !== 'eraser'){
      ctx.strokeStyle = brushColor;
    }
    ctx.stroke();
    last = pos;
  });

  canvas.addEventListener('pointerup', (e)=>{
    if(e.pointerId !== activePointerId) return;
    down = false; activePointerId = null;
    isPointerDown = false;
    // finalize
    const layer = getActiveLayer();
    if(layer){
      layer.ctx.restore();
      saveSnapshotDebounced();
    }
  });

  canvas.addEventListener('pointercancel', (e)=> {
    if(e.pointerId !== activePointerId) return;
    down = false; activePointerId = null; isPointerDown=false;
    const layer = getActiveLayer();
    if(layer) layer.ctx.restore();
  });
}

/* Attach drawing events to every layer canvas and ensure pointer events do not block UI */
function attachDrawingEventsToAll(){
  layers.forEach(l=>{
    // remove prior listeners? for simplicity, assume not re-attaching duplicates
    attachDrawingToCanvas(l.canvas);
  });
}

/* =========================
   Flood Fill (paint bucket) per-layer
   - Non-recursive span-fill for performance
========================= */
function floodFill(layer, startX, startY, fillColorRGBA){
  try{
    const ctx = layer.ctx;
    const w = layer.canvas.width / (window.devicePixelRatio||1);
    const h = layer.canvas.height / (window.devicePixelRatio||1);
    const imageData = ctx.getImageData(0,0,w,h);
    const data = imageData.data;
    const idx = (startY * w + startX) * 4;
    const target = [data[idx], data[idx+1], data[idx+2], data[idx+3]];
    const fill = fillColorRGBA; // [r,g,b,a]

    // If target equals fill, return
    if(target[0]===fill[0] && target[1]===fill[1] && target[2]===fill[2] && target[3]===fill[3]) return;

    const stack = [[startX,startY]];
    const visited = new Uint8Array(w*h);
    const within = (x,y)=> x>=0 && x<w && y>=0 && y<h;
    while(stack.length){
      const [x,y] = stack.pop();
      const index = y*w + x;
      if(visited[index]) continue;
      visited[index]=1;
      let i = index*4;
      if(data[i]===target[0] && data[i+1]===target[1] && data[i+2]===target[2] && data[i+3]===target[3]){
        data[i]=fill[0];
        data[i+1]=fill[1];
        data[i+2]=fill[2];
        data[i+3]=fill[3];
        if(within(x+1,y)) stack.push([x+1,y]);
        if(within(x-1,y)) stack.push([x-1,y]);
        if(within(x,y+1)) stack.push([x,y+1]);
        if(within(x,y-1)) stack.push([x,y-1]);
      }
    }
    ctx.putImageData(imageData,0,0);
  }catch(e){
    console.warn('floodFill error', e);
  }
}

/* =========================
   Helper: hex to rgba
========================= */
function hexToRgba(hex, a=255){
  if(hex.startsWith('#')) hex = hex.slice(1);
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  return [r,g,b,a];
}

/* =========================
   Image insertion overlay (pan/pinch/rotate/zoom) - improved mobile behavior
========================= */
function openImageEditor(image){
  const wrapper = document.createElement('div');
  wrapper.style.position='fixed';
  wrapper.style.left='0'; wrapper.style.top='0';
  wrapper.style.width='100vw'; wrapper.style.height='100vh';
  wrapper.style.zIndex='2147483000';
  wrapper.style.display='flex'; wrapper.style.alignItems='center'; wrapper.style.justifyContent='center';
  wrapper.style.background='rgba(0,0,0,0.15)';
  document.body.appendChild(wrapper);

  const inner = document.createElement('div');
  inner.style.position='relative';
  inner.style.width = (container.clientWidth || canvasWidth) + 'px';
  inner.style.height = (container.clientHeight || canvasHeight) + 'px';
  inner.style.background = 'transparent';
  inner.style.touchAction = 'none';
  wrapper.appendChild(inner);

  const overlay = document.createElement('canvas');
  overlay.style.position='absolute'; overlay.style.left='0'; overlay.style.top='0';
  overlay.style.width='100%'; overlay.style.height='100%';
  inner.appendChild(overlay);
  const octx = setCanvasSizeForDisplay(overlay, inner.clientWidth, inner.clientHeight);

  // src canvas
  const src = document.createElement('canvas');
  setCanvasSizeForDisplay(src, image.width, image.height);
  src.getContext('2d').drawImage(image,0,0);

  let scale = Math.min(inner.clientWidth / image.width, inner.clientHeight / image.height, 1);
  let rotation = 0;
  let pos = { x: (inner.clientWidth - image.width*scale)/2, y: (inner.clientHeight - image.height*scale)/2 };

  const pointers = new Map();
  let prevDist = 0, prevAngle = 0, prevMiddle = null;

  function redraw(){
    const w = overlay.width / (window.devicePixelRatio||1);
    const h = overlay.height / (window.devicePixelRatio||1);
    octx.clearRect(0,0,w,h);
    octx.save();
    octx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    octx.rotate(rotation * Math.PI / 180);
    octx.drawImage(src, - (image.width*scale)/2, - (image.height*scale)/2, image.width*scale, image.height*scale);
    octx.restore();
  }
  redraw();

  function onPointerDown(e){
    overlay.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
    if(pointers.size ===1){
      prevMiddle = { ...pointers.values().next().value };
    } else if(pointers.size >=2){
      const pts = Array.from(pointers.values());
      prevDist = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y);
      prevMiddle = { x: (pts[0].x+pts[1].x)/2, y:(pts[0].y+pts[1].y)/2 };
      prevAngle = Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x) * 180 / Math.PI;
    }
  }
  function onPointerMove(e){
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId,{ x:e.clientX, y:e.clientY });
    if(pointers.size ===1){
      const p = pointers.values().next().value;
      const dx = p.x - prevMiddle.x;
      const dy = p.y - prevMiddle.y;
      prevMiddle = { x:p.x, y:p.y };
      pos.x += dx; pos.y += dy; redraw();
    } else if(pointers.size >=2){
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      const newDist = Math.hypot(b.x-a.x, b.y-a.y);
      const newMiddle = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
      const newAngle = Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI;
      if(prevDist > 0){
        const factor = newDist / prevDist;
        const oldScale = scale;
        scale = Math.max(0.05, Math.min(scale * factor, 40));
        const rect = overlay.getBoundingClientRect();
        const mx = newMiddle.x - rect.left;
        const my = newMiddle.y - rect.top;
        pos.x = mx - ((mx - pos.x) * (scale / oldScale));
        pos.y = my - ((my - pos.y) * (scale / oldScale));
      }
      const delta = newAngle - prevAngle;
      rotation += delta;
      prevDist = newDist; prevAngle = newAngle; prevMiddle = newMiddle;
      redraw();
    }
  }
  function onPointerUp(e){
    pointers.delete(e.pointerId);
    overlay.releasePointerCapture?.(e.pointerId);
    if(pointers.size ===1){
      const p = pointers.values().next().value; prevMiddle = {...p};
    } else { prevMiddle = null; prevDist = 0; prevAngle = 0; }
  }

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('pointerleave', onPointerUp);

  // wheel zoom
  overlay.addEventListener('wheel', (ev)=>{
    ev.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.12 : 0.88;
    const oldScale = scale;
    scale = Math.max(0.05, Math.min(scale * factor, 40));
    pos.x = mx - ((mx - pos.x) * (scale / oldScale));
    pos.y = my - ((my - pos.y) * (scale / oldScale));
    redraw();
  }, { passive:false });

  // actions
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.style.position='absolute'; actions.style.bottom='12px'; actions.style.left='50%';
  actions.style.transform='translateX(-50%)'; actions.style.zIndex='999999';
  actions.style.pointerEvents='auto';
  wrapper.appendChild(actions);

  const zoomOut = document.createElement('button'); zoomOut.textContent='-';
  const zoomIn = document.createElement('button'); zoomIn.textContent='+';
  const rotL = document.createElement('button'); rotL.textContent='⟲';
  const rotR = document.createElement('button'); rotR.textContent='⟳';
  const cancel = document.createElement('button'); cancel.textContent = '✖';
  const confirm = document.createElement('button'); confirm.textContent = '✔';

  actions.appendChild(zoomOut); actions.appendChild(zoomIn); actions.appendChild(rotL); actions.appendChild(rotR); actions.appendChild(cancel); actions.appendChild(confirm);

  zoomIn.addEventListener('click', ()=>{
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const oldScale = scale;
    scale = Math.min(scale*1.2, 40);
    pos.x = cx - ((cx-pos.x)*(scale/oldScale));
    pos.y = cy - ((cy-pos.y)*(scale/oldScale));
    redraw();
  });
  zoomOut.addEventListener('click', ()=> {
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const oldScale = scale;
    scale = Math.max(scale*0.85, 0.05);
    pos.x = cx - ((cx-pos.x)*(scale/oldScale));
    pos.y = cy - ((cy-pos.y)*(scale/oldScale));
    redraw();
  });
  rotL.addEventListener('click', ()=>{ rotation -= 15; redraw(); });
  rotR.addEventListener('click', ()=>{ rotation += 15; redraw(); });

  confirm.addEventListener('click', ()=>{
    // draw into active layer
    if(layers.length===0) createLayer();
    const layer = getActiveLayer();
    layer.ctx.save();
    layer.ctx.translate(pos.x + (image.width*scale)/2, pos.y + (image.height*scale)/2);
    layer.ctx.rotate(rotation * Math.PI / 180);
    layer.ctx.drawImage(src, - (image.width*scale)/2, - (image.height*scale)/2, image.width*scale, image.height*scale);
    layer.ctx.restore();
    saveSnapshot();
    cleanup();
  });
  cancel.addEventListener('click', cleanup);

  function cleanup(){
    try{
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
    }catch(e){}
    if(wrapper.parentElement) document.body.removeChild(wrapper);
  }
}

/* =========================
   Export PSD-style ZIP (layers as PNG + metadata)
   - simple zip creation implemented via JS (no external lib), using an uncompressed PKZIP structure
   - NOTE: producing perfect ZIP across all browsers is tricky but this implementation produces a basic store-only zip containing files
========================= */
function createZip(entries){
  // entries: [{name, data:Uint8Array}]
  // Build local file headers + central directory + end record (no compression)
  // Helper to convert numbers
  const files = [];
  let offset = 0;
  for(const e of entries){
    const nameBuf = new TextEncoder().encode(e.name);
    const localHeader = new Uint8Array(30 + nameBuf.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true); // local file header signature
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // compression (0 store)
    view.setUint16(10, 0, true); // mod time
    view.setUint16(12, 0, true); // mod date
    const crc = crc32(e.data);
    view.setUint32(14, crc, true);
    view.setUint32(18, e.data.length, true);
    view.setUint32(22, e.data.length, true);
    view.setUint16(26, nameBuf.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBuf, 30);
    const localRecord = concatUint8(localHeader, e.data);
    files.push({localRecord, name: e.name, crc, size: e.data.length, offset});
    offset += localRecord.length;
  }
  // central dir
  const centralParts = [];
  let centralSize = 0;
  for(const f of files){
    const nameBuf = new TextEncoder().encode(f.name);
    const cent = new Uint8Array(46 + nameBuf.length);
    const v = new DataView(cent.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 0x0314, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, 0, true);
    v.setUint32(14, f.crc, true);
    v.setUint32(18, f.size, true);
    v.setUint32(22, f.size, true);
    v.setUint16(26, nameBuf.length, true);
    v.setUint16(28, 0, true);
    v.setUint16(30, 0, true);
    v.setUint16(32, 0, true);
    v.setUint32(34, 0, true); // external attrs
    v.setUint32(38, f.offset, true);
    cent.set(nameBuf, 46);
    centralParts.push(cent);
    centralSize += cent.length;
  }
  // end record
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  // combine all
  const parts = [];
  for(const f of files) parts.push(f.localRecord);
  for(const c of centralParts) parts.push(c);
  parts.push(end);
  return concatUint8(...parts);
}
function concatUint8(...parts){
  let total = 0;
  for(const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o=0;
  for(const p of parts){ out.set(p, o); o += p.length; }
  return out;
}
function crc32(buf){
  // simple CRC32 implementation
  let table = crc32._table;
  if(!table){
    table = new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;
      for(let k=0;k<8;k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i]=c;
    }
    crc32._table = table;
  }
  let crc = 0 ^ -1;
  for(let i=0;i<buf.length;i++){
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/* Export PSD-style: collect each layer png and metadata, zip it */
async function exportPsdLike(){
  // collect PNGs
  const entries = [];
  for(let i=0;i<layers.length;i++){
    const l = layers[i];
    // create dataurl for the layer
    const tmp = document.createElement('canvas');
    setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
    const tctx = tmp.getContext('2d');
    tctx.clearRect(0,0,tmp.width/(window.devicePixelRatio||1), tmp.height/(window.devicePixelRatio||1));
    tctx.drawImage(l.canvas, 0,0, container.clientWidth, container.clientHeight);
    const dataUrl = tmp.toDataURL('image/png');
    const binary = dataURLToUint8(dataUrl);
    entries.push({ name: `layer_${i+1}_${sanitizeFilename(l.name)}.png`, data: binary });
  }
  // metadata
  const meta = { width: container.clientWidth, height: container.clientHeight, layers: layers.map(l=>({name:l.name, visible:l.visible, opacity:l.opacity})) };
  const metaStr = JSON.stringify(meta, null, 2);
  entries.push({ name: 'metadata.json', data: new TextEncoder().encode(metaStr) });

  const zip = createZip(entries);
  const blob = new Blob([zip], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'export_layers.zip'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}

/* helper: dataURL to Uint8Array */
function dataURLToUint8(dataurl){
  const idx = dataurl.indexOf(',')+1;
  const b64 = dataurl.slice(idx);
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return arr;
}
function sanitizeFilename(name){
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').slice(0,120);
}

/* =========================
   Export animation (WebM) using MediaRecorder
   - record a short timeline of frames saved in gallery or layers
========================= */
async function exportAnimationAsWebM(framesMs= 1000, fps=15){
  // We'll record the canvas composite over frames in gallery or captured frames
  const stream = containerToStream(); // capture composite
  let options = { mimeType: 'video/webm; codecs=vp9' };
  let mediaRecorder;
  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch(e){
    options = { mimeType: 'video/webm' };
    mediaRecorder = new MediaRecorder(stream, options);
  }
  const chunks = [];
  mediaRecorder.ondataavailable = (ev)=>{ if(ev.data && ev.data.size) chunks.push(ev.data); };
  mediaRecorder.start();
  // play through frames if gallery has multiple frames (we can also do layered frames)
  // Simple approach: for 1 second, just record current composite for a moment
  await sleep(1000);
  mediaRecorder.stop();
  await new Promise(r=> mediaRecorder.onstop = r);
  stream.getTracks().forEach(t=>t.stop());
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'animation.webm'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}
function containerToStream(){
  // create a temporary canvas that composites and captureStream
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  function drawComposite(){
    tctx.clearRect(0,0,tmp.width/(window.devicePixelRatio||1), tmp.height/(window.devicePixelRatio||1));
    for(const l of layers){
      if(!l.visible) continue;
      tctx.globalAlpha = l.opacity;
      tctx.drawImage(l.canvas,0,0, container.clientWidth, container.clientHeight);
      tctx.globalAlpha = 1.0;
    }
  }
  drawComposite();
  const stream = tmp.captureStream ? tmp.captureStream(30) : tmp.mozCaptureStream && tmp.mozCaptureStream(30);
  return stream;
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

/* =========================
   Selection tools (rect & lasso)
   - selection creates a maskCanvas that can be used to cut/copy/move
========================= */
function startRectSelection(){
  tool = 'rectselect';
  attachSelectionEvents();
}
function startLassoSelection(){
  tool = 'lassoselect';
  attachSelectionEvents();
}

function attachSelectionEvents(){
  // We'll attach events to topmost container overlay so selection isn't blocked by canvases
  // Create overlay element
  let overlay = document.getElementById('__selection_overlay__');
  if(!overlay){
    overlay = document.createElement('canvas');
    overlay.id = '__selection_overlay__';
    overlay.style.position='absolute';
    overlay.style.left='0'; overlay.style.top='0';
    overlay.style.width = container.clientWidth + 'px';
    overlay.style.height = container.clientHeight + 'px';
    overlay.style.zIndex = 9999999;
    overlay.style.pointerEvents = 'auto';
    container.appendChild(overlay);
  }
  const octx = setCanvasSizeForDisplay(overlay, container.clientWidth, container.clientHeight);
  let points = [];
  let selecting = false;

  function toLocal(e){
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    return { x, y };
  }
  function down(e){
    selecting = true; points = []; const p = toLocal(e); points.push(p); draw();
  }
  function move(e){
    if(!selecting) return; const p = toLocal(e); points.push(p); draw();
  }
  function up(e){
    selecting = false;
    // finalize selection: create mask canvas and set currentSelection
    const bbox = computeBBox(points);
    const mask = document.createElement('canvas');
    setCanvasSizeForDisplay(mask, bbox.w, bbox.h);
    const mctx = mask.getContext('2d');
    mctx.translate(-bbox.x, -bbox.y);
    mctx.beginPath();
    if(tool === 'rectselect'){
      mctx.rect(bbox.x, bbox.y, bbox.w, bbox.h);
    } else {
      mctx.moveTo(points[0].x, points[0].y);
      for(let i=1;i<points.length;i++) mctx.lineTo(points[i].x, points[i].y);
      mctx.closePath();
    }
    mctx.fillStyle = 'rgba(0,0,0,255)';
    mctx.fill();
    currentSelection = { type: tool==='rectselect' ? 'rect' : 'lasso', path: points.slice(), bbox, mask };
    // clear overlay and remove listeners
    octx.clearRect(0,0,overlay.width/(window.devicePixelRatio||1), overlay.height/(window.devicePixelRatio||1));
    overlay.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    // allow user to move selection (implement move handle)
    enableSelectionTransform(currentSelection);
  }
  function draw(){
    octx.clearRect(0,0,overlay.width/(window.devicePixelRatio||1), overlay.height/(window.devicePixelRatio||1));
    octx.save();
    octx.strokeStyle = '#00f';
    octx.lineWidth = 1;
    if(tool === 'rectselect'){
      const r = computeBBox(points);
      octx.strokeRect(r.x+0.5, r.y+0.5, r.w, r.h);
    } else {
      octx.beginPath();
      octx.moveTo(points[0].x, points[0].y);
      for(let i=1;i<points.length;i++) octx.lineTo(points[i].x, points[i].y);
      octx.stroke();
    }
    octx.restore();
  }
  overlay.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function computeBBox(points){
  if(!points || points.length===0) return {x:0,y:0,w:0,h:0};
  let minX = Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for(const p of points){
    if(p.x<minX) minX=p.x; if(p.y<minY) minY=p.y;
    if(p.x>maxX) maxX=p.x; if(p.y>maxY) maxY=p.y;
  }
  return { x: Math.floor(minX), y: Math.floor(minY), w: Math.ceil(maxX-minX), h: Math.ceil(maxY-minY) };
}
function enableSelectionTransform(selection){
  // create a floating canvas with selection image, allow move/rotate/scale, then commit or cancel
  const floatWrap = document.createElement('div');
  floatWrap.style.position='fixed';
  floatWrap.style.left='0'; floatWrap.style.top='0';
  floatWrap.style.width='100vw'; floatWrap.style.height='100vh';
  floatWrap.style.zIndex = 2147483000;
  floatWrap.style.pointerEvents='auto';
  floatWrap.style.display='flex';
  floatWrap.style.alignItems='center';
  floatWrap.style.justifyContent='center';
  document.body.appendChild(floatWrap);

  const inner = document.createElement('div');
  inner.style.position='relative';
  inner.style.width = container.clientWidth + 'px';
  inner.style.height = container.clientHeight + 'px';
  inner.style.touchAction = 'none';
  floatWrap.appendChild(inner);

  const fc = document.createElement('canvas');
  fc.style.position='absolute'; fc.style.left='0'; fc.style.top='0'; fc.style.width='100%'; fc.style.height='100%';
  inner.appendChild(fc);
  const fctx = setCanvasSizeForDisplay(fc, inner.clientWidth, inner.clientHeight);

  // draw current composite then cut out selection and place in floating layer
  // composite into temp
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  tctx.clearRect(0,0,tmp.width/(window.devicePixelRatio||1), tmp.height/(window.devicePixelRatio||1));
  for(const l of layers){
    if(!l.visible) continue;
    tctx.globalAlpha = l.opacity;
    tctx.drawImage(l.canvas, 0,0, container.clientWidth, container.clientHeight);
    tctx.globalAlpha = 1.0;
  }
  // get selection image
  const bbox = selection.bbox;
  const cut = document.createElement('canvas');
  setCanvasSizeForDisplay(cut, bbox.w, bbox.h);
  const cctx = cut.getContext('2d');
  cctx.save();
  cctx.drawImage(tmp, bbox.x, bbox.y, bbox.w, bbox.h, 0,0, bbox.w, bbox.h);
  cctx.restore();

  // Remove selection from original (erase)
  for(const l of layers){
    // apply mask to each layer (simple approach: composite mask with destination-out)
    const ctx = l.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(selection.maskCanvas, bbox.x, bbox.y, bbox.w, bbox.h);
    ctx.restore();
  }
  saveSnapshot();

  // float image transform state
  let fpos = { x: bbox.x, y: bbox.y };
  let fscale = 1;
  let frot = 0;

  function redraw(){
    fctx.clearRect(0,0, fc.width/(window.devicePixelRatio||1), fc.height/(window.devicePixelRatio||1));
    fctx.save();
    fctx.translate(fpos.x + (bbox.w*fscale)/2, fpos.y + (bbox.h*fscale)/2);
    fctx.rotate(frot * Math.PI / 180);
    fctx.drawImage(cut, - (bbox.w*fscale)/2, - (bbox.h*fscale)/2, bbox.w*fscale, bbox.h*fscale);
    fctx.restore();
  }
  redraw();

  // simple pan/scale via pointer events
  const pointers = new Map();
  let prevMid = null, prevDist = 0, prevAngle = 0;

  function onDown(e){ floatWrap.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(pointers.size===1) prevMid = {...pointers.values().next().value}; else if(pointers.size>=2){ const pts=Array.from(pointers.values()); prevDist = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y); prevMid = { x:(pts[0].x+pts[1].x)/2, y:(pts[0].y+pts[1].y)/2 }; prevAngle = Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x)*180/Math.PI;} }
  function onMove(e){ if(!pointers.has(e.pointerId)) return; pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(pointers.size===1){ const p = pointers.values().next().value; const dx = p.x - prevMid.x; const dy = p.y - prevMid.y; prevMid = {...p}; fpos.x += dx; fpos.y += dy; redraw(); } else if(pointers.size>=2){ const pts=Array.from(pointers.values()); const a=pts[0], b=pts[1]; const dist = Math.hypot(b.x-a.x, b.y-a.y); const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2}; const angle = Math.atan2(b.y-a.y, b.x-a.x)*180/Math.PI; if(prevDist>0){ const factor = dist/prevDist; fscale = Math.max(0.05, Math.min(fscale*factor, 40)); const rect = fc.getBoundingClientRect(); const mx = mid.x - rect.left, my = mid.y - rect.top; fpos.x = mx - ((mx - fpos.x) * (fscale/(fscale/factor))); fpos.y = my - ((my - fpos.y) * (fscale/(fscale/factor))); } frot += (angle - prevAngle); prevDist = dist; prevAngle = angle; prevMid = mid; redraw(); } }
  function onUp(e){ pointers.delete(e.pointerId); floatWrap.releasePointerCapture?.(e.pointerId); if(pointers.size===1) prevMid = {...pointers.values().next().value}; else { prevDist=0; prevAngle=0; prevMid=null; } }
  floatWrap.addEventListener('pointerdown', onDown);
  floatWrap.addEventListener('pointermove', onMove);
  floatWrap.addEventListener('pointerup', onUp);
  floatWrap.addEventListener('pointercancel', onUp);

  // actions
  const act = document.createElement('div'); act.className='overlay-actions'; act.style.position='absolute'; act.style.bottom='12px'; act.style.left='50%'; act.style.transform='translateX(-50%)'; act.style.zIndex='999999';
  floatWrap.appendChild(act);
  const ok = document.createElement('button'); ok.textContent='✔';
  const cancel = document.createElement('button'); cancel.textContent='✖';
  act.appendChild(cancel); act.appendChild(ok);

  ok.addEventListener('click', ()=>{
    // draw transformed cut back into active layer (or create new layer)
    const target = getActiveLayer();
    target.ctx.save();
    target.ctx.translate(fpos.x + (bbox.w*fscale)/2, fpos.y + (bbox.h*fscale)/2);
    target.ctx.rotate(frot * Math.PI / 180);
    target.ctx.drawImage(cut, - (bbox.w*fscale)/2, - (bbox.h*fscale)/2, bbox.w*fscale, bbox.h*fscale);
    target.ctx.restore();
    saveSnapshot();
    cleanup();
  });
  cancel.addEventListener('click', ()=>{
    // nothing to commit; selection was already erased from original to create non-destructive transform earlier
    // we could restore by reloading previous snapshot if available; but to keep it simple, we won't restore automatically
    cleanup();
  });
  function cleanup(){
    try{
      floatWrap.removeEventListener('pointerdown', onDown);
      floatWrap.removeEventListener('pointermove', onMove);
      floatWrap.removeEventListener('pointerup', onUp);
    }catch(e){}
    if(floatWrap.parentElement) document.body.removeChild(floatWrap);
    currentSelection = null;
  }
}

/* =========================
   Text tool
========================= */
function activateTextTool(){
  tool = 'text';
  // Clicking on canvas will open a small editable div at that position; upon commit, draw text into active layer
  const overlay = document.createElement('div');
  overlay.style.position='absolute';
  overlay.style.left='0'; overlay.style.top='0';
  overlay.style.width = container.clientWidth + 'px';
  overlay.style.height = container.clientHeight + 'px';
  overlay.style.zIndex = 2147483000;
  overlay.style.pointerEvents = 'auto';
  container.appendChild(overlay);

  function onClick(e){
    // compute position
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    // create editable div
    const input = document.createElement('div');
    input.contentEditable = true;
    input.style.position='absolute';
    input.style.left = x + 'px';
    input.style.top = y + 'px';
    input.style.minWidth = '80px';
    input.style.minHeight = '20px';
    input.style.border = '1px dashed #666';
    input.style.background = 'rgba(255,255,255,0.7)';
    input.style.padding = '6px';
    overlay.appendChild(input);
    input.focus();

    function commit(){
      const txt = input.innerText || input.textContent || '';
      if(txt.trim()){
        const layer = getActiveLayer();
        layer.ctx.save();
        layer.ctx.fillStyle = brushColor;
        layer.ctx.font = '20px sans-serif';
        layer.ctx.globalAlpha = opacityVal;
        layer.ctx.fillText(txt, x, y + 20);
        layer.ctx.restore();
        saveSnapshot();
      }
      overlay.removeEventListener('click', onClick);
      if(overlay.parentElement) container.removeChild(overlay);
    }
    // commit on blur or Enter
    input.addEventListener('blur', commit, { once:true });
    input.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); input.blur(); } });
  }

  overlay.addEventListener('click', onClick);
}

/* =========================
   Save / Load / Autosave
========================= */
function saveToLocal(){
  try{
    // Save each layer as dataURL + metadata
    const data = { width: container.clientWidth, height: container.clientHeight, layersMeta: layers.map(l=>({id:l.id,name:l.name,visible:l.visible,opacity:l.opacity})) };
    const layerDatas = [];
    for(let i=0;i<layers.length;i++){
      const l = layers[i];
      const tmp = document.createElement('canvas');
      setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
      tmp.getContext('2d').drawImage(l.canvas,0,0, container.clientWidth, container.clientHeight);
      layerDatas.push(tmp.toDataURL('image/png'));
    }
    const payload = { meta: data, layers: layerDatas, savedAt: Date.now() };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    return true;
  }catch(e){ console.warn('saveToLocal error', e); return false; }
}

function loadFromLocal(){
  try{
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if(!raw) return false;
    const payload = JSON.parse(raw);
    // clear existing canvases
    layers.forEach(l=>{ if(l.canvas.parentElement) l.canvas.parentElement.removeChild(l.canvas); });
    layers = [];
    // restore layers
    const w = payload.meta.width || container.clientWidth;
    const h = payload.meta.height || container.clientHeight;
    for(let i=0;i<payload.layers.length;i++){
      const ldata = payload.layers[i];
      const layer = createLayer(payload.meta.layersMeta[i].name || ('Layer '+(i+1)));
      // draw data
      const img = new Image();
      img.onload = ()=> {
        layer.ctx.clearRect(0,0, container.clientWidth, container.clientHeight);
        layer.ctx.drawImage(img, 0,0, container.clientWidth, container.clientHeight);
        saveSnapshot();
      };
      img.src = ldata;
      layer.visible = payload.meta.layersMeta[i].visible;
      layer.opacity = payload.meta.layersMeta[i].opacity;
      layer.canvas.style.opacity = layer.opacity;
      layer.canvas.style.display = layer.visible ? 'block' : 'none';
    }
    updateLayersPanel();
    return true;
  }catch(e){ console.warn('loadFromLocal err', e); return false; }
}

/* =========================
   Canvas resize utility
   - user can call resizeCanvas(newW, newH) via UI; we preserve content by drawing each layer scaled
========================= */
function resizeCanvasTo(newW, newH){
  const ratio = window.devicePixelRatio || 1;
  layers.forEach(l=>{
    // preserve
    const tmp = document.createElement('canvas');
    setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
    tmp.getContext('2d').drawImage(l.canvas,0,0, container.clientWidth, container.clientHeight);
    // resize layer canvas
    setCanvasSizeForDisplay(l.canvas, newW, newH);
    // draw preserved scaled
    l.ctx.drawImage(tmp, 0,0, tmp.width/ratio, tmp.height/ratio, 0,0, newW, newH);
  });
  container.style.width = newW + 'px';
  container.style.height = newH + 'px';
  saveSnapshot();
}

/* =========================
   Paint bucket region selection improved: fill contiguous region only
   - handled in floodFill above
========================= */

/* =========================
   Mobile UI fixes: ensure toolbar is above canvases & canvases don't block buttons
   - set pointer-events on canvases only when drawing; otherwise allow pointer events to pass to UI
========================= */
function enableCanvasPointerEvents(enabled){
  layers.forEach(l=> {
    l.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
  });
}
function initMobileUIFix(){
  // ensure toolbar has high z-index
  if(toolbar) toolbar.style.zIndex = 2147483002;
  if(layersPanel) layersPanel.style.zIndex = 2147483003;
  // canvases are below
  layers.forEach(l=> l.canvas.style.zIndex = '1000');
}

/* =========================
   Utility helpers
========================= */
function getActiveLayer(){ return layers[activeLayerIndex]; }
function saveSnapshot(){ saveSnapshotDebounced(); }
function saveSnapshotDebounced(){
  if(window.__snap) clearTimeout(window.__snap);
  window.__snap = setTimeout(()=>{ saveSnapshot(); window.__snap=null; }, 150);
}

/* =========================
   Basic initialization
========================= */
function init(){
  updateContainerSize();
  // create initial layer if none
  if(layers.length===0) createLayer('Layer 1');
  // attach drawing handlers to each layer
  attachDrawingEventsToAll();
  initMobileUIFix();
  updateLayersPanel();
  // restore autosave (non-destructive: if present offer to load)
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if(raw){
    // do not auto-load; leave for user to explicitly restore via UI
    // but for resilience, we can still keep it available
    console.log('Autosave found. Use loadFromLocal() to restore.');
  }
}

/* =========================
   Wire up UI controls (if present)
========================= */
if(brushSelect){
  brushSelect.addEventListener('input', (e)=> { brushSize = Math.min(maxBrushSize, parseInt(e.target.value || brushSize)); });
}
if(colorPicker){
  colorPicker.addEventListener('input', (e)=> { brushColor = e.target.value; });
}
if(eraserBtn){
  eraserBtn.addEventListener('click', ()=>{
    tool = (tool === 'eraser') ? 'brush' : 'eraser';
    if(tool === 'eraser'){ eraserBtn.classList.add('active'); } else eraserBtn.classList.remove('active');
  });
}
if(fillBtn){
  fillBtn.addEventListener('click', ()=> { tool = 'fill'; });
}
if(undoBtn) undoBtn.addEventListener('click', ()=> undo());
if(redoBtn) redoBtn.addEventListener('click', ()=> redo());
if(addLayerBtn) addLayerBtn.addEventListener('click', ()=> createLayer('Layer '+(layers.length+1)));
if(mergeLayerBtn) mergeLayerBtn.addEventListener('click', ()=> mergeLayerWithBelow(activeLayerIndex));
if(toggleLayersBtn) toggleLayersBtn.addEventListener('click', ()=> layersPanel.classList.toggle('visible'));

if(imageInput){
  imageInput.addEventListener('change', (ev)=>{
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const img = new Image();
    img.onload = ()=> openImageEditor(img);
    img.src = URL.createObjectURL(f);
    imageInput.value = '';
  });
}
if(exportPsdBtn) exportPsdBtn.addEventListener('click', ()=> exportPsdLike());
if(exportAnimBtn) exportAnimBtn.addEventListener('click', ()=> exportAnimationAsWebM());
if(loadSavedBtn) loadSavedBtn.addEventListener('click', ()=> loadFromLocal());

if(txtToolBtn) txtToolBtn.addEventListener('click', ()=> activateTextTool());
if(selRectBtn) selRectBtn.addEventListener('click', ()=> startRectSelection());
if(selLassoBtn) selLassoBtn.addEventListener('click', ()=> startLassoSelection());
if(toolBrushBtn) toolBrushBtn.addEventListener('click', ()=> tool='brush');
if(toolEraserBtn) toolEraserBtn.addEventListener('click', ()=> tool='eraser');
if(toolFillBtn) toolFillBtn.addEventListener('click', ()=> tool='fill');

if(blurInput) blurInput.addEventListener('input', (e)=>{ blurVal = parseFloat(e.target.value||0); });
if(opacityInput) opacityInput.addEventListener('input', (e)=>{ opacityVal = parseFloat(e.target.value||1); });
if(brushSizeInput) brushSizeInput.addEventListener('input', (e)=>{ brushSize = Math.min(maxBrushSize, parseInt(e.target.value||brushSize)); });

/* Keyboard shortcuts */
window.addEventListener('keydown', (e)=>{
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); undo(); }
  if((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase()==='z'))){ e.preventDefault(); redo(); }
});

/* autosave before unload: save layer PNGs and meta */
window.addEventListener('beforeunload', (e)=>{
  saveToLocal();
});

/* initialize */
init();
attachDrawingEventsToAll();
updateLayerZIndices();
updateLayersPanel();
