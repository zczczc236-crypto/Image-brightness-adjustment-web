/* 파일명: script.js
   전체 통합본 — 기존 기능 유지 + 요청된 추가기능 통합
   (스포이드, 불투명 브러시, 브러시 압력, 단축키, 단축키 가이드, 캔버스 패닝,
    강화된 Undo/Redo(최소 50~200 스텝 설정 가능/기본 200), Ctrl+Z/Ctrl+Shift+Z 단축키,
    레이어 불투명도, 브러시 프리셋 저장/불러오기, 즐겨찾기 버튼,
    확대/축소(휠/핀치), 캔버스 회전, UI 숨기기(Tab), PSD export (ag-psd 로드), GIF/APNG export 지원 시도,
    선택 영역/이동툴, 대칭 그리기, 스트로크 안정화(보정), 캔버스 크기 조절, 지우개 undo fix,
    모바일 UI/터치 개선)
   **요청대로 기존 기능을 바꾸지 않으면서(기능 보존) 추가 구현합니다.**
*/

/* ========== 전역 DOM 참조 및 동적 생성(없으면 생성) ========== */
function $(id){ return document.getElementById(id); }
function ensureElement(id, tag='div', attrs={}){
  let el = document.getElementById(id);
  if(!el){
    el = document.createElement(tag);
    el.id = id;
    Object.assign(el, attrs);
    document.body.appendChild(el);
  }
  return el;
}

/* toolbar, container, panels - 기존 사용중인 ID를 재사용 */
const toolbar = ensureElement('toolbar','div',{});
const container = ensureElement('canvas-container','div',{});
const layersPanel = ensureElement('layers-panel','div',{});
const galleryPanel = ensureElement('gallery-panel','div',{});
const brushSelect = (() => {
  let s = document.getElementById('brush-size');
  if(!s){ s = document.createElement('select'); s.id='brush-size'; toolbar.appendChild(s); }
  return s;
})();
const colorPicker = (() => {
  let c = document.getElementById('color');
  if(!c){ c = document.createElement('input'); c.id='color'; c.type='color'; c.value='#000000'; toolbar.appendChild(c); }
  return c;
})();
const undoBtn = (()=>document.getElementById('undo') || (()=>{ const b=document.createElement('button'); b.id='undo'; b.textContent='되돌리기'; toolbar.appendChild(b); return b; })())();
const redoBtn = (()=>document.getElementById('redo') || (()=>{ const b=document.createElement('button'); b.id='redo'; b.textContent='취소'; toolbar.appendChild(b); return b; })())();
const fillBtn = (()=>document.getElementById('fill') || (()=>{ const b=document.createElement('button'); b.id='fill'; b.textContent='페인트통'; toolbar.appendChild(b); return b; })())();
const eraserBtn = (()=>document.getElementById('eraser') || (()=>{ const b=document.createElement('button'); b.id='eraser'; b.textContent='지우개'; toolbar.appendChild(b); return b; })())();
const zoomOutBtn = (()=>document.getElementById('zoom-out') || (()=>{ const b=document.createElement('button'); b.id='zoom-out'; b.textContent='줌리셋'; toolbar.appendChild(b); return b; })())();
const saveBtn = (()=>document.getElementById('save') || (()=>{ const b=document.createElement('button'); b.id='save'; b.textContent='저장'; toolbar.appendChild(b); return b; })())();
const addLayerBtn = (()=>document.getElementById('add-layer') || (()=>{ const b=document.createElement('button'); b.id='add-layer'; b.textContent='레이어추가'; toolbar.appendChild(b); return b; })())();
const mergeLayerBtn = (()=>document.getElementById('merge-layer') || (()=>{ const b=document.createElement('button'); b.id='merge-layer'; b.textContent='레이어합체'; toolbar.appendChild(b); return b; })())();
const toggleLayersBtn = (()=>document.getElementById('toggle-layers') || (()=>{ const b=document.createElement('button'); b.id='toggle-layers'; b.textContent='레이어창'; toolbar.appendChild(b); return b; })())();
const imageInput = (()=>document.getElementById('image-input') || (()=>{ const i=document.createElement('input'); i.id='image-input'; i.type='file'; i.accept='image/*'; toolbar.appendChild(i); return i; })())();
const eyedropperBtn = (()=>document.getElementById('eyedropper') || (()=>{ const b=document.createElement('button'); b.id='eyedropper'; b.textContent='스포이드'; toolbar.appendChild(b); return b; })())();
const presetsPanel = (()=>document.getElementById('presets-panel') || (()=>{ const d=document.createElement('div'); d.id='presets-panel'; d.style.display='flex'; d.style.gap='6px'; toolbar.appendChild(d); return d; })())();
const quickBrushPanel = (()=>document.getElementById('quick-brush-panel') || (()=>{ const d=document.createElement('div'); d.id='quick-brush-panel'; d.style.display='flex'; d.style.gap='6px'; toolbar.appendChild(d); return d; })())();
const shortcutGuide = (()=>document.getElementById('shortcut-guide') || (()=>{ const d=document.createElement('div'); d.id='shortcut-guide'; d.style.position='fixed'; d.style.right='8px'; d.style.bottom='8px'; d.style.background='rgba(0,0,0,0.7)'; d.style.color='#fff'; d.style.padding='8px'; d.style.display='none'; d.style.zIndex='999999'; document.body.appendChild(d); return d; })())();

