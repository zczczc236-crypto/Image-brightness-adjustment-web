/* 파일명: script.js */
/* 전체 통합본 — 요약 금지, 모든 기능 유지 + 레이어 UI 개선 + undo 즉시, cancel 복원 */

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

/* 전역 상태 */
let layers = [];
let activeLayer = null;
let pastHistory = []; // 스택: 되돌리기 가능
let futureHistory = []; // redo 가능
let usingEraser = false;

/* 레이어 상태 저장 구조 */
function captureLayersState() {
  const snapshot = {
    layers: layers.map((layer) => ({
      dataUrl: layer.canvas.toDataURL(),
      name: layer.name,
      brightness: layer.brightness,
      blur: layer.blur,
      opacity: layer.opacity,
      visible: layer.visible
    })),
    activeIndex: layers.indexOf(activeLayer)
  };
  return snapshot;
}

function applyLayersState(snapshot) {
  while (container.firstChild) container.removeChild(container.firstChild);
  layers = [];
  snapshot.layers.forEach((meta) => {
    const c = document.createElement('canvas');
    c.className = 'layer-canvas';
    c.style.position = 'absolute';
    c.style.left = '0';
    c.style.top = '0';
    container.appendChild(c);
    const ctx = setCanvasSizeForDisplay(c, container.clientWidth, container.clientHeight);
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);
      ctx.drawImage(img, 0, 0, container.clientWidth, container.clientHeight);
      const layer = {
        canvas: c,
        ctx,
        name: meta.name,
        brightness: meta.brightness,
        blur: meta.blur,
        opacity: meta.opacity,
        visible: meta.visible
      };
      layers.push(layer);
      applyLayerStyles(layer);
      attachDrawingEvents(c);
      updateLayersPanel();
    };
    img.src = meta.dataUrl;
  });
  activeLayer = layers[snapshot.activeIndex] || layers[0];
}

/* 즉시 히스토리 저장 (되돌리기) */
function saveHistory() {
  pastHistory.push(captureLayersState());
  if (pastHistory.length > 300) pastHistory.shift();
  futureHistory = [];
}

/* 되돌리기 */
function undo() {
  if (!pastHistory.length) return;
  const prev = pastHistory.pop();
  futureHistory.push(captureLayersState());
  applyLayersState(prev);
}

/* 다시 되돌리기 */
function redo() {
  if (!futureHistory.length) return;
  const next = futureHistory.pop();
  pastHistory.push(captureLayersState());
  applyLayersState(next);
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

/* 고해상도 캔버스 핸들 */
function setCanvasSizeForDisplay(canvas, w, h) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

/* 레이아웃 조정 */
function updateContainerSize() {
  const toolbarHeight = toolbar ? toolbar.clientHeight : 0;
  container.style.width = window.innerWidth + 'px';
  container.style.height = Math.max(100, window.innerHeight - toolbarHeight) + 'px';
}

window.addEventListener('load', () => {
  updateContainerSize();
  if (!layers.length) createLayer('Layer 1');
  resizeAllCanvases();
  updateLayersPanel();
});
window.addEventListener('resize', () => {
  updateContainerSize();
  clearTimeout(window.__resize_timeout);
  window.__resize_timeout = setTimeout(resizeAllCanvases, 80);
});

/* 캔버스 리사이즈 */
function resizeAllCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  layers.forEach((layer) => {
    const oldUrl = layer.canvas.toDataURL();
    const ctx = setCanvasSizeForDisplay(layer.canvas, w, h);
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      applyLayerStyles(layer);
    };
    img.src = oldUrl;
  });
}

/* 레이어 생성 */
function createLayer(name) {
  const canvas = document.createElement('canvas');
  canvas.className = 'layer-canvas';
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  container.appendChild(canvas);
  const ctx = setCanvasSizeForDisplay(canvas, container.clientWidth, container.clientHeight);
  const layer = {
    canvas,
    ctx,
    name: name || `Layer ${layers.length + 1}`,
    brightness: 1,
    blur: 0,
    opacity: 1,
    visible: true
  };
  layers.push(layer);
  activeLayer = layer;
  applyLayerStyles(layer);
  attachDrawingEvents(canvas);
  saveHistory();
  updateLayersPanel();
  return layer;
}

