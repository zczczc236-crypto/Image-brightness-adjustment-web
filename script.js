/* ========= 기본 DOM 요소 ========= */
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

/* ========= 상태 ========= */
let layers = [];
let activeLayer = null;
let history = [];
let redoStack = [];
let usingEraser = false;

/* ========= 초기화 ========= */
for(let i=1;i<=20;i++){
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  brushSelect.appendChild(opt);
}
brushSelect.value = 5;

window.addEventListener('load', () => {
  createLayer('Layer 1');
  resizeContainerCanvases();
  updateLayersPanel();
});
window.addEventListener('resize', resizeContainerCanvases);

/* ========= 캔버스/레이어 유틸 ========= */
function resizeContainerCanvases(){
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach(layer => {
    const tmp = document.createElement('canvas');
    tmp.width = layer.canvas.width;
    tmp.height = layer.canvas.height;
    tmp.getContext('2d').drawImage(layer.canvas,0,0);
    layer.canvas.width = w;
    layer.canvas.height = h;
    layer.ctx.drawImage(tmp,0,0, tmp.width, tmp.height, 0,0, w, h);
  });
}

/* ========= 레이어 기능 ========= */
function createLayer(name='Layer'){
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth || 800;
  canvas.height = container.clientHeight || 600;
  canvas.style.zIndex = layers.length;
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const layer = {canvas, ctx, name, brightness:1, visible:true};
  layers.push(layer);
  activeLayer = layer;
  attachDrawingEvents(canvas);
  drawLayers();
  saveHistory();
  updateLayersPanel();
  return layer;
}

function deleteLayer(layer){
  if(layers.length <= 1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx, 1);
  if(layer.canvas.parentElement) container.removeChild(layer.canvas);
  if(activeLayer === layer) activeLayer = layers[layers.length - 1];
  layers.forEach((l,i)=> { l.canvas.style.zIndex = i; if(l.canvas.parentElement) container.appendChild(l.canvas); });
  updateLayersPanel();
  saveHistory();
}

function moveLayer(layer, dir){
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if(newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx,1);
  layers.splice(newIdx,0,layer);
  layers.forEach((l,i)=> { l.canvas.style.zIndex = i; container.appendChild(l.canvas); });
  updateLayersPanel();
  saveHistory();
}

function mergeActiveWithNeighbor(){
  if(layers.length < 2) return;
  const idx = layers.indexOf(activeLayer);
  let targetIdx = idx - 1;
  if(targetIdx < 0) targetIdx = idx + 1;
  if(targetIdx < 0 || targetIdx >= layers.length) return;
  const target = layers[targetIdx];
  target.ctx.save();
  target.ctx.globalCompositeOperation = 'source-over';
  target.ctx.drawImage(activeLayer.canvas, 0,0);
  target.ctx.restore();
  deleteLayer(activeLayer);
  activeLayer = target;
  updateLayersPanel();
  saveHistory();
}

function drawLayers(){
  layers.forEach((layer) => {
    layer.canvas.style.display = layer.visible ? 'block' : 'none';
    layer.canvas.style.filter = `brightness(${layer.brightness})`;
  });
}

function updateLayersPanel(){
  layersPanel.innerHTML = '';
  for(let i = layers.length - 1; i >= 0; i--){
    const layer = layers[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer === activeLayer ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = layer.name;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '2';
    range.step = '0.01';
    range.value = layer.brightness;
    const visBtn = document.createElement('button');
    visBtn.textContent = layer.visible ? '👁' : '🚫';
    const delBtn = document.createElement('button');
    delBtn.textContent = '❌';
    const upBtn = document.createElement('button');
    upBtn.textContent = '⬆️';
    const downBtn = document.createElement('button');
    downBtn.textContent = '⬇️';
    const controls = document.createElement('div');
    controls.className = 'layer-controls';
    controls.appendChild(visBtn);
    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(delBtn);

    item.appendChild(name);
    item.appendChild(range);
    item.appendChild(controls);

    item.addEventListener('click', (ev)=>{
      if(ev.target.tagName==='BUTTON' || ev.target.tagName==='INPUT') return;
      activeLayer = layer;
      updateLayersPanel();
    });
    range.addEventListener('input', ()=>{ layer.brightness = parseFloat(range.value); drawLayers(); });
    visBtn.addEventListener('click', (e)=>{ e.stopPropagation(); layer.visible=!layer.visible; visBtn.textContent=layer.visible?'👁':'🚫'; drawLayers(); saveHistory(); });
    delBtn.addEventListener('click', (e)=>{ e.stopPropagation(); deleteLayer(layer); });
    upBtn.addEventListener('click', (e)=>{ e.stopPropagation(); moveLayer(layer,+1); });
    downBtn.addEventListener('click', (e)=>{ e.stopPropagation(); moveLayer(layer,-1); });

    layersPanel.appendChild(item);
  }
}

/* ========= 히스토리 ========= */
function saveHistory(){
  if(!activeLayer) return;
  try{
    const data = activeLayer.canvas.toDataURL('image/png');
    const idx = layers.indexOf(activeLayer);
    history.push({layerIndex: idx, dataUrl: data});
    if(history.length > 200) history.shift();
    redoStack = [];
  }catch(e){ console.warn('saveHistory failed', e); }
}
async function restoreSnapshot(snapshot){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>{ const layer = layers[snapshot.layerIndex]; if(!layer) return resolve(); layer.ctx.clearRect(0,0,layer.canvas.width,layer.canvas.height); layer.ctx.drawImage(img,0,0,layer.canvas.width,layer.canvas.height); resolve(); };
    img.src = snapshot.dataUrl;
  });
}
undoBtn.addEventListener('click', async ()=>{
  if(history.length===0) return;
  const last = history.pop();
  try{ const current = layers[last.layerIndex].canvas.toDataURL('image/png'); redoStack.push({layerIndex:last.layerIndex,dataUrl:current}); }catch(e){}
  await restoreSnapshot(last);
  updateLayersPanel();
});
redoBtn.addEventListener('click', async ()=>{
  if(redoStack.length===0) return;
  const next = redoStack.pop();
  try{ const current = layers[next.layerIndex].canvas.toDataURL('image/png'); history.push({layerIndex:next.layerIndex,dataUrl:current}); }catch(e){}
  await restoreSnapshot(next);
  updateLayersPanel();
});