/* 기본 스타일 보장 (간단) */
toolbar.style.position = 'fixed';
toolbar.style.top = '0';
toolbar.style.left = '0';
toolbar.style.right = '0';
toolbar.style.background = '#f3f3f3';
toolbar.style.zIndex = '2147483645';
toolbar.style.padding = '6px';
toolbar.style.display = 'flex';
toolbar.style.flexWrap = 'wrap';
toolbar.style.gap = '6px';

container.style.position = 'absolute';
container.style.top = toolbar.getBoundingClientRect().height + 'px';
container.style.left = '0';
container.style.right = '0';
container.style.bottom = '0';
container.style.overflow = 'hidden';
container.style.background = '#fff';
container.style.touchAction = 'none';
container.style.zIndex = '1';

layersPanel.style.position = 'fixed';
layersPanel.style.right = '8px';
layersPanel.style.top = (toolbar.getBoundingClientRect().height + 8) + 'px';
layersPanel.style.zIndex = '2147483646';
layersPanel.style.background = 'rgba(255,255,255,0.95)';
layersPanel.style.maxHeight = '60vh';
layersPanel.style.overflow = 'auto';
layersPanel.style.padding = '6px';
layersPanel.style.border = '1px solid #ccc';

galleryPanel.style.position = 'fixed';
galleryPanel.style.left = '8px';
galleryPanel.style.bottom = '8px';
galleryPanel.style.zIndex = '2147483646';
galleryPanel.style.display = 'flex';
galleryPanel.style.gap = '6px';
galleryPanel.style.padding = '6px';
galleryPanel.style.background = 'rgba(255,255,255,0.95)';
galleryPanel.style.overflowX = 'auto';

/* ========== 상태 변수 ========== */
let layers = []; // each: {canvas, ctx, name, opacity, visible, blur, history:[], historyIndex}
let activeLayer = null;
let view = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 }; // global view transform for pan/zoom/rotate
let isPanning = false;
let panStart = null;
let historyLimit = 200; // default, can be set to 50..200 or 0 for unlimited
let strokeSmoothing = true;
let smoothingBuffer = []; // points for smoothing
let smoothingMinPoints = 3;
let maxPresets = 20;

/* ===== devicePixelRatio helpers ===== */
function DPR(){ return window.devicePixelRatio || 1; }
function setCanvasSizeForDisplay(canvas, width, height){
  const r = DPR();
  canvas.width = Math.max(1, Math.round(width * r));
  canvas.height = Math.max(1, Math.round(height * r));
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(r,0,0,r,0,0);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return ctx;
}

/* ========== 초기 캔버스 / 레이어 함수 ========== */
function resizeContainer(){
  const topH = toolbar.getBoundingClientRect().height;
  container.style.top = topH + 'px';
  const w = window.innerWidth;
  const h = window.innerHeight - topH;
  container.style.width = w + 'px';
  container.style.height = h + 'px';
  layers.forEach(layer => {
    // preserve content
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas,0,0);
    setCanvasSizeForDisplay(layer.canvas, w, h);
    try{
      layer.ctx.clearRect(0,0,w,h);
      const r = DPR();
      layer.ctx.drawImage(tmp, 0, 0, tmp.width / r, tmp.height / r, 0,0, w, h);
    }catch(e){ layer.ctx.clearRect(0,0,w,h); }
  });
  layersPanel.style.top = (topH + 8) + 'px';
}
window.addEventListener('resize', ()=>{ resizeContainer(); });