/* 레이어 삭제 */
function deleteLayer(layer) {
  if (layers.length <= 1) return;
  const idx = layers.indexOf(layer);
  layers.splice(idx, 1);
  container.removeChild(layer.canvas);
  activeLayer = layers[Math.max(0, idx - 1)];
  saveHistory();
  updateLayersPanel();
}

/* 레이어 이동 */
function moveLayer(layer, dir) {
  const idx = layers.indexOf(layer);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layers.length) return;
  layers.splice(idx, 1);
  layers.splice(newIdx, 0, layer);
  layers.forEach((l, i) => (l.canvas.style.zIndex = i));
  saveHistory();
  updateLayersPanel();
}

/* 레이어 합치기 */
function mergeActiveWithNeighbor() {
  if (layers.length < 2) return;
  const idx = layers.indexOf(activeLayer);
  let nb = idx - 1;
  if (nb < 0) nb = idx + 1;
  const target = layers[nb];
  target.ctx.drawImage(activeLayer.canvas, 0, 0, container.clientWidth, container.clientHeight);
  deleteLayer(activeLayer);
  activeLayer = target;
  saveHistory();
  updateLayersPanel();
}

/* 레이어 스타일 적용 */
function applyLayerStyles(layer) {
  layer.canvas.style.opacity = layer.opacity;
  layer.canvas.style.filter = `brightness(${layer.brightness}) blur(${layer.blur}px)`;
  layer.canvas.style.display = layer.visible ? 'block' : 'none';
}

/* 레이어 패널 업데이트 */
function updateLayersPanel() {
  layersPanel.innerHTML = '';
  layers
    .slice()
    .reverse()
    .forEach((layer) => {
      const item = document.createElement('div');
      item.className = 'layer-item' + (layer === activeLayer ? ' active' : '');
      item.style.marginBottom = '6px';
      item.style.display = 'flex';
      item.style.flexDirection = 'column';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.alignItems = 'center';

      const nameLabel = document.createElement('span');
      nameLabel.textContent = layer.name;
      nameLabel.style.flex = '1';

      const visBtn = document.createElement('button');
      visBtn.textContent = layer.visible ? '👁' : '🚫';

      const upBtn = document.createElement('button');
      upBtn.textContent = '⬆️';
      const downBtn = document.createElement('button');
      downBtn.textContent = '⬇️';
      const delBtn = document.createElement('button');
      delBtn.textContent = '❌';

      row.appendChild(nameLabel);
      row.appendChild(visBtn);
      row.appendChild(upBtn);
      row.appendChild(downBtn);
      row.appendChild(delBtn);

      const controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.gap = '6px';
      controls.style.flexWrap = 'wrap';

      const brightRange = document.createElement('input');
      brightRange.type = 'range';
      brightRange.min = '0';
      brightRange.max = '2';
      brightRange.step = '0.01';
      brightRange.value = layer.brightness;

      const blurRange = document.createElement('input');
      blurRange.type = 'range';
      blurRange.min = '0';
      blurRange.max = '50';
      blurRange.step = '1';
      blurRange.value = layer.blur;

      const opRange = document.createElement('input');
      opRange.type = 'range';
      opRange.min = '0';
      opRange.max = '1';
      opRange.step = '0.01';
      opRange.value = layer.opacity;

      controls.appendChild(brightRange);
      controls.appendChild(blurRange);
      controls.appendChild(opRange);

      item.appendChild(row);
      item.appendChild(controls);

      item.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        activeLayer = layer;
        updateLayersPanel();
      });

      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        applyLayerStyles(layer);
        saveHistory();
      });
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteLayer(layer);
      });
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveLayer(layer, +1);
      });
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moveLayer(layer, -1);
      });

      brightRange.addEventListener('input', () => {
        layer.brightness = parseFloat(brightRange.value);
        applyLayerStyles(layer);
        saveHistory();
      });
      blurRange.addEventListener('input', () => {
        layer.blur = parseFloat(blurRange.value);
        applyLayerStyles(layer);
        saveHistory();
      });
      opRange.addEventListener('input', () => {
        layer.opacity = parseFloat(opRange.value);
        applyLayerStyles(layer);
        saveHistory();
      });

      layersPanel.appendChild(item);
    });
}

