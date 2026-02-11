/* 파일명: script.js
   전체 통합본 — 요청받은 모든 기능 반영
   ※ 요약 없음 — 코드 전체 제공
*/

/* ===== DOM 참조 ===== */
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

/* ===== 상태 및 설정 ===== */
let layers = [];
let activeLayer = null;
let history = [];
let redoStack = [];
let usingEraser = false;
let canvasMode = 'draw'; // 'draw' | 'bucket'
let lastActionRecorded = false;
const MAX_HISTORY = 300;

/* ===== 유틸: 고해상도 캔버스 ===== */
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

/* ===== 컨테이너/레이아웃 초기화 ===== */
function updateContainerSize() {
  const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
  const w = window.innerWidth;
  const h = Math.max(120, window.innerHeight - toolbarHeight);
  container.style.width = w + 'px';
  container.style.height = h + 'px';
}
window.addEventListener('load', () => {
  updateContainerSize();
});
window.addEventListener('resize', () => {
  updateContainerSize();
  clearTimeout(window.__resize_timeout);
  window.__resize_timeout = setTimeout(resizeAllCanvases, 80);
});

/* ===== 브러시/지우개 컨트롤: 1..100 ===== */
brushSelect.innerHTML = '';
for (let i = 1; i <= 100; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 20;

/* ===== 히스토리 ===== */
function snapshotAllLayers() {
  const snap = {
    timestamp: Date.now(),
    activeIndex: layers.indexOf(activeLayer),
    layers: layers.map(l => ({
      dataUrl: l.canvas.toDataURL('image/png'),
      name: l.name,
      brightness: l.brightness,
      visible: l.visible,
      blur: l.blur || 0,
      opacity: (l.opacity === undefined ? 1 : l.opacity)
    }))
  };
  history.push(snap);
  if (history.length > MAX_HISTORY) history.shift();
  redoStack = [];
}
function restoreAllLayersSnapshot(snap) {
  while (container.firstChild) container.removeChild(container.firstChild);
  layers = [];
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || Math.max(400, window.innerHeight - (toolbar ? toolbar.clientHeight : 48));
  snap.layers.forEach((meta, i) => {
    const canvas = document.createElement('canvas');
    canvas.className = 'layer-canvas';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    container.appendChild(canvas);
    const ctx = setCanvasSizeForDisplay(canvas, w, h);
    const layer = { canvas, ctx, name: meta.name || `Layer ${i+1}`, brightness: meta.brightness, visible: meta.visible, blur: meta.blur || 0, opacity: meta.opacity || 1 };
    layers.push(layer);
    const img = new Image();
    ((layer, dataUrl) => {
      img.onload = () => {
        layer.ctx.clearRect(0, 0, w, h);
        layer.ctx.drawImage(img, 0, 0, w, h);
        applyLayerStyles(layer);
        updateLayersPanel();
      };
    })(layer, meta.dataUrl);
    img.src = meta.dataUrl;
    attachDrawingEvents(canvas);
  });
  activeLayer = layers[Math.min(snap.activeIndex || 0, layers.length - 1)] || layers[0];
}

/* ===== Undo / Redo ===== */
function saveHistory() { snapshotAllLayers(); }
function undo() {
  if (!history.length) return;
  const last = history.pop();
  redoStack.push({
    timestamp: Date.now(),
    activeIndex: layers.indexOf(activeLayer),
    layers: layers.map(l => ({
      dataUrl: l.canvas.toDataURL('image/png'),
      name: l.name,
      brightness: l.brightness,
      visible: l.visible,
      blur: l.blur || 0,
      opacity: (l.opacity === undefined ? 1 : l.opacity)
    }))
  });
  restoreAllLayersSnapshot(last);
}
function redo() {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  history.push({
    timestamp: Date.now(),
    activeIndex: layers.indexOf(activeLayer),
    layers: layers.map(l => ({
      dataUrl: l.canvas.toDataURL('image/png'),
      name: l.name,
      brightness: l.brightness,
      visible: l.visible,
      blur: l.blur || 0,
      opacity: (l.opacity === undefined ? 1 : l.opacity)
    }))
  });
  restoreAllLayersSnapshot(next);
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

/* ===== 레이어 유틸 ===== */
function applyLayerStyles(layer) {
  layer.canvas.style.filter = `brightness(${layer.brightness}) blur(${layer.blur || 0}px)`;
  layer.canvas.style.opacity = `${layer.opacity ?? 1}`;
}
function updateLayersPanel() {
  if (!layersPanel) return;
  layersPanel.innerHTML = '';
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer === activeLayer ? ' active' : '');
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    item.style.marginBottom = '6px';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = layer.name;
    name.style.flex = '1';
    const visBtn = document.createElement('button');
    visBtn.textContent = layer.visible ? '👁' : '🚫';
    const upBtn = document.createElement('button'); upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button'); downBtn.textContent = '⬇️';
    const delBtn = document.createElement('button'); delBtn.textContent = '❌';
    row.appendChild(name); row.appendChild(visBtn); row.appendChild(upBtn); row.appendChild(downBtn); row.appendChild(delBtn);
    const controls = document.createElement('div');
    controls.style.display = 'flex'; controls.style.gap = '6px'; controls.style.alignItems = 'center';
    const brightRange = document.createElement('input'); brightRange.type='range'; brightRange.min='0'; brightRange.max='2'; brightRange.step='0.01'; brightRange.value=layer.brightness ?? 1;
    const blurRange = document.createElement('input'); blurRange.type='range'; blurRange.min='0'; blurRange.max='50'; blurRange.step='1'; blurRange.value=layer.blur || 0;
    const opRange = document.createElement('input'); opRange.type='range'; opRange.min='0'; opRange.max='1'; opRange.step='0.01'; opRange.value=layer.opacity ?? 1;
    controls.appendChild(brightRange); controls.appendChild(blurRange); controls.appendChild(opRange);
    item.appendChild(row); item.appendChild(controls);

    item.addEventListener('click', e => { if(!['BUTTON','INPUT'].includes(e.target.tagName)) { activeLayer=layer; updateLayersPanel(); }});
    visBtn.addEventListener('click', e => { e.stopPropagation(); layer.visible=!layer.visible; visBtn.textContent=layer.visible?'👁':'🚫'; applyLayerStyles(layer); saveHistory(); });
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', e => { e.stopPropagation(); moveLayer(layer,+1); });
    downBtn.addEventListener('click', e => { e.stopPropagation(); moveLayer(layer,-1); });

    brightRange.addEventListener('input', e=>{ layer.brightness=parseFloat(brightRange.value); applyLayerStyles(layer); saveHistory(); });
    blurRange.addEventListener('input', e=>{ layer.blur=parseFloat(blurRange.value); applyLayerStyles(layer); saveHistory(); });
    opRange.addEventListener('input', e=>{ layer.opacity=parseFloat(opRange.value); applyLayerStyles(layer); saveHistory(); });

    layersPanel.appendChild(item);
  }
}