/* ========= 도구 ========= */
fillBtn.addEventListener('click', ()=>{
  if(!activeLayer) return;
  activeLayer.ctx.save();
  activeLayer.ctx.fillStyle = colorPicker.value;
  activeLayer.ctx.fillRect(0,0,activeLayer.canvas.width,activeLayer.canvas.height);
  activeLayer.ctx.restore();
  saveHistory();
});
eraserBtn.addEventListener('click', ()=>{
  usingEraser=!usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

/* ========= 그리기 ========= */
function attachDrawingEvents(canvas){
  let drawing=false;
  let pointerId=null;
  let last={x:0,y:0};
  function toCanvasPos(clientX,clientY){ const rect = container.getBoundingClientRect(); return {x:clientX-rect.left, y:clientY-rect.top}; }
  function pointerdown(e){ if(e.button && e.button!==0) return; canvas.setPointerCapture&&canvas.setPointerCapture(e.pointerId); pointerId=e.pointerId; drawing=true; last=toCanvasPos(e.clientX,e.clientY); if(activeLayer){ const ctx=activeLayer.ctx; ctx.beginPath(); ctx.moveTo(last.x,last.y); } }
  function pointermove(e){ if(!drawing||e.pointerId!==pointerId) return; const p=toCanvasPos(e.clientX,e.clientY); if(!activeLayer) return; const ctx=activeLayer.ctx; ctx.save(); ctx.globalCompositeOperation = usingEraser?'destination-out':'source-over'; ctx.strokeStyle=colorPicker.value; ctx.lineWidth=parseFloat(brushSelect.value)||5; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); ctx.restore(); last=p; }
  function pointerup(e){ if(e.pointerId!==pointerId) return; canvas.releasePointerCapture&&canvas.releasePointerCapture(e.pointerId); pointerId=null; drawing=false; saveHistory(); }
  canvas.addEventListener('pointerdown',pointerdown,{passive:false});
  canvas.addEventListener('pointermove',pointermove,{passive:false});
  canvas.addEventListener('pointerup',pointerup);
  canvas.addEventListener('pointercancel',pointerup);
  canvas.addEventListener('pointerleave',(e)=>{ if(drawing&&e.pointerId===pointerId) pointerup(e); });
}

/* ========= 저장/갤러리 ========= */
saveBtn.addEventListener('click', ()=>{
  const tmp=document.createElement('canvas'); tmp.width=container.clientWidth; tmp.height=container.clientHeight;
  const tctx=tmp.getContext('2d'); layers.forEach(layer=>{ if(layer.visible) tctx.drawImage(layer.canvas,0,0); });
  const data=tmp.toDataURL('image/png');
  const link=document.createElement('a'); link.download='drawing.png'; link.href=data; link.click();
  addGalleryThumbnail(data);
});
function addGalleryThumbnail(src){
  const img=document.createElement('img'); img.src=src; img.className='gallery-item'; img.title='불러오기';
  img.addEventListener('click', ()=>{
    const image=new Image();
    image.onload=()=>{
      if(!activeLayer) createLayer('Layer '+(layers.length+1));
      activeLayer.ctx.clearRect(0,0,activeLayer.canvas.width,activeLayer.canvas.height);
      activeLayer.ctx.drawImage(image,0,0,activeLayer.canvas.width,activeLayer.canvas.height);
      saveHistory();
    };
    image.src=src;
  });
  galleryPanel.appendChild(img);
}

/* ========= 레이어 창 토글 ========= */
toggleLayersBtn.addEventListener('click', ()=>{
  layersPanel.classList.toggle('visible');
  layersPanel.setAttribute('aria-hidden',!layersPanel.classList.contains('visible'));
});

/* ========= 레이어 버튼 ========= */
addLayerBtn.addEventListener('click', ()=>createLayer('Layer '+(layers.length+1)));
mergeLayerBtn.addEventListener('click', ()=>mergeActiveWithNeighbor());

/* ========= 이미지 삽입 ========= */
imageInput.addEventListener('change', (ev)=>{
  const f = ev.target.files && ev.target.files[0];
  if(!f) return;
  const img = new Image();
  img.onload = ()=> openImageEditorOverlay(img);
  img.src = URL.createObjectURL(f);
  imageInput.value = '';
});

function openImageEditorOverlay(image){
  const overlayWrapper = document.createElement('div');
  overlayWrapper.style.position = 'absolute';
  overlayWrapper.style.top = '0';
  overlayWrapper.style.left = '0';
  overlayWrapper.style.width = '100%';
  overlayWrapper.style.height = '100%';
  overlayWrapper.style.zIndex = 3000;
  overlayWrapper.style.pointerEvents = 'auto';
  container.appendChild(overlayWrapper);

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = container.clientWidth;
  overlayCanvas.height = container.clientHeight;
  overlayCanvas.style.position = 'absolute';
  overlayCanvas.style.left = '0';
  overlayCanvas.style.top = '0';
  overlayCanvas.style.zIndex = 1;
  overlayWrapper.appendChild(overlayCanvas);
  const octx = overlayCanvas.getContext('2d');

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = image.width;
  srcCanvas.height = image.height;
  srcCanvas.getContext('2d').drawImage(image, 0, 0);

  let scale = Math.min(Math.min(overlayCanvas.width / image.width, overlayCanvas.height / image.height), 1);
  let angle = 0;
  let pos = { x: (overlayCanvas.width - image.width * scale) / 2, y: (overlayCanvas.height - image.height * scale) / 2 };
  let dragging = false;
  let lastPoint = null;

  function draw() {
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    octx.save();
    octx.translate(pos.x + image.width * scale / 2, pos.y + image.height * scale / 2);
    octx.rotate(angle * Math.PI / 180);
    octx.drawImage(srcCanvas, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
    octx.restore();
  }

  function getPointFromEvent(e, idx = 0) {
    const rect = overlayCanvas.getBoundingClientRect();
    if (e.touches && e.touches.length > idx) return { x: e.touches[idx].clientX - rect.left, y: e.touches[idx].clientY - rect.top };
    else if (e.clientX !== undefined) return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return null;
  }

  overlayCanvas.addEventListener('mousedown', (e) => { if(e.target.tagName==='BUTTON') return; dragging = true; lastPoint = getPointFromEvent(e); });
  window.addEventListener('mousemove', (e) => { if (!dragging) return; const p = getPointFromEvent(e); pos.x += p.x - lastPoint.x; pos.y += p.y - lastPoint.y; lastPoint = p; draw(); });
  window.addEventListener('mouseup', () => { dragging = false; });

  overlayCanvas.addEventListener('touchstart', (e) => { if(e.target.tagName==='BUTTON') return; if (e.touches.length === 1) { lastPoint = getPointFromEvent(e, 0); dragging = true; } }, { passive: false });
  overlayCanvas.addEventListener('touchmove', (e) => { if (dragging && e.touches.length === 1) { const p = getPointFromEvent(e, 0); pos.x += p.x - lastPoint.x; pos.y += p.y - lastPoint.y; lastPoint = p; draw(); } }, { passive: false });
  overlayCanvas.addEventListener('touchend', (e) => { if (e.touches.length === 0) dragging = false; });

  const actions = document.createElement('div');
  actions.style.position = 'absolute';
  actions.style.bottom = '10px';
  actions.style.left = '50%';
  actions.style.transform = 'translateX(-50%)';
  actions.style.zIndex = 10;
  overlayWrapper.appendChild(actions);

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✔';
  confirmBtn.style.fontSize='18px';
  confirmBtn.style.padding='8px 12px';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✖';
  cancelBtn.style.fontSize='18px';
  cancelBtn.style.padding='8px 12px';
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  confirmBtn.addEventListener('click', () => {
    if (!activeLayer) activeLayer = createLayer('Layer ' + (layers.length + 1));
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + image.width * scale / 2, pos.y + image.height * scale / 2);
    activeLayer.ctx.rotate(angle * Math.PI / 180);
    activeLayer.ctx.drawImage(srcCanvas, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
    activeLayer.ctx.restore();
    saveHistory();
    cleanup();
  });

  cancelBtn.addEventListener('click', cleanup);

  function cleanup() {
    if (overlayWrapper && overlayWrapper.parentElement) container.removeChild(overlayWrapper);
  }

  draw();
}

/* ========= 단축키 ========= */
window.addEventListener('keydown',(e)=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); undoBtn.click(); }
  if((e.ctrlKey||e.metaKey)&& (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))){ e.preventDefault(); redoBtn.click(); }
});

if(layers.length===0) createLayer('Layer 1');
updateLayersPanel();
drawLayers();