/* 그림 그리기: Pointer Events 통합 + 한 번만 history 저장 (지우개 history 수정 반영) */
function attachDrawingEvents(canvas) {
  let drawing = false;
  let pointerId = null;
  let last = { x: 0, y: 0 };
  let strokeCaptured = false;

  function toCanvasPos(x, y) {
    const rect = container.getBoundingClientRect();
    return { x: x - rect.left, y: y - rect.top };
  }

  function startStroke() {
    strokeCaptured = false;
  }

  function endStroke() {
    if (!strokeCaptured) return;
    saveHistory();
    strokeCaptured = false;
  }

  function onDown(e) {
    if (e.target.tagName === 'BUTTON') return;
    canvas.setPointerCapture?.(e.pointerId);
    pointerId = e.pointerId;
    drawing = true;
    last = toCanvasPos(e.clientX, e.clientY);
    startStroke();
    if (activeLayer) {
      const ctx = activeLayer.ctx;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
    }
  }

  function onMove(e) {
    if (!drawing || e.pointerId !== pointerId) return;
    const p = toCanvasPos(e.clientX, e.clientY);
    if (!activeLayer) return;
    const ctx = activeLayer.ctx;
    ctx.save();
    ctx.globalCompositeOperation = usingEraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = Math.max(1, parseFloat(brushSelect.value) || 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    last = p;
    strokeCaptured = true;
  }

  function onUp(e) {
    if (e.pointerId !== pointerId) return;
    canvas.releasePointerCapture?.(e.pointerId);
    drawing = false;
    endStroke();
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e) => { if (drawing && e.pointerId === pointerId) onUp(e); });
}

/* Flood Fill (페인트 통) */
fillBtn.addEventListener('click', () => {
  setPaintBucketMode();
});

/* 페인트 통 모드 (click로 fill) */
let paintBucketMode = false;
function setPaintBucketMode() {
  paintBucketMode = true;
  fillBtn.style.background = '#ddd';
}
container.addEventListener('pointerdown', (ev) => {
  if (!paintBucketMode) return;
  ev.preventDefault();
  const rect = container.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  if (activeLayer) {
    saveHistory();
    floodFill(activeLayer, x, y, colorPicker.value);
  }
  paintBucketMode = false;
  fillBtn.style.background = '';
});

function floodFill(layer, startX, startY, fillColor) {
  const ctx = layer.ctx;
  const w = layer.canvas.width / (window.devicePixelRatio || 1);
  const h = layer.canvas.height / (window.devicePixelRatio || 1);
  try {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const idx0 = (Math.floor(startY) * w + Math.floor(startX)) * 4;
    const sr = data[idx0], sg = data[idx0+1], sb = data[idx0+2], sa = data[idx0+3];
    const [fr, fg, fb, fa] = colorToRgbaArray(fillColor);
    if (sr===fr && sg===fg && sb===fb && sa===fa) return;
    const visited = new Uint8Array(w*h);
    const stack = [{x:Math.floor(startX),y:Math.floor(startY)}];
    while(stack.length) {
      const {x,y} = stack.pop();
      if(x<0||y<0||x>=w||y>=h) continue;
      const idx = y*w + x;
      if(visited[idx]) continue;
      const o = idx*4;
      if(data[o]===sr && data[o+1]===sg && data[o+2]===sb && data[o+3]===sa) {
        data[o]=fr; data[o+1]=fg; data[o+2]=fb; data[o+3]=fa;
        visited[idx]=1;
        stack.push({x:x+1,y}); stack.push({x:x-1,y});
        stack.push({x,y:y+1}); stack.push({x,y:y-1});
      }
    }
    ctx.putImageData(imageData,0,0);
  } catch(e) {}
}

function colorToRgbaArray(css) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = css;
  ctx.fillRect(0,0,1,1);
  const d = ctx.getImageData(0,0,1,1).data;
  return [d[0],d[1],d[2],d[3]];
}

/* 지우개 */
eraserBtn.addEventListener('click', () => {
  usingEraser = !usingEraser;
  eraserBtn.style.background = usingEraser ? '#ddd' : '';
});