/* ===== 레이어 생성/삭제/이동/합체 ===== */
function createLayer(name=`Layer ${layers.length+1}`) {
  const canvas=document.createElement('canvas'); canvas.className='layer-canvas'; canvas.style.position='absolute'; canvas.style.left='0'; canvas.style.top='0'; canvas.style.touchAction='none'; container.appendChild(canvas);
  const ctx=setCanvasSizeForDisplay(canvas,container.clientWidth||window.innerWidth,container.clientHeight||Math.max(400,window.innerHeight-(toolbar?toolbar.clientHeight:48)));
  ctx.lineJoin='round'; ctx.lineCap='round';
  const layer={canvas,ctx,name,brightness:1,visible:true,blur:0,opacity:1};
  layers.push(layer); activeLayer=layer;
  attachDrawingEvents(canvas); applyLayerStyles(layer); saveHistory(); updateLayersPanel(); return layer;
}
function deleteLayer(layer){ if(layers.length<=1) return; const idx=layers.indexOf(layer); layers.splice(idx,1); if(layer.canvas.parentElement) container.removeChild(layer.canvas); if(activeLayer===layer) activeLayer=layers[layers.length-1]; layers.forEach((l,i)=>l.canvas.style.zIndex=i); saveHistory(); updateLayersPanel(); }
function moveLayer(layer,dir){ const idx=layers.indexOf(layer); const newIdx=idx+dir; if(newIdx<0||newIdx>=layers.length) return; layers.splice(idx,1); layers.splice(newIdx,0,layer); layers.forEach((l,i)=>{ l.canvas.style.zIndex=i; container.appendChild(l.canvas); }); saveHistory(); updateLayersPanel(); }
function mergeActiveWithNeighbor(){ if(layers.length<2) return; const idx=layers.indexOf(activeLayer); let neighbor=idx-1; if(neighbor<0) neighbor=idx+1; if(neighbor<0||neighbor>=layers.length) return; const target=layers[neighbor]; target.ctx.save(); target.ctx.globalCompositeOperation='source-over'; target.ctx.drawImage(activeLayer.canvas,0,0,container.clientWidth,container.clientHeight); target.ctx.restore(); deleteLayer(activeLayer); activeLayer=target; updateLayersPanel(); saveHistory(); }