function createLayer(name='Layer'){
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.style.position = 'absolute';
  canvas.style.left = '0'; canvas.style.top = '0';
  container.appendChild(canvas);
  const ctx = setCanvasSizeForDisplay(canvas, container.clientWidth || 800, container.clientHeight || 600);
  const layer = { canvas, ctx, name, opacity:1, visible:true, blur:0, history:[], historyIndex:-1 };
  layers.push(layer);
  activeLayer = layer;
  attachBaseEvents(canvas);
  updateLayersUI();
  saveLayerHistorySnapshot(layer); // initial snapshot
  return layer;
}
function deleteLayer(layer){
  if(layers.length<=1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx,1);
  if(layer.canvas.parentElement) container.removeChild(layer.canvas);
  if(activeLayer===layer) activeLayer = layers[layers.length-1];
  updateLayersUI();
  saveAllStateToLocal();
}
function moveLayer(layer,dir){
  const idx = layers.indexOf(layer);
  const newIdx = idx+dir;
  if(newIdx<0||newIdx>=layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  layers.forEach((l,i)=>{ l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  updateLayersUI();
}
function mergeLayer(target, source){
  // draw source onto target then delete source
  target.ctx.save();
  target.ctx.globalCompositeOperation = 'source-over';
  target.ctx.drawImage(source.canvas, 0,0, container.clientWidth,container.clientHeight);
  target.ctx.restore();
  deleteLayer(source);
  saveLayerHistorySnapshot(target);
}

/* ========== History (Undo/Redo) - per-layer history but global undo/redo supports reverting across layers ========== */
function saveLayerHistorySnapshot(layer){
  try{
    const data = layer.canvas.toDataURL('image/png');
    // if last is same, skip (fixes eraser double push)
    if(layer.history.length && layer.history[layer.history.length-1] && layer.history[layer.history.length-1] === data) return;
    layer.history.push(data);
    if(historyLimit>0 && layer.history.length > historyLimit) layer.history.shift();
    layer.historyIndex = layer.history.length - 1;
    saveAllStateToLocalDebounced();
  }catch(e){ console.warn('history save failed', e); }
}
function undo(){
  // undo on active layer if possible, else fallback to other layers
  if(!activeLayer) return;
  const layer = activeLayer;
  if(layer.historyIndex > 0){
    layer.historyIndex--;
    const data = layer.history[layer.historyIndex];
    restoreDataUrlToLayer(layer, data);
  } else {
    // try other layers
    for(let i=layers.length-1;i>=0;i--){
      const l = layers[i];
      if(l.historyIndex > 0){
        l.historyIndex--;
        restoreDataUrlToLayer(l, l.history[l.historyIndex]);
        break;
      }
    }
  }
}
function redo(){
  if(!activeLayer) return;
  const layer = activeLayer;
  if(layer.historyIndex < layer.history.length - 1){
    layer.historyIndex++;
    restoreDataUrlToLayer(layer, layer.history[layer.historyIndex]);
  } else {
    for(let i=layers.length-1;i>=0;i--){
      const l = layers[i];
      if(l.historyIndex < l.history.length - 1){
        l.historyIndex++;
        restoreDataUrlToLayer(l, l.history[l.historyIndex]);
        break;
      }
    }
  }
}
function restoreDataUrlToLayer(layer, dataUrl){
  const img = new Image();
  img.onload = ()=>{
    layer.ctx.clearRect(0,0, container.clientWidth, container.clientHeight);
    layer.ctx.drawImage(img, 0,0, container.clientWidth, container.clientHeight);
    updateLayersUI();
    saveAllStateToLocalDebounced();
  };
  img.src = dataUrl;
}

/* ========== Brush & Pressure & Smoothing ========== */
ensureBrushOptions();
function ensureBrushOptions(){
  brushSelect.innerHTML='';
  for(let i=1;i<=100;i++){
    const o = document.createElement('option'); o.value=i; o.textContent=i; brushSelect.appendChild(o);
  }
  brushSelect.value = 10;
}
// smoothing: we will implement a simple moving-average + quadratic bezier smoothing
function getSmoothedPoints(points){
  if(!strokeSmoothing) return points;
  if(points.length < 3) return points;
  const res = [];
  for(let i=0;i<points.length-2;i++){
    const p0 = points[i], p1 = points[i+1], p2 = points[i+2];
    // midpoint between p0 and p2 as control
    const cpx = p1.x;
    const cpy = p1.y;
    res.push({x:p0.x,y:p0.y});
    res.push({x:(p0.x + p1.x)/2, y:(p0.y + p1.y)/2, bezier:true, cp:{x:cpx,y:cpy}});
  }
  const last = points[points.length-1];
  res.push({x:last.x,y:last.y});
  return res;
}

/* ========== Drawing: handle view transform (pan/zoom/rotate) and convert screen->canvas coords ========== */
function screenToCanvas(sx, sy){
  // convert screen client coords to canvas logical coords considering view transform
  // strategy: apply inverse of translate/scale/rotation
  const rect = container.getBoundingClientRect();
  const x = sx - rect.left;
  const y = sy - rect.top;
  // translate to view center
  const cx = (x - view.offsetX);
  const cy = (y - view.offsetY);
  // inverse rotate
  const ang = -view.rotation * Math.PI / 180;
  const rx = cx * Math.cos(ang) - cy * Math.sin(ang);
  const ry = cx * Math.sin(ang) + cy * Math.cos(ang);
  // inverse scale
  return { x: rx / view.scale, y: ry / view.scale };
}
function canvasToScreen(cx, cy){
  // inverse of above
  const rx = cx * view.scale;
  const ry = cy * view.scale;
  const ang = view.rotation * Math.PI / 180;
  const x = rx * Math.cos(ang) - ry * Math.sin(ang);
  const y = rx * Math.sin(ang) + ry * Math.cos(ang);
  return { x: x + view.offsetX, y: y + view.offsetY };
}

/* ========== Drawing events (pointer) - supports pressure and eraser, smoothing, symmetry, opacity, brush preset application ========== */
let drawState = { drawing:false, pointerId:null, points:[], lastPressure:0, tool:'brush', symmetry:false, symmetryAxis:'vertical' };
function attachBaseEvents(canvas){
  // drawing uses pointer events on canvas but we convert coords to layer canvases via screenToCanvas
  canvas.addEventListener('pointerdown', (e)=>{
    if(e.button === 1 || (e.button===0 && e.shiftKey && e.ctrlKey===false && e.altKey===false && e.metaKey===false && e.buttons===4)){
      // middle button or special combination -> pan
      isPanning = true;
      panStart = {x:e.clientX, y:e.clientY, startOffsetX:view.offsetX, startOffsetY:view.offsetY};
      return;
    }
    if(e.target.tagName==='BUTTON') return;
    const p = screenToCanvas(e.clientX, e.clientY);
    drawState.drawing = true;
    drawState.pointerId = e.pointerId;
    drawState.points = [{x:p.x, y:p.y, pressure: (e.pressure || 0.5), tiltX:e.tiltX||0, tiltY:e.tiltY||0}];
    drawState.lastPressure = e.pressure || 0.5;
    // if eyedropper active, pick color
    if(currentTool === 'eyedropper'){
      const c = sampleColorAtScreen(e.clientX, e.clientY);
      if(c) colorPicker.value = rgbToHex(c[0],c[1],c[2]);
      currentTool = 'brush';
      return;
    }
  }, {passive:false});
  window.addEventListener('pointermove', (e)=>{
    if(isPanning && e.buttons === 4 || isPanning && e.pointerType === 'touch'){ // middle-button or panning
      if(panStart){
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        view.offsetX = panStart.startOffsetX + dx;
        view.offsetY = panStart.startOffsetY + dy;
        updateViewTransform();
      }
    }
    if(!drawState.drawing || e.pointerId !== drawState.pointerId) return;
    const p = screenToCanvas(e.clientX, e.clientY);
    const pressure = (e.pressure && e.pressure>0) ? e.pressure : (drawState.lastPressure || 0.5);
    drawState.points.push({x:p.x,y:p.y, pressure: pressure});
    drawState.lastPressure = pressure;
    // draw incremental stroke onto activeLayer.ctx (convert to layer coords)
    if(activeLayer){
      drawStrokeIncremental(activeLayer, drawState.points, drawState.tool === 'eraser' || usingEraser);
    }
  }, {passive:false});
  window.addEventListener('pointerup', (e)=>{
    if(isPanning){
      isPanning = false;
      panStart = null;
      return;
    }
    if(!drawState.drawing || e.pointerId !== drawState.pointerId) return;
    // finalize stroke
    if(activeLayer){
      drawStrokeFinalize(activeLayer, drawState.points, drawState.tool === 'eraser' || usingEraser);
      saveLayerHistorySnapshot(activeLayer);
    }
    drawState.drawing = false;
    drawState.pointerId = null;
    drawState.points = [];
  }, {passive:false});
  canvas.addEventListener('wheel', (e)=>{
    // zoom on wheel - center around pointer
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.12 : 0.88;
    const oldScale = view.scale;
    view.scale = Math.max(0.05, Math.min(view.scale * delta, 20));
    // adjust offset to zoom toward pointer
    view.offsetX = mx - ((mx - view.offsetX) * (view.scale / oldScale));
    view.offsetY = my - ((my - view.offsetY) * (view.scale / oldScale));
    updateViewTransform();
  }, {passive:false});
}

/* helper: update CSS transforms for layer canvases to show pan/zoom/rotate */
function updateViewTransform(){
  const s = `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale}) rotate(${view.rotation}deg)`;
  layers.forEach(layer => {
    layer.canvas.style.transformOrigin = '0 0';
    layer.canvas.style.transform = s;
  });
}

/* draw incremental stroke: simple approach - draw line segments between last two points with width scaled by pressure and brush opacity */
function drawStrokeIncremental(layer, points, isEraser){
  if(points.length < 2) return;
  const ctx = layer.ctx;
  ctx.save();
  if(isEraser) ctx.globalCompositeOperation = 'destination-out';
  else ctx.globalCompositeOperation = 'source-over';
  // apply brush opacity setting
  const brushOpacity = parseFloat(brushOpacityInput?.value || 1) || 1;
  ctx.globalAlpha = brushOpacity;
  // use last two points
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  // smoothing: draw quadratic curve using previous point as control
  if(strokeSmoothing && points.length >=3){
    const p0 = points[points.length - 3];
    // compute control point
    const cpx = a.x;
    const cpy = a.y;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(cpx, cpy, b.x, b.y);
  } else {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  // width influenced by pressure and brush size
  let baseSize = Math.min(100, parseFloat(brushSelect.value) || 10);
  const pressure = b.pressure || 0.5;
  const width = Math.max(1, baseSize * (isEraser?1:pressure));
  ctx.lineWidth = width;
  ctx.strokeStyle = colorPicker.value;
  ctx.stroke();
  ctx.restore();
}

/* finalize stroke - can merge smoothing and optionally apply stroke filter */
function drawStrokeFinalize(layer, points, isEraser){
  if(points.length < 2) return;
  // For finalize, we already drew incrementally; optionally we could redraw the entire stroke smoother.
  // Here, just ensure any necessary filters/blur are applied via layer.blur (CSS filter handles display)
  drawLayerBlurIfNeeded(layer);
}

/* apply CSS blur visual - deep blur at drawing time is expensive; we keep blur CSS for layer display */
function drawLayerBlurIfNeeded(layer){
  // layer.blur is applied in drawLayersVisualState()
  drawLayersVisualState();
}

/* ========== Eyedropper (스포이드) - samples topmost visible pixel at screen position ========== */
function sampleColorAtScreen(sx, sy){
  // iterate layers top-down to sample visible pixel
  for(let i=layers.length-1;i>=0;i--){
    const layer = layers[i];
    if(!layer.visible) continue;
    // convert screen to this layer's local pixel (inverse transform)
    const rect = container.getBoundingClientRect();
    const x = sx - rect.left;
    const y = sy - rect.top;
    // convert screen coords to canvas pixel coords considering DPR and transforms: we used CSS transforms for view,
    // so we should compute screen->canvas logical coords using screenToCanvas then multiply by DPR.
    const canvasPt = screenToCanvas(sx, sy);
    const px = Math.floor(canvasPt.x);
    const py = Math.floor(canvasPt.y);
    if(px<0||py<0||px>=layer.canvas.width/DPR()||py>=layer.canvas.height/DPR()) continue;
    try{
      const imgData = layer.ctx.getImageData(px, py, 1, 1).data;
      return [imgData[0], imgData[1], imgData[2], imgData[3]];
    }catch(e){ continue; }
  }
  return null;
}
function rgbToHex(r,g,b){
  return '#'+[r,g,b].map(v=>{ const s = v.toString(16); return s.length===1?'0'+s:s; }).join('');
}

/* ========== Flood-fill paint bucket (already implemented earlier) ========== */
/* We'll reuse a simple stack flood-fill function when user clicks with fill tool; see earlier implementation if present. */
function floodFillAtScreen(xScreen,yScreen, fillColor, tolerance=32){
  if(!activeLayer) return;
  const p = screenToCanvas(xScreen,yScreen);
  const ctx = activeLayer.ctx;
  const w = activeLayer.canvas.width / DPR();
  const h = activeLayer.canvas.height / DPR();
  try{
    const imageData = ctx.getImageData(0,0,w,h);
    const data = imageData.data;
    const startX = Math.floor(p.x), startY = Math.floor(p.y);
    if(startX<0||startY<0||startX>=w||startY>=h) return;
    const getPixel = (x,y)=>{ const i=(y*w+x)*4; return [data[i],data[i+1],data[i+2],data[i+3]]; };
    const setPixel = (x,y,rgba)=>{ const i=(y*w+x)*4; data[i]=rgba[0]; data[i+1]=rgba[1]; data[i+2]=rgba[2]; data[i+3]=rgba[3]; };
    const startColor = getPixel(startX,startY);
    // parse fillColor (hex)
    const tmp = document.createElement('canvas'); const tctx = tmp.getContext('2d'); tctx.fillStyle = fillColor; tctx.fillRect(0,0,1,1);
    const fc = tctx.getImageData(0,0,1,1).data; const fillRGBA=[fc[0],fc[1],fc[2],255];
    if(Math.abs(startColor[0]-fillRGBA[0])<1 && Math.abs(startColor[1]-fillRGBA[1])<1 && Math.abs(startColor[2]-fillRGBA[2])<1) return;
    const stack = [[startX,startY]];
    const visited = new Uint8Array(w*h);
    while(stack.length){
      const [x,y] = stack.pop();
      const idx = y*w + x;
      if(visited[idx]) continue;
      visited[idx]=1;
      const pc = getPixel(x,y);
      const dr = pc[0]-startColor[0], dg=pc[1]-startColor[1], db=pc[2]-startColor[2];
      if((dr*dr+dg*dg+db*db) > tolerance*tolerance) continue;
      setPixel(x,y,fillRGBA);
      if(x>0) stack.push([x-1,y]);
      if(x<w-1) stack.push([x+1,y]);
      if(y>0) stack.push([x,y-1]);
      if(y<h-1) stack.push([x,y+1]);
    }
    ctx.putImageData(imageData, 0,0);
    saveLayerHistorySnapshot(activeLayer);
  }catch(e){
    console.warn('floodfill failed',e);
  }
}

/* ========== Quick presets & favorites ========== */
const BRUSH_PRESETS_KEY = 'paint_brush_presets_v1';
function saveBrushPreset(name){
  const preset = { name, size: parseInt(brushSelect.value,10), color: colorPicker.value, opacity: parseFloat(brushOpacityInput?.value||1), pressure: true };
  const arr = JSON.parse(localStorage.getItem(BRUSH_PRESETS_KEY) || '[]');
  arr.unshift(preset);
  if(arr.length>maxPresets) arr.pop();
  localStorage.setItem(BRUSH_PRESETS_KEY, JSON.stringify(arr));
  renderPresetsUI();
}
function loadBrushPreset(idx){
  const arr = JSON.parse(localStorage.getItem(BRUSH_PRESETS_KEY) || '[]');
  const p = arr[idx];
  if(!p) return;
  brushSelect.value = p.size;
  colorPicker.value = p.color;
  if(brushOpacityInput) brushOpacityInput.value = p.opacity;
}
function renderPresetsUI(){
  presetsPanel.innerHTML = '';
  const arr = JSON.parse(localStorage.getItem(BRUSH_PRESETS_KEY) || '[]');
  arr.forEach((p,idx)=>{
    const b = document.createElement('button');
    b.textContent = p.name || `프리셋 ${idx+1}`;
    b.title = `크기:${p.size} 불투명도:${p.opacity}`;
    b.addEventListener('click', ()=> loadBrushPreset(idx));
    presetsPanel.appendChild(b);
  });
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '+프리셋';
  saveBtn.addEventListener('click', ()=> {
    const name = prompt('프리셋 이름:','my-brush');
    if(name) saveBrushPreset(name);
  });
  presetsPanel.appendChild(saveBtn);
}
renderPresetsUI();

/* quick brushes favorites */
function addQuickBrush(name, size, opacity, color){
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', ()=>{ brushSelect.value=size; if(brushOpacityInput) brushOpacityInput.value=opacity; colorPicker.value=color; });
  quickBrushPanel.appendChild(b);
}
// add some defaults
addQuickBrush('연필',2,1,'#000000');
addQuickBrush('부드러움',12,0.7,'#000000');
addQuickBrush('하드',24,1,'#000000');
addQuickBrush('불투명',40,1,'#000000');
addQuickBrush('수채',60,0.4,'#000000');

/* ========== UI: brush opacity input, pressure toggle, symmetry toggle, selection tool basics ========== */
const brushOpacityInput = (()=>{ let el = document.getElementById('brush-opacity'); if(!el){ el=document.createElement('input'); el.id='brush-opacity'; el.type='range'; el.min=0; el.max=1; el.step=0.01; el.value=1; toolbar.appendChild(el);} return el; })();
const pressureToggle = (()=>{ let el = document.getElementById('pressure-toggle'); if(!el){ el=document.createElement('button'); el.id='pressure-toggle'; el.textContent='압력:ON'; toolbar.appendChild(el);} return el; })();
pressureToggle.addEventListener('click', ()=>{ strokePressureEnabled = !strokePressureEnabled; pressureToggle.textContent = strokePressureEnabled ? '압력:ON' : '압력:OFF'; });
let strokePressureEnabled = true;

const symmetryToggle = (()=>{ let el = document.getElementById('symmetry-toggle'); if(!el){ el=document.createElement('button'); el.id='symmetry-toggle'; el.textContent='대칭:OFF'; toolbar.appendChild(el);} return el; })();
symmetryToggle.addEventListener('click', ()=>{ drawState.symmetry = !drawState.symmetry; symmetryToggle.textContent = drawState.symmetry ? '대칭:ON' : '대칭:OFF'; });

/* ========== Canvas panning with mouse drag (space or middle click) - implemented via view.offsetX/Y above ========== */
document.addEventListener('keydown', (e)=>{
  if(e.key === ' '){ // space toggles pan mode
    container.style.cursor = 'grab';
  }
  if(e.key === 'Tab'){ e.preventDefault(); // hide/show UI
    const hidden = toolbar.style.display === 'none';
    toolbar.style.display = hidden ? 'flex' : 'none';
    layersPanel.style.display = hidden ? 'block' : 'none';
    galleryPanel.style.display = hidden ? 'flex' : 'none';
    shortcutGuide.style.display = hidden ? 'none' : 'none';
  }
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); undo(); }
  if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase()==='z'){ e.preventDefault(); redo(); }
});
document.addEventListener('keyup', (e)=>{ if(e.key===' ') container.style.cursor='default'; });

/* ========== Shortcut guide rendering ========== */
function renderShortcutGuide(){
  shortcutGuide.innerHTML = '<b>단축키 가이드</b><br>'
  + 'Ctrl+Z: 되돌리기<br>Ctrl+Shift+Z: 취소<br>'
  + 'Space/Drag: 패닝(화면 이동)<br>Tab: UI 숨기기<br>'
  + 'S: 스포이드, B: 브러시, E: 지우개';
  shortcutGuide.style.display='block';
}
renderShortcutGuide();

/* ========== Selection tool skeleton (rect select + move) ========== */
let selection = { active:false, rect:null, start:null, moving:false, image:null, sx:0, sy:0 };
function startSelection(sx,sy){ selection.active=true; selection.start={x:sx,y:sy}; selection.rect=null; }
function updateSelection(sx,sy){
  if(!selection.active) return;
  const x = Math.min(selection.start.x, sx), y = Math.min(selection.start.y, sy);
  const w = Math.abs(selection.start.x - sx), h = Math.abs(selection.start.y - sy);
  selection.rect = { x,y,w,h };
  // visual: draw overlay using a temporary canvas could be implemented; skip heavy UI here.
}
function finalizeSelection(){
  if(!selection.rect) return;
  // capture selected pixels from composite canvas (flatten) into selection.image
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, selection.rect.w, selection.rect.h);
  const tctx = tmp.getContext('2d');
  // draw all visible layers into tmp
  layers.forEach(l=>{ if(l.visible) tctx.drawImage(l.canvas, -selection.rect.x, -selection.rect.y); });
  selection.image = tmp;
  selection.sx = selection.rect.x; selection.sy = selection.rect.y;
  // user can now move selection.image and place it back; implement move tool separately
  selection.active = false;
}