/* 저장/갤러리 저장 */
const GALLERY_KEY = 'simple_canvas_gallery_v1';
function loadGalleryFromStorage() {
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    arr.forEach(url => addGalleryImageElement(url));
  } catch {}
}
function saveGalleryToStorage() {
  try {
    const thumbs = Array.from(galleryPanel.querySelectorAll('img.gallery-item')).map(i => i.src);
    localStorage.setItem(GALLERY_KEY, JSON.stringify(thumbs));
  } catch {}
}
function addGalleryImage(dataUrl) {
  addGalleryImageElement(dataUrl);
  saveGalleryToStorage();
}
function addGalleryImageElement(dataUrl) {
  const img = document.createElement('img');
  img.className = 'gallery-item';
  img.src = dataUrl;
  img.addEventListener('click', () => {
    saveHistory();
    const image = new Image();
    image.onload = () => {
      if (!activeLayer) createLayer();
      activeLayer.ctx.clearRect(0,0,container.clientWidth,container.clientHeight);
      activeLayer.ctx.drawImage(image,0,0,container.clientWidth,container.clientHeight);
      applyLayerStyles(activeLayer);
      saveHistory();
    };
    image.src = dataUrl;
  });
  galleryPanel.appendChild(img);
}

loadGalleryFromStorage();

saveBtn.addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  setCanvasSizeForDisplay(tmp, container.clientWidth, container.clientHeight);
  const tctx = tmp.getContext('2d');
  for(let i=0;i<layers.length;i++) {
    const l = layers[i];
    if(!l.visible) continue;
    tctx.save();
    tctx.globalAlpha = l.opacity ?? 1;
    tctx.drawImage(l.canvas,0,0,container.clientWidth,container.clientHeight);
    tctx.restore();
  }
  const data = tmp.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = data; link.download = 'drawing.png';
  link.click();
  addGalleryImage(data);
});

/* 이미지 삽입 overlay 구현 (코드 생략되지 않음) */
/* ===== 이미지 삽입 overlay (pan/pinch/wheel/rotate) — 개선된 모바일 대응 ===== */
/* Keep actions above UI so buttons clickable even when layers panel visible */
imageInput.addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => openImageOverlay(img);
  img.src = URL.createObjectURL(f);
  imageInput.value = '';
});