/* ===== 그리기: Pointer Events 통합 ===== */
function attachDrawingEvents(canvas){
  let drawing=false,pointerId=null,last={x:0,y:0},strokeCaptured=false;
  function toCanvasPos(x,y){ const r=container.getBoundingClientRect(); return{x:x-r.left,y:y-r.top}; }
  function startStroke(){ strokeCaptured=false; }
  function endStroke(){ if(strokeCaptured){ saveHistory(); strokeCaptured=false; } }
  function onDown(e){ if(e.target.tagName==='BUTTON') return; canvas.setPointerCapture?.(e.pointerId); pointerId=e.pointerId; drawing=true; last=toCanvasPos(e.clientX,e.clientY); startStroke(); if(activeLayer){ const ctx=activeLayer.ctx; ctx.beginPath(); ctx.moveTo(last.x,last.y); } }
  function onMove(e){ if(!drawing||e.pointerId!==pointerId) return; const p=toCanvasPos(e.clientX,e.clientY); if(!activeLayer) return; const ctx=activeLayer.ctx; ctx.save(); ctx.globalCompositeOperation=usingEraser?'destination-out':'source-over'; ctx.strokeStyle=colorPicker.value; ctx.lineWidth=Math.max(1,parseFloat(brushSelect.value)||1); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); ctx.restore(); last=p; strokeCaptured=true; }
  function onUp(e){ if(e.pointerId!==pointerId) return; canvas.releasePointerCapture?.(e.pointerId); drawing=false; endStroke(); }
  canvas.addEventListener('pointerdown',onDown,{passive:false});
  window.addEventListener('pointermove',onMove,{passive:false});
  window.addEventListener('pointerup',onUp);
  canvas.addEventListener('pointercancel',onUp);
  canvas.addEventListener('pointerleave',e=>{ if(drawing&&e.pointerId===pointerId) onUp(e); });
}

/* ===== Flood Fill ===== */
function colorToRgbaArray(hexOrRgb){ const ctx=document.createElement('canvas').getContext('2d'); ctx.fillStyle=hexOrRgb; const c=ctx.fillStyle; ctx.canvas.width=1; ctx.canvas.height=1; ctx.fillRect(0,0,1,1); const d=ctx.getImageData(0,0,1,1).data; return[d[0],d[1],d[2],d[3]]; }
function floodFill(layer,startX,startY,fillColor){
  const ctx=layer.ctx;
  const w=layer.canvas.width/(window.devicePixelRatio||1);
  const h=layer.canvas.height/(window.devicePixelRatio||1);
  try{
    const img=ctx.getImageData(0,0,w,h);
    const data=img.data;
    const idx=(Math.floor(startY)*w+Math.floor(startX))*4;
    const sr=data[idx],sg=data[idx+1],sb=data[idx+2],sa=data[idx+3];
    const [fr,fg,fb,fa]=colorToRgbaArray(fillColor);
    if(sr===fr&&sg===fg&&sb===fb&&sa===fa) return;
    const visited=new Uint8Array(w*h);
    const stack=[{x:Math.floor(startX),y:Math.floor(startY)}];
    while(stack.length){
      const p=stack.pop(); const x=p.x,y=p.y;
      if(x<0||y<0||x>=w||y>=h) continue;
      const i=y*w+x; if(visited[i]) continue;
      const o=i*4; const r=data[o],g=data[o+1],b=data[o+2],a=data[o+3];
      if(r===sr&&g===sg&&b===sb&&a===sa){
        data[o]=fr; data[o+1]=fg; data[o+2]=fb; data[o+3]=fa; visited[i]=1;
        stack.push({x:x+1,y}); stack.push({x:x-1,y}); stack.push({x,y:y+1}); stack.push({x,y:y-1});
      }
    }
    ctx.putImageData(img,0,0);
  }catch(e){ console.warn('floodFill failed',e); }
}
fillBtn.addEventListener('click',()=>{ canvasMode='bucket'; fillBtn.style.background='#ddd'; });
container.addEventListener('pointerdown',ev=>{
  if(canvasMode!=='bucket') return;
  ev.preventDefault();
  const rect=container.getBoundingClientRect();
  const x=ev.clientX-rect.left; const y=ev.clientY-rect.top;
  if(activeLayer){ snapshotAllLayers(); floodFill(activeLayer,x,y,colorPicker.value); canvasMode='draw'; fillBtn.style.background=''; }
});