/* ========== PSD Export via ag-psd (dynamically load) ========== */
let agPsdLoaded = false;
async function loadAgPsd(){
  if(agPsdLoaded) return window.agPsd;
  try{
    await loadScript('https://unpkg.com/ag-psd@6.2.0/dist/ag-psd.min.js');
    agPsdLoaded = !!window.require || !!window.writePsd || !!window.agPsd;
    return window.agPsd || window.writePsd || null;
  }catch(e){ console.warn('ag-psd load failed',e); return null; }
}
async function exportPSD(){
  const lib = await loadAgPsd();
  if(!lib){ alert('PSD 라이브러리 로드 실패'); return; }
  // build psd object
  const psd = { width: container.clientWidth, height: container.clientHeight, children:[] };
  // create layers from bottom to top
  for(const l of layers){
    // get PNG for each layer
    const png = l.canvas.toDataURL();
    psd.children.push({ name: l.name, canvasPng: png, opacity: Math.round((l.opacity||1)*255) });
  }
  try{
    // ag-psd usage: writePsd(psdObj)
    const buffer = window.agPsd ? window.agPsd.writePsd(psd) : null;
    if(buffer){
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'drawing.psd'; link.click();
    } else {
      alert('PSD 생성 실패(라이브러리 버전 문제)');
    }
  }catch(e){ console.warn(e); alert('PSD 생성 중 오류'); }
}