function openImageOverlay(image) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = '100vw';
  wrapper.style.height = '100vh';
  wrapper.style.zIndex = '2147483640';
  wrapper.style.background = 'rgba(0,0,0,0.12)';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.touchAction = 'none';
  document.body.appendChild(wrapper);

  const inner = document.createElement('div');
  inner.style.position = 'relative';
  inner.style.width = container.clientWidth + 'px';
  inner.style.height = container.clientHeight + 'px';
  inner.style.touchAction = 'none';
  wrapper.appendChild(inner);

  const overlay = document.createElement('canvas');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.touchAction = 'none';
  inner.appendChild(overlay);
  const octx = setCanvasSizeForDisplay(overlay, inner.clientWidth, inner.clientHeight);

  const src = document.createElement('canvas');
  setCanvasSizeForDisplay(src, image.width, image.height);
  src.getContext('2d').drawImage(image, 0, 0);

  let scale = Math.min(inner.clientWidth / image.width, inner.clientHeight / image.height, 1);
  let rotation = 0;
  let pos = { x: (inner.clientWidth - image.width * scale) / 2, y: (inner.clientHeight - image.height * scale) / 2 };

  const pointers = new Map();
  let prevMiddle = null;
  let prevDist = 0;
  let prevAngle = 0;

  function redraw() {
    const w = overlay.width / (window.devicePixelRatio || 1);
    const h = overlay.height / (window.devicePixelRatio || 1);
    octx.clearRect(0, 0, w, h);
    octx.save();
    octx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    octx.rotate(rotation * Math.PI / 180);
    octx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    octx.restore();
  }
  redraw();

  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    overlay.setPointerCapture && overlay.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const p = pointers.values().next().value;
      prevMiddle = { x: p.x, y: p.y };
    } else if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      prevDist = Math.hypot(b.x - a.x, b.y - a.y);
      prevMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      prevAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const p = pointers.values().next().value;
      const dx = p.x - prevMiddle.x;
      const dy = p.y - prevMiddle.y;
      prevMiddle = { x: p.x, y: p.y };
      pos.x += dx; pos.y += dy;
      redraw();
    } else if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      const newDist = Math.hypot(b.x - a.x, b.y - a.y);
      const newMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const newAngle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (prevDist > 0) {
        const factor = newDist / prevDist;
        const oldScale = scale;
        scale = Math.max(0.05, Math.min(scale * factor, 20));
        const rect = overlay.getBoundingClientRect();
        const mx = newMiddle.x - rect.left;
        const my = newMiddle.y - rect.top;
        pos.x = mx - ((mx - pos.x) * (scale / oldScale));
        pos.y = my - ((my - pos.y) * (scale / oldScale));
      }
      const deltaAngle = newAngle - prevAngle;
      rotation += deltaAngle;
      prevDist = newDist; prevAngle = newAngle; prevMiddle = newMiddle;
      redraw();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    overlay.releasePointerCapture && overlay.releasePointerCapture(e.pointerId);
    if (pointers.size === 1) {
      const p = pointers.values().next().value;
      prevMiddle = { x: p.x, y: p.y };
    } else {
      prevMiddle = null; prevDist = 0; prevAngle = 0;
    }
  }

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('pointerleave', onPointerUp);

  overlay.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const mx = ev.clientX - rect.left; const my = ev.clientY - rect.top;
    const delta = ev.deltaY < 0 ? 1.12 : 0.88;
    const oldScale = scale;
    scale = Math.max(0.05, Math.min(scale * delta, 20));
    pos.x = mx - ((mx - pos.x) * (scale / oldScale));
    pos.y = my - ((my - pos.y) * (scale / oldScale));
    redraw();
  }, { passive: false });

  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.style.position = 'absolute';
  actions.style.bottom = '16px';
  actions.style.left = '50%';
  actions.style.transform = 'translateX(-50%)';
  actions.style.zIndex = '2147483641';
  wrapper.appendChild(actions);

  const zoomOutBtn_local = document.createElement('button'); zoomOutBtn_local.textContent = '-';
  const zoomInBtn = document.createElement('button'); zoomInBtn.textContent = '+';
  const rotL = document.createElement('button'); rotL.textContent = '⟲';
  const rotR = document.createElement('button'); rotR.textContent = '⟳';
  const cancelBtn = document.createElement('button'); cancelBtn.textContent = '✖';
  const confirmBtn = document.createElement('button'); confirmBtn.textContent = '✔';

  actions.appendChild(zoomOutBtn_local);
  actions.appendChild(zoomInBtn);
  actions.appendChild(rotL);
  actions.appendChild(rotR);
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  zoomInBtn.addEventListener('click', () => {
    const rect = overlay.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const oldScale = scale; scale = Math.min(scale * 1.2, 20);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale)); pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redraw();
  });
  zoomOutBtn_local.addEventListener('click', () => {
    const rect = overlay.getBoundingClientRect(); const cx = rect.width / 2, cy = rect.height / 2;
    const oldScale = scale; scale = Math.max(scale * 0.85, 0.05);
    pos.x = cx - ((cx - pos.x) * (scale / oldScale)); pos.y = cy - ((cy - pos.y) * (scale / oldScale));
    redraw();
  });
  rotL.addEventListener('click', () => { rotation -= 15; redraw(); });
  rotR.addEventListener('click', () => { rotation += 15; redraw(); });

  confirmBtn.addEventListener('click', () => {
    // save current canvas state for undo BEFORE applying image
    snapshotAllLayers();
    if (!activeLayer) createLayer();
    activeLayer.ctx.save();
    activeLayer.ctx.translate(pos.x + (image.width * scale) / 2, pos.y + (image.height * scale) / 2);
    activeLayer.ctx.rotate(rotation * Math.PI / 180);
    activeLayer.ctx.drawImage(src, - (image.width * scale) / 2, - (image.height * scale) / 2, image.width * scale, image.height * scale);
    activeLayer.ctx.restore();
    applyLayerStyles(activeLayer);
    saveHistory();
    cleanup();
  });

  cancelBtn.addEventListener('click', cleanup);

  function cleanup() {
    try {
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
    } catch (e) {}
    if (wrapper.parentElement) document.body.removeChild(wrapper);
  }

  redraw();
}

/* 키보드 단축 */
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase()==='z'))) { e.preventDefault(); redo(); }
});

/* 초기 레이어 */
if (layers.length === 0) createLayer('Layer 1');
updateLayersPanel();