/* ===== 지우개 ===== */
eraserBtn.addEventListener('click',()=>{ usingEraser=!usingEraser; eraserBtn.style.background=usingEraser?'#ddd':''; });

/* ===== 캔버스 리사이즈 ===== */
(function(){
  if(!toolbar) return;
  const resizeLabel=document.createElement('label'); resizeLabel.style.marginLeft='8px'; resizeLabel.textContent='캔버스:';
  const wInput=document.createElement('input'); wInput.type='number'; wInput.min='100'; wInput.style.width='80px'; wInput.placeholder='width';
  const hInput=document.createElement('input'); hInput.type='number'; hInput.min='100'; hInput.style.width='80px'; hInput.placeholder='height';
  const applyBtn=document.createElement('button'); applyBtn.textContent='적용';
  applyBtn.addEventListener('click',()=>{ const w=parseInt(wInput.value)||container.clientWidth; const h=parseInt(hInput.value)||container.clientHeight; container.style.width=w+'px'; container.style.height=h+'px'; resizeAllCanvases(); });
  toolbar.appendChild(resizeLabel); toolbar.appendChild(wInput); toolbar.appendChild(hInput); toolbar.appendChild(applyBtn);
})();
function resizeAllCanvases(){
  const w=container.clientWidth,h=container.clientHeight;
  layers.forEach(layer=>{
    const oldW=layer.canvas.width/(window.devicePixelRatio||1);
    const oldH=layer.canvas.height/(window.devicePixelRatio||1);
    const tmp=document.createElement('canvas');
    const tctx=setCanvasSizeForDisplay(tmp,w,h);
    const oldDataUrl=layer.canvas.toDataURL();
    const img=new Image();
    img.onload=()=>{ tctx.drawImage(img,0,0,w,h); layer.ctx.clearRect(0,0,w,h); layer.ctx.drawImage(tmp,0,0); };
    img.src=oldDataUrl;
  });
}