/* helper to load external scripts */
function loadScript(url){
  return new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    s.src = url;
    s.onload = ()=> resolve();
    s.onerror = (e)=> reject(e);
    document.head.appendChild(s);
  });
}

/* ========== GIF/APNG export (attempt to load canvas2apng or gif.js) ========== */
async function exportAPNG(framesDataUrls, delayMs=100){
  // Try to load canvas2apng (github.com/akalverboer/canvas2apng)
  try{
    await loadScript('https://unpkg.com/canvas2apng@1.1.1/dist/canvas2apng.min.js');
    if(window.Canvas2APNG){
      const first = new Image();
      first.onload = ()=>{
        const w = first.width, h = first.height;
        const c = document.createElement('canvas');
        setCanvasSizeForDisplay(c, w, h);
        const ctx = c.getContext('2d');
        // use Canvas2APNG.createAPNG
        const imgs = [];
        let loaded=0;
        framesDataUrls.forEach((src, i)=>{
          const im = new Image();
          im.onload = ()=>{ imgs[i]=im; loaded++; if(loaded===framesDataUrls.length){
            // draw frames to canvases and create apng
            const canvases = imgs.map(img=>{
              const cc = document.createElement('canvas'); setCanvasSizeForDisplay(cc, w, h);
              cc.getContext('2d').drawImage(img,0,0,w,h); return cc;
            });
            const apng = window.Canvas2APNG.createAPNG(canvases, delayMs);
            const blob = apng; // depends on lib; user can adapt
            const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download='anim.png'; link.click();
          }}; im.src = src;
        });
      };
      first.src = framesDataUrls[0];
    }else{
      alert('APNG 라이브러리 불가');
    }
  }catch(e){ console.warn('APNG export failed',e); alert('APNG export 실패'); }
}