/* ===== 이미지 삽입 Overlay ===== */
let imageOverlay=null, overlayCtx=null, overlayImg=null, overlayTransform={x:0,y:0,scale:1};
imageInput.addEventListener('change', e=>{
  const file=e.target.files[0]; if(!file) return;
  const url=URL.createObjectURL(file);
  overlayImg=new Image(); overlayImg.onload=()=>{ setupOverlay(); }; overlayImg.src=url;
});
function setupOverlay(){
  if(imageOverlay){ container.removeChild(imageOverlay); imageOverlay=null; overlayCtx=null; overlayTransform={x:0,y:0,scale:1}; }
  imageOverlay=document.createElement('canvas'); imageOverlay.className='layer-canvas'; imageOverlay.style.position='absolute'; imageOverlay.style.left='0'; imageOverlay.style.top='0';
  imageOverlay.style.zIndex=9999; container.appendChild(imageOverlay);
  overlayCtx=setCanvasSizeForDisplay(imageOverlay,container.clientWidth,container.clientHeight);
  drawOverlay();
  // Pointer Events for pan/zoom
  let pId=null,last={x:0,y:0},dragging=false;
  imageOverlay.addEventListener('pointerdown',e=>{ e.preventDefault(); pId=e.pointerId; dragging=true; last={x:e.clientX,y:e.clientY}; imageOverlay.setPointerCapture(pId); });
  imageOverlay.addEventListener('pointermove',e=>{ if(!dragging||e.pointerId!==pId) return; const dx=e.clientX-last.x; const dy=e.clientY-last.y; overlayTransform.x+=dx; overlayTransform.y+=dy; last={x:e.clientX,y:e.clientY}; drawOverlay(); });
  imageOverlay.addEventListener('pointerup',e=>{ if(e.pointerId!==pId) return; dragging=false; imageOverlay.releasePointerCapture(pId); });
  imageOverlay.addEventListener('wheel',e=>{ e.preventDefault(); const delta=e.deltaY<0?1.05:0.95; overlayTransform.scale*=delta; drawOverlay(); });
  // 합성 버튼 클릭 시 activeLayer에 병합
  const insertBtn=document.createElement('button'); insertBtn.textContent='이미지 삽입'; toolbar.appendChild(insertBtn);
  insertBtn.addEventListener('click',()=>{
    if(!activeLayer||!overlayImg) return;
    snapshotAllLayers();
    activeLayer.ctx.save();
    activeLayer.ctx.drawImage(imageOverlay,0,0,container.clientWidth,container.clientHeight);
    activeLayer.ctx.restore();
    container.removeChild(imageOverlay); imageOverlay=null; overlayImg=null;
  });
}
function drawOverlay(){ if(!overlayCtx||!overlayImg) return; overlayCtx.clearRect(0,0,overlayCtx.canvas.width,overlayCtx.canvas.height); const w=overlayImg.width*overlayTransform.scale; const h=overlayImg.height*overlayTransform.scale; overlayCtx.drawImage(overlayImg, overlayTransform.x, overlayTransform.y, w, h); }

/* ===== 저장 & 갤러리 ===== */
const GALLERY_KEY='simple_canvas_gallery';
function flattenLayers(){ const tmp=document.createElement('canvas'); setCanvasSizeForDisplay(tmp,container.clientWidth,container.clientHeight); const ctx=tmp.getContext('2d'); layers.forEach(l=>{ if(l.visible){ ctx.globalAlpha=l.opacity||1; ctx.filter=`brightness(${l.brightness}) blur(${l.blur||0}px)`; ctx.drawImage(l.canvas,0,0,tmp.width/tmp.style.width.replace('px',''),tmp.height/tmp.style.height.replace('px','')); } }); return tmp; }
saveBtn.addEventListener('click',()=>{
  const flat=flattenLayers();
  const link=document.createElement('a'); link.href=flat.toDataURL('image/png'); link.download='canvas.png'; link.click();
  saveToGallery(flat.toDataURL('image/png'));
});
function saveToGallery(dataUrl){
  let g=JSON.parse(localStorage.getItem(GALLERY_KEY)||'[]'); g.push({id:Date.now(),dataUrl}); localStorage.setItem(GALLERY_KEY,JSON.stringify(g)); updateGalleryPanel(); }
function updateGalleryPanel(){ galleryPanel.innerHTML=''; let g=JSON.parse(localStorage.getItem(GALLERY_KEY)||'[]'); g.forEach(item=>{ const img=document.createElement('img'); img.src=item.dataUrl; img.style.width='80px'; img.style.height='80px'; img.style.objectFit='cover'; img.style.margin='4px'; img.addEventListener('click',()=>{ snapshotAllLayers(); if(activeLayer){ const i=new Image(); i.onload=()=>{ activeLayer.ctx.clearRect(0,0,activeLayer.canvas.width,activeLayer.canvas.height); activeLayer.ctx.drawImage(i,0,0,activeLayer.canvas.width,activeLayer.canvas.height); }; i.src=item.dataUrl; } }); galleryPanel.appendChild(img); }); }
updateGalleryPanel();

/* ===== 초기 레이어 1개 생성 ===== */
createLayer('Layer 1');