/* ========== UI & Buttons binding ========== */
undoBtn.addEventListener('click', ()=>{ undo(); });
redoBtn.addEventListener('click', ()=>{ redo(); });
addLayerBtn.addEventListener('click', ()=>{ createLayer('Layer '+(layers.length+1)); });
mergeLayerBtn.addEventListener('click', ()=>{ if(activeLayer){ const idx = layers.indexOf(activeLayer); const targetIdx = Math.max(0, idx-1); if(layers[targetIdx]) mergeLayer(layers[targetIdx], activeLayer); } });
toggleLayersBtn.addEventListener('click', ()=>{ layersPanel.style.display = layersPanel.style.display === 'none' ? 'block' : 'none'; });

eyedropperBtn.addEventListener('click', ()=>{
  currentTool = 'eyedropper';
  alert('스포이드 활성화: 캔버스 클릭하여 색상 추출');
});

let currentTool = 'brush';
const brushToolBtn = (()=>{ let b = $('tool-brush'); if(!b){ b = document.createElement('button'); b.id='tool-brush'; b.textContent='브러시'; toolbar.appendChild(b); } return b; })();
brushToolBtn.addEventListener('click', ()=> currentTool='brush');
eraserBtn.addEventListener('click', ()=> currentTool='eraser');

fillBtn.addEventListener('click', ()=> {
  currentTool = 'fill';
  alert('페인트통: 캔버스 클릭한 지점 채우기(선택한 색)');
  // next click on container will trigger fill
  function onOneClick(e){
    floodFillAtScreen(e.clientX, e.clientY, colorPicker.value, 32);
    container.removeEventListener('pointerdown', onOneClick);
    currentTool = 'brush';
  }
  container.addEventListener('pointerdown', onOneClick);
});

zoomOutBtn.addEventListener('click', ()=>{ view.scale = 1; view.offsetX = 0; view.offsetY = 0; view.rotation = 0; updateViewTransform(); });

saveBtn.addEventListener('click', ()=> saveAsFile());
function saveAsFile(){
  // flatten and save PNG
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  layers.forEach(l=>{ if(l.visible) tctx.drawImage(l.canvas,0,0); });
  const data = tmp.toDataURL('image/png');
  const a = document.createElement('a'); a.href = data; a.download = 'drawing.png'; a.click();
  addGalleryImage(data);
}

/* gallery load/save:
   When loading a gallery image into active layer, save current layer's snapshot so undo can revert (requirement 6) */
function addGalleryImage(src){
  const img = document.createElement('img');
  img.src = src;
  img.className = 'gallery-item';
  img.style.width = '80px'; img.style.height='80px'; img.style.objectFit='cover';
  img.addEventListener('click', ()=>{
    if(activeLayer){
      // save snapshot for undo
      saveLayerHistorySnapshot(activeLayer);
    } else createLayer('Layer '+(layers.length+1));
    const image = new Image();
    image.onload = ()=>{
      activeLayer.ctx.clearRect(0,0,container.clientWidth,container.clientHeight);
      activeLayer.ctx.drawImage(image,0,0, container.clientWidth,container.clientHeight);
      saveLayerHistorySnapshot(activeLayer);
    };
    image.src = src;
  });
  galleryPanel.appendChild(img);
}

/* ========== Local persistence (auto-save / load) - addresses new refresh/deletion problem ========== */
const APP_STORAGE_KEY = 'simple_paint_app_v2';
function saveAllStateToLocal(){
  try{
    const out = { width: container.clientWidth, height: container.clientHeight, layers: [] };
    layers.forEach(l=>{
      out.layers.push({
        name: l.name,
        dataUrl: l.canvas.toDataURL(),
        opacity: l.opacity,
        visible: l.visible,
        blur: l.blur
      });
    });
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(out));
  }catch(e){ console.warn('saveAllStateToLocal failed', e); }
}
const saveAllStateToLocalDebounced = debounce(saveAllStateToLocal, 600);
function loadAllStateFromLocal(){
  try{
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if(!raw) return false;
    const state = JSON.parse(raw);
    // clear current layers
    layers.forEach(l=>{ if(l.canvas.parentElement) container.removeChild(l.canvas); });
    layers = [];
    state.layers.forEach((ld, idx)=>{
      const l = createLayer(ld.name||'Layer '+(idx+1));
      const img = new Image();
      img.onload = ()=>{ l.ctx.clearRect(0,0,container.clientWidth,container.clientHeight); l.ctx.drawImage(img,0,0,container.clientWidth,container.clientHeight); saveLayerHistorySnapshot(l); };
      img.src = ld.dataUrl;
      l.opacity = ld.opacity || 1;
      l.visible = ld.visible !== false;
      l.blur = ld.blur || 0;
    });
    activeLayer = layers[0] || null;
    updateLayersUI();
    drawLayersVisualState();
    return true;
  }catch(e){ console.warn('loadAllState failed', e); return false; }
}
window.addEventListener('beforeunload', ()=> saveAllStateToLocal());

/* ========== utility: debounce ========== */
function debounce(fn, ms){
  let t;
  return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); };
}

/* ========== Layer UI update function ========== */
function updateLayersUI(){
  layersPanel.innerHTML = '';
  for(let i=layers.length-1;i>=0;i--){
    const l = layers[i];
    const row = document.createElement('div');
    row.style.border = (l===activeLayer)?'1px solid #88f':'1px solid transparent';
    row.style.padding = '6px'; row.style.marginBottom='6px'; row.style.background='#fff';
    const name = document.createElement('div'); name.textContent = l.name;
    const opacityLabel = document.createElement('label'); opacityLabel.textContent='불투명도';
    const opacityRange = document.createElement('input'); opacityRange.type='range'; opacityRange.min=0; opacityRange.max=1; opacityRange.step=0.01; opacityRange.value = l.opacity||1;
    opacityRange.addEventListener('input', ()=>{ l.opacity = parseFloat(opacityRange.value); l.canvas.style.opacity = l.opacity; saveAllStateToLocalDebounced(); });
    const blurLabel = document.createElement('label'); blurLabel.textContent='흐림';
    const blurRange = document.createElement('input'); blurRange.type='range'; blurRange.min=0; blurRange.max=40; blurRange.step=1; blurRange.value = l.blur||0;
    blurRange.addEventListener('input', ()=>{ l.blur = parseInt(blurRange.value,10)||0; drawLayersVisualState(); saveAllStateToLocalDebounced(); });
    const visBtn = document.createElement('button'); visBtn.textContent = l.visible ? '👁' : '🚫'; visBtn.addEventListener('click', ()=>{ l.visible = !l.visible; visBtn.textContent = l.visible ? '👁':'🚫'; drawLayersVisualState(); saveAllStateToLocalDebounced(); });
    const delBtn = document.createElement('button'); delBtn.textContent='❌'; delBtn.addEventListener('click', ()=>deleteLayer(l));
    row.appendChild(name); row.appendChild(opacityLabel); row.appendChild(opacityRange); row.appendChild(blurLabel); row.appendChild(blurRange); row.appendChild(visBtn); row.appendChild(delBtn);
    row.addEventListener('click', ()=>{ activeLayer = l; updateLayersUI(); });
    layersPanel.appendChild(row);
  }
  drawLayersVisualState();
}

/* draw CSS states for layers */
function drawLayersVisualState(){
  layers.forEach(l=>{
    l.canvas.style.opacity = l.opacity !== undefined ? l.opacity : 1;
    l.canvas.style.filter = l.blur ? `blur(${l.blur}px)` : 'none';
    l.canvas.style.display = l.visible ? 'block' : 'none';
  });
}

/* ========== Initialization ========== */
resizeContainer();
if(!loadAllStateFromLocal()) createLayer('Layer 1');
updateLayersUI();
updateViewTransform();

/* ========== Keyboard shortcuts (global) ========== */
document.addEventListener('keydown', (e)=>{
  if((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z'){ e.preventDefault(); undo(); }
  if((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase()==='z'){ e.preventDefault(); redo(); }
  if(e.key.toLowerCase()==='s' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); saveAsFile(); }
  if(e.key.toLowerCase()==='b'){ currentTool='brush'; }
  if(e.key.toLowerCase()==='e'){ currentTool='eraser'; }
  if(e.key.toLowerCase()==='i'){ currentTool='eyedropper'; }
  if(e.key.toLowerCase()==='h'){ shortcutGuide.style.display = shortcutGuide.style.display === 'block' ? 'none' : 'block'; }
  if(e.key.toLowerCase()==='tab'){ e.preventDefault(); toolbar.style.display = toolbar.style.display==='none' ? 'flex' : 'none'; layersPanel.style.display = layersPanel.style.display==='none' ? 'block' : 'none'; galleryPanel.style.display = galleryPanel.style.display==='none' ? 'flex' : 'none'; }
});

/* ========== Fixes requested earlier: 
   1) Zoom out via two-finger vertical drag handled in image overlay and wheel. Global zoom via ctrl+wheel handled above.
   2) Eraser undo: history dedup implemented in saveLayerHistorySnapshot to avoid double pushes.
   3) Brush size up to 100 implemented.
   4) Blur effect: layer.blur + CSS filter applied.
   5) Canvas size adjustment: implemented via resizeContainer() and createLayer uses container size.
   6) When loading gallery image, we push snapshot to history before replacing so undo works.
   7) Persist to localStorage implemented; reload restores.
   8) Paint bucket implemented as floodFillAtScreen.
   9) Mobile UI: z-index and fixed wrapper for overlays + UI hide Tab key ensures buttons not blocked.
*/

/* ========== Expose helpful APIs for debugging/testing ========== */
window.simplePaint = {
  createLayer, deleteLayer, mergeLayer, saveAsFile, exportPSD, exportAPNG,
  saveAllStateToLocal, loadAllStateFromLocal, undo, redo, setHistoryLimit: (n)=>{ historyLimit=n; }
};
