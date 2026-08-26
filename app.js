"use strict";

const STORAGE_PREFIX = "web-graffiti:page:";
const CREATOR_KEY = "web-graffiti:anonymous-creator";
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = (MAX_ZOOM - MIN_ZOOM) * 0.05;
const HISTORY_LIMIT = 24;
const TILE_SIZE = 512;
const TILE_OVERSCAN = 1;
const ZOOM_RASTER_SETTLE_MS = 150;
const VALVE_OPEN_MS = 135;
const VALVE_RELEASE_MS = 65;
const QUICK_RELEASE_MS = 190;
const CURSOR_RELEASE_RECOVERY_MS = 1000;
const CURSOR_FULL_SPEED = 1.65;
const CURSOR_SPRING_STIFFNESS = 82;
const CURSOR_SPRING_DAMPING = 10.5;
const CURSOR_STRETCH = 0.36;
const CURSOR_SQUASH = 0.18;
const CURSOR_ORGANIC_REACH = 23;
const CURSOR_PHASE_BASE_SPEED = 4.2;
const CURSOR_PHASE_MOTION_SPEED = 10.5;

const dom = {
  body: document.body,
  shell: document.querySelector("#surface-shell"),
  surface: document.querySelector("#site-surface"),
  tiles: document.querySelector("#graffiti-tiles"),
  activePaint: document.querySelector("#graffiti-active-paint"),
  canvas: document.querySelector("#graffiti-canvas"),
  launch: document.querySelector("#graffiti-launch"),
  controls: document.querySelector("#graffiti-controls"),
  closeMode: document.querySelector("#close-mode"),
  sprayTool: document.querySelector("#spray-tool"),
  eraserTool: document.querySelector("#eraser-tool"),
  thicknessSlider: document.querySelector("#thickness-slider"),
  thicknessTool: document.querySelector("#thickness-tool"),
  thicknessValue: document.querySelector("#thickness-value"),
  undo: document.querySelector("#undo-button"),
  redo: document.querySelector("#redo-button"),
  zoomControls: document.querySelector(".zoom-controls"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomOut: document.querySelector("#zoom-out"),
  zoomReset: document.querySelector("#zoom-reset"),
  zoomSlider: document.querySelector("#zoom-slider"),
  zoomSliderWrap: document.querySelector("#zoom-slider-wrap"),
  zoomValue: document.querySelector("#zoom-value"),
  cursor: document.querySelector("#brush-cursor"),
  prototypeToggle: document.querySelector("#prototype-toggle"),
  prototypePanel: document.querySelector("#prototype-panel"),
  reset: document.querySelector("#reset-prototype"),
  toast: document.querySelector("#toast"),
  colorPicker: document.querySelector("#color-picker"),
  customColorButton: document.querySelector("#custom-color-button"),
  customColorPreview: document.querySelector("#custom-color-preview"),
  pickerClose: document.querySelector("#picker-close"),
  svField: document.querySelector("#sv-field"),
  svHandle: document.querySelector("#sv-handle"),
  hueInput: document.querySelector("#hue-input"),
  hexInput: document.querySelector("#hex-input"),
  redInput: document.querySelector("#red-input"),
  greenInput: document.querySelector("#green-input"),
  blueInput: document.querySelector("#blue-input"),
  previousColor: document.querySelector("#previous-color"),
  currentColor: document.querySelector("#current-color"),
  subscribe: document.querySelector("#subscribe-button"),
  bookmark: document.querySelector("#bookmark-button")
};

const pieceCanvas = document.createElement("canvas");
const pieceContext = pieceCanvas.getContext("2d");

let creatorId = getOrCreateCreatorId();
let currentPageKey = getPageKey();
let pieces = loadPieces();
let undoStack = [];
let redoStack = [];
let activeAction = null;
let sprayFrame = 0;
let toastTimer = 0;
let resizeFrame = 0;
let zoomFeedbackTimer = 0;
let zoomRasterTimer = 0;
let cursorAnimationFrame = 0;
let canvasCssWidth = 0;
let canvasCssHeight = 0;
let canvasRenderScale = 1;
const tileCache = new Map();

const state = {
  mode: false,
  tool: "spray",
  color: "#111111",
  customColor: "#111111",
  spraySize: 36,
  eraserSize: 48,
  zoom: 1,
  panX: 0,
  panY: 0,
  viewportTransformActive: false,
  browsingScrollY: 0,
  spaceHeld: false,
  cursorClientX: 0,
  cursorClientY: 0,
  cursorInside: false,
  cursorVelocity: 0,
  cursorVelocityX: 0,
  cursorVelocityY: 0,
  cursorLastSample: null,
  cursorReleaseStartedAt: 0,
  cursorFluidAmount: 0,
  cursorFluidVelocity: 0,
  cursorFluidAngle: 0,
  cursorFluidPhase: 0,
  cursorLastFrameAt: 0,
  hsv: { h: 0, s: 0, v: 6.7 },
  previousPickerColor: "#111111"
};

function getPageKey() {
  return STORAGE_PREFIX + window.location.href;
}

function createId(prefix) {
  const value = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
  return prefix + "-" + value;
}

function getOrCreateCreatorId() {
  let id = localStorage.getItem(CREATOR_KEY);
  if (!id) {
    id = createId("creator");
    localStorage.setItem(CREATOR_KEY, id);
  }
  return id;
}

function isStoredParticle(value) {
  return value && Number.isFinite(value.nx) && Number.isFinite(value.ny) && Number.isFinite(value.r);
}

function isStoredSample(value) {
  return value && Number.isFinite(value.nx) && Number.isFinite(value.ny);
}

function isStoredErasure(value) {
  return isStoredSample(value) && Number.isFinite(value.r);
}

function loadPieces() {
  try {
    const parsed = JSON.parse(localStorage.getItem(currentPageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((piece) => piece && typeof piece.anchorId === "string")
      .map((piece) => ({
        id: typeof piece.id === "string" ? piece.id : createId("piece"),
        creatorId: typeof piece.creatorId === "string" ? piece.creatorId : creatorId,
        anchorId: piece.anchorId,
        color: /^#[0-9a-f]{6}$/i.test(piece.color || "") ? piece.color : "#111111",
        size: Number.isFinite(piece.size) ? Math.max(8, Math.min(140, piece.size)) : 36,
        samples: Array.isArray(piece.samples) ? piece.samples.filter(isStoredSample) : [],
        fringe: Array.isArray(piece.fringe) ? piece.fringe.filter(isStoredParticle) : [],
        erasures: Array.isArray(piece.erasures) ? piece.erasures.filter(isStoredErasure) : [],
        particles: Array.isArray(piece.particles) ? piece.particles.filter(isStoredParticle) : []
      }))
      .filter((piece) => piece.samples.length > 0 || piece.particles.length > 0);
  } catch (error) {
    console.warn("Stored graffiti could not be read.", error);
    return [];
  }
}

function persistPieces() {
  try {
    localStorage.setItem(currentPageKey, JSON.stringify(pieces));
  } catch (error) {
    showToast("Browser storage is full. Reset some prototype data.");
    console.warn("Graffiti could not be saved.", error);
  }
}

function clonePieces(value = pieces) {
  return value.map((piece) => ({
    id: piece.id,
    creatorId: piece.creatorId,
    anchorId: piece.anchorId,
    color: piece.color,
    size: piece.size,
    samples: (piece.samples || []).map((sample) => ({ ...sample })),
    fringe: (piece.fringe || []).map((particle) => ({ ...particle })),
    erasures: (piece.erasures || []).map((erasure) => ({ ...erasure })),
    particles: (piece.particles || []).map((particle) => ({ ...particle }))
  }));
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 2200);
}

function findAnchor(anchorId) {
  const safeId = window.CSS && CSS.escape ? CSS.escape(anchorId) : anchorId.replace(/["\\]/g, "\\$&");
  return dom.surface.querySelector('[data-graffiti-anchor="' + safeId + '"]');
}

function getAnchorGeometry(anchor) {
  if (!anchor) return null;
  const surfaceRect = dom.surface.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  return {
    x: (anchorRect.left - surfaceRect.left) / state.zoom,
    y: (anchorRect.top - surfaceRect.top) / state.zoom,
    width: anchorRect.width / state.zoom,
    height: anchorRect.height / state.zoom
  };
}

function particleToSurface(piece, particle) {
  const geometry = getAnchorGeometry(findAnchor(piece.anchorId));
  if (!geometry || geometry.width <= 0 || geometry.height <= 0) return null;
  return {
    x: geometry.x + particle.nx * geometry.width,
    y: geometry.y + particle.ny * geometry.height,
    r: particle.r
  };
}

function drawSprayMark(targetContext, color, samples, size, fringe) {
  if (samples.length === 0) return;

  const hasVariableFlow = samples.some((sample) => Number.isFinite(sample.flow));
  if (hasVariableFlow) {
    drawVariableSprayMark(targetContext, color, samples, size, fringe);
    return;
  }

  const coreWidth = Math.max(1, size * 0.78);
  targetContext.fillStyle = color;
  targetContext.strokeStyle = color;
  targetContext.lineCap = "round";
  targetContext.lineJoin = "round";
  targetContext.lineWidth = coreWidth;

  if (samples.length === 1) {
    targetContext.beginPath();
    targetContext.arc(samples[0].x, samples[0].y, coreWidth / 2, 0, Math.PI * 2);
    targetContext.fill();
  } else {
    targetContext.beginPath();
    targetContext.moveTo(samples[0].x, samples[0].y);
    for (let index = 1; index < samples.length; index += 1) {
      targetContext.lineTo(samples[index].x, samples[index].y);
    }
    targetContext.stroke();
  }

  targetContext.beginPath();
  for (const particle of fringe) {
    targetContext.moveTo(particle.x + particle.r, particle.y);
    targetContext.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
  }
  targetContext.fill();
}

function drawVariableSprayMark(targetContext, color, samples, size, fringe) {
  const coreRadius = size * 0.39;
  targetContext.save();
  targetContext.fillStyle = color;

  const stamp = (point, flow, coverage) => {
    const normalizedFlow = Math.max(0.08, Math.min(1, flow));
    const radius = Math.max(0.55, coreRadius * (0.22 + normalizedFlow * 0.78));
    const alpha = 0.08 + Math.max(0.12, Math.min(1, coverage)) * normalizedFlow * 0.27;
    targetContext.globalAlpha = alpha;
    targetContext.beginPath();
    targetContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
    targetContext.fill();
  };

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const flow = Number.isFinite(sample.flow) ? sample.flow : 1;
    const coverage = Number.isFinite(sample.coverage) ? sample.coverage : 1;
    const previous = samples[index - 1];
    if (!previous) {
      stamp(sample, flow, coverage);
      continue;
    }
    const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y);
    const spacing = Math.max(1, coreRadius * 0.34);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const amount = step / steps;
      stamp({ x: previous.x + (sample.x - previous.x) * amount, y: previous.y + (sample.y - previous.y) * amount }, flow, coverage);
    }
  }

  for (const particle of fringe) {
    targetContext.globalAlpha = Number.isFinite(particle.alpha) ? particle.alpha : 1;
    targetContext.beginPath();
    targetContext.moveTo(particle.x + particle.r, particle.y);
    targetContext.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
    targetContext.fill();
  }
  targetContext.restore();
}

function boundsFromPoints(samples, fringe, padding) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of [...samples, ...fringe]) {
    const radius = point.r || 0;
    left = Math.min(left, point.x - radius);
    top = Math.min(top, point.y - radius);
    right = Math.max(right, point.x + radius);
    bottom = Math.max(bottom, point.y + radius);
  }
  return left === Infinity ? null : { left: left - padding, top: top - padding, right: right + padding, bottom: bottom + padding };
}

function overlapsTile(bounds, tile) {
  return bounds && bounds.right >= tile.x && bounds.left <= tile.x + TILE_SIZE && bounds.bottom >= tile.y && bounds.top <= tile.y + TILE_SIZE;
}

function getRenderablePieces() {
  const geometryByAnchor = new Map();
  const resolveGeometry = (anchorId) => {
    if (!geometryByAnchor.has(anchorId)) geometryByAnchor.set(anchorId, getAnchorGeometry(findAnchor(anchorId)));
    return geometryByAnchor.get(anchorId);
  };

  return pieces.map((piece) => {
    const geometry = resolveGeometry(piece.anchorId);
    if (!geometry || geometry.width <= 0 || geometry.height <= 0) return null;
    const samples = piece.samples.map((sample) => ({ ...sample, x: geometry.x + sample.nx * geometry.width, y: geometry.y + sample.ny * geometry.height }));
    const fringe = piece.fringe.map((particle) => ({ ...particle, x: geometry.x + particle.nx * geometry.width, y: geometry.y + particle.ny * geometry.height, r: particle.r }));
    const particles = piece.particles.map((particle) => ({ x: geometry.x + particle.nx * geometry.width, y: geometry.y + particle.ny * geometry.height, r: particle.r }));
    const erasures = piece.erasures.map((erasure) => ({ x: geometry.x + erasure.nx * geometry.width, y: geometry.y + erasure.ny * geometry.height, r: erasure.r }));
    return { piece, samples, fringe, particles, erasures, bounds: boundsFromPoints(samples.length ? samples : particles, fringe, piece.size * 0.5) };
  }).filter(Boolean);
}

function getVisibleTiles() {
  const surfaceRect = dom.surface.getBoundingClientRect();
  const left = Math.max(0, (0 - surfaceRect.left) / state.zoom);
  const top = Math.max(0, (0 - surfaceRect.top) / state.zoom);
  const right = Math.min(canvasCssWidth, (window.innerWidth - surfaceRect.left) / state.zoom);
  const bottom = Math.min(canvasCssHeight, (window.innerHeight - surfaceRect.top) / state.zoom);
  const maxX = Math.max(0, Math.ceil(canvasCssWidth / TILE_SIZE) - 1);
  const maxY = Math.max(0, Math.ceil(canvasCssHeight / TILE_SIZE) - 1);
  const startX = Math.max(0, Math.floor(left / TILE_SIZE) - TILE_OVERSCAN);
  const startY = Math.max(0, Math.floor(top / TILE_SIZE) - TILE_OVERSCAN);
  const endX = Math.min(maxX, Math.floor(right / TILE_SIZE) + TILE_OVERSCAN);
  const endY = Math.min(maxY, Math.floor(bottom / TILE_SIZE) + TILE_OVERSCAN);
  const tiles = [];
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) tiles.push({ x: x * TILE_SIZE, y: y * TILE_SIZE, key: `${x}:${y}` });
  }
  return tiles;
}

function getTile(tile) {
  let canvas = tileCache.get(tile.key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "graffiti-tile";
    dom.tiles.append(canvas);
    tileCache.set(tile.key, canvas);
  }
  const pixelSize = Math.ceil(TILE_SIZE * canvasRenderScale);
  if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
    canvas.width = pixelSize;
    canvas.height = pixelSize;
  }
  canvas.style.left = tile.x + "px";
  canvas.style.top = tile.y + "px";
  canvas.style.width = TILE_SIZE + "px";
  canvas.style.height = TILE_SIZE + "px";
  return canvas;
}

function drawRenderablePiece(targetContext, rendered) {
  const { piece, samples, fringe, particles, erasures } = rendered;
  if (samples.length === 0) {
    targetContext.fillStyle = piece.color;
    targetContext.beginPath();
    for (const particle of particles) {
      targetContext.moveTo(particle.x + particle.r, particle.y);
      targetContext.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
    }
    targetContext.fill();
    return;
  }
  if (erasures.length === 0) {
    drawSprayMark(targetContext, piece.color, samples, piece.size, fringe);
    return;
  }
  drawSprayMark(targetContext, piece.color, samples, piece.size, fringe);
  targetContext.globalCompositeOperation = "destination-out";
  targetContext.beginPath();
  for (const erasure of erasures) {
    targetContext.moveTo(erasure.x + erasure.r, erasure.y);
    targetContext.arc(erasure.x, erasure.y, erasure.r, 0, Math.PI * 2);
  }
  targetContext.fill();
  targetContext.globalCompositeOperation = "source-over";
}

function renderTile(tile, renderedPieces) {
  const canvas = getTile(tile);
  const tileContext = canvas.getContext("2d");
  tileContext.setTransform(1, 0, 0, 1, 0, 0);
  tileContext.clearRect(0, 0, canvas.width, canvas.height);
  const setTileTransform = (target) => target.setTransform(canvasRenderScale, 0, 0, canvasRenderScale, -tile.x * canvasRenderScale, -tile.y * canvasRenderScale);
  setTileTransform(tileContext);
  for (const rendered of renderedPieces) {
    if (!overlapsTile(rendered.bounds, tile)) continue;
    if (rendered.erasures.length === 0) {
      drawRenderablePiece(tileContext, rendered);
      continue;
    }
    if (pieceCanvas.width !== canvas.width || pieceCanvas.height !== canvas.height) {
      pieceCanvas.width = canvas.width;
      pieceCanvas.height = canvas.height;
    }
    pieceContext.setTransform(1, 0, 0, 1, 0, 0);
    pieceContext.clearRect(0, 0, pieceCanvas.width, pieceCanvas.height);
    setTileTransform(pieceContext);
    drawRenderablePiece(pieceContext, rendered);
    tileContext.setTransform(1, 0, 0, 1, 0, 0);
    tileContext.drawImage(pieceCanvas, 0, 0);
    setTileTransform(tileContext);
  }
}

function clearActivePaint() {
  dom.activePaint.style.display = "none";
  dom.activePaint.width = 0;
  dom.activePaint.height = 0;
}

function renderActivePaint() {
  if (!activeAction || activeAction.type !== "spray") {
    clearActivePaint();
    return;
  }

  const bounds = boundsFromPoints(activeAction.samples, activeAction.fringe, activeAction.size * 0.5);
  if (!bounds) {
    clearActivePaint();
    return;
  }

  const padding = 2;
  const left = Math.max(0, Math.floor(bounds.left - padding));
  const top = Math.max(0, Math.floor(bounds.top - padding));
  const right = Math.min(canvasCssWidth, Math.ceil(bounds.right + padding));
  const bottom = Math.min(canvasCssHeight, Math.ceil(bounds.bottom + padding));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const pixelWidth = Math.ceil(width * canvasRenderScale);
  const pixelHeight = Math.ceil(height * canvasRenderScale);

  if (dom.activePaint.width !== pixelWidth || dom.activePaint.height !== pixelHeight) {
    dom.activePaint.width = pixelWidth;
    dom.activePaint.height = pixelHeight;
  }
  dom.activePaint.style.left = left + "px";
  dom.activePaint.style.top = top + "px";
  dom.activePaint.style.width = width + "px";
  dom.activePaint.style.height = height + "px";
  dom.activePaint.style.display = "block";

  const context = dom.activePaint.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  context.setTransform(canvasRenderScale, 0, 0, canvasRenderScale, -left * canvasRenderScale, -top * canvasRenderScale);
  drawSprayMark(context, activeAction.color, activeAction.samples, activeAction.size, activeAction.fringe);
}

function render() {
  if (!canvasCssWidth || !canvasCssHeight) return;
  const renderedPieces = getRenderablePieces();
  const hasActiveSpray = Boolean(activeAction && activeAction.type === "spray");

  if (renderedPieces.length === 0) {
    for (const [, canvas] of tileCache) canvas.remove();
    tileCache.clear();
    if (hasActiveSpray) renderActivePaint();
    else clearActivePaint();
    return;
  }

  const visibleTiles = getVisibleTiles();
  const requiredKeys = new Set(visibleTiles.map((tile) => tile.key));
  for (const [key, canvas] of tileCache) {
    if (!requiredKeys.has(key)) {
      canvas.remove();
      tileCache.delete(key);
    }
  }
  for (const tile of visibleTiles) renderTile(tile, renderedPieces);
  renderActivePaint();
}

function resizeCanvas() {
  window.clearTimeout(zoomRasterTimer);
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    const width = Math.max(dom.surface.scrollWidth, dom.surface.clientWidth);
    const height = Math.max(dom.surface.scrollHeight, dom.surface.clientHeight);
    canvasCssWidth = width;
    canvasCssHeight = height;
    canvasRenderScale = window.devicePixelRatio * state.zoom;
    // This transparent canvas only captures pointer input; paint is held in visible tiles.
    // Keep its backing buffer tiny so opening a long page does not allocate a full-page bitmap.
    dom.canvas.width = 1;
    dom.canvas.height = 1;
    dom.canvas.style.width = width + "px";
    dom.canvas.style.height = height + "px";
    render();
  });
}

function refreshZoomRaster() {
  window.clearTimeout(zoomRasterTimer);
  canvasRenderScale = window.devicePixelRatio * state.zoom;
  render();
}

function scheduleZoomRasterRefresh() {
  window.clearTimeout(zoomRasterTimer);
  zoomRasterTimer = window.setTimeout(refreshZoomRaster, ZOOM_RASTER_SETTLE_MS);
}

function clientToSurface(clientX, clientY) {
  const rect = dom.canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvasCssWidth / rect.width),
    y: (clientY - rect.top) * (canvasCssHeight / rect.height)
  };
}

function getAnchorChainAt(clientX, clientY) {
  const elements = document.elementsFromPoint(clientX, clientY);
  let target = null;

  for (const element of elements) {
    if (element === dom.canvas) continue;
    if (dom.surface.contains(element)) {
      target = element;
      break;
    }
  }

  if (!target) return ["page-root"];

  const chain = [];
  let anchor = target.closest("[data-graffiti-anchor]");
  while (anchor && dom.surface.contains(anchor)) {
    const id = anchor.dataset.graffitiAnchor;
    if (id && !chain.includes(id)) chain.push(id);
    const parent = anchor.parentElement;
    anchor = parent ? parent.closest("[data-graffiti-anchor]") : null;
  }

  if (!chain.includes("page-root")) chain.push("page-root");
  return chain;
}

function chooseCommonAnchor(chains) {
  if (!chains.length) return "page-root";
  return chains[0].find((id) => chains.every((chain) => chain.includes(id))) || "page-root";
}

function updateHistoryButtons() {
  dom.undo.disabled = undoStack.length === 0;
  dom.redo.disabled = redoStack.length === 0;
}

function recordMutation(before) {
  undoStack.push(before);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
  persistPieces();
}

function undo() {
  if (!state.mode || undoStack.length === 0 || activeAction) return;
  redoStack.push(clonePieces());
  pieces = undoStack.pop();
  updateHistoryButtons();
  persistPieces();
  render();
}

function redo() {
  if (!state.mode || redoStack.length === 0 || activeAction) return;
  undoStack.push(clonePieces());
  pieces = redoStack.pop();
  updateHistoryButtons();
  persistPieces();
  render();
}

function setMode(enabled) {
  if (enabled === state.mode) return;
  if (!enabled) finishActiveAction();

  if (enabled) {
    state.browsingScrollY = window.scrollY;
    state.panX = 0;
    state.panY = 0;
    state.viewportTransformActive = false;
  }

  state.mode = enabled;
  dom.body.classList.toggle("graffiti-mode", enabled);
  dom.launch.hidden = enabled;
  dom.controls.hidden = !enabled;
  dom.colorPicker.hidden = true;
  dom.customColorButton.setAttribute("aria-expanded", "false");
  dom.cursor.classList.remove("is-visible");

  undoStack = [];
  redoStack = [];
  updateHistoryButtons();

  if (enabled) {
    if (state.zoom !== MIN_ZOOM) activateViewportTransform();
    updateToolInterface();
    showToast("Graffiti Mode is active. Website controls are locked.");
  } else {
    const returnScrollY = state.viewportTransformActive
      ? Math.max(0, -state.panY / state.zoom)
      : window.scrollY;
    state.spaceHeld = false;
    dom.body.classList.remove("graffiti-viewport", "is-panning");
    dom.surface.style.transform = "";
    state.viewportTransformActive = false;
    window.scrollTo(0, returnScrollY);
    showToast("Graffiti Mode closed. Website controls are active.");
  }
}

function activeThickness() {
  return state.tool === "eraser" ? state.eraserSize : state.spraySize;
}

function recordCursorMotion(clientX, clientY, timestamp = performance.now()) {
  const previous = state.cursorLastSample;
  if (previous) {
    const elapsed = Math.max(1, timestamp - previous.timestamp);
    const velocityX = (clientX - previous.x) / elapsed;
    const velocityY = (clientY - previous.y) / elapsed;
    const speed = Math.hypot(velocityX, velocityY);
    state.cursorVelocity = state.cursorVelocity * 0.62 + speed * 0.38;
    state.cursorVelocityX = state.cursorVelocityX * 0.62 + velocityX * 0.38;
    state.cursorVelocityY = state.cursorVelocityY * 0.62 + velocityY * 0.38;
  }
  state.cursorLastSample = { x: clientX, y: clientY, timestamp };
  requestCursorAnimation();
}

function cursorRecoveryProgress(timestamp = performance.now()) {
  if (!state.cursorReleaseStartedAt) return null;
  const progress = Math.min(1, (timestamp - state.cursorReleaseStartedAt) / CURSOR_RELEASE_RECOVERY_MS);
  if (progress >= 1) state.cursorReleaseStartedAt = 0;
  return progress;
}

function cursorBlobRadius(fluidAmount) {
  if (fluidAmount < 0.002) return "50%";
  const phase = state.cursorFluidPhase;
  const reach = Math.min(1, fluidAmount) * CURSOR_ORGANIC_REACH;
  const topLeft = 50 + Math.sin(phase) * reach;
  const topRight = 50 + Math.sin(phase + 1.7) * reach * 0.82;
  const bottomRight = 50 + Math.sin(phase + 3.5) * reach * 0.72;
  const bottomLeft = 50 + Math.sin(phase + 5.1) * reach * 0.9;
  const verticalTopLeft = 50 + Math.cos(phase + 0.4) * reach * 0.72;
  const verticalTopRight = 50 + Math.cos(phase + 2.2) * reach;
  const verticalBottomRight = 50 + Math.cos(phase + 4.1) * reach * 0.78;
  const verticalBottomLeft = 50 + Math.cos(phase + 5.6) * reach * 0.86;

  return `${topLeft}% ${topRight}% ${bottomRight}% ${bottomLeft}% / ${verticalTopLeft}% ${verticalTopRight}% ${verticalBottomRight}% ${verticalBottomLeft}%`;
}

function updateCursor() {
  const recovery = cursorRecoveryProgress();
  const velocityRatio = Math.min(1, state.cursorVelocity / CURSOR_FULL_SPEED);
  const movingScale = 1 - velocityRatio * 0.34;
  const recoveryScale = recovery === null ? null : 0.26 + recovery * 0.74;
  const cursorScale = state.tool === "eraser" ? 1 : (recoveryScale === null ? movingScale : recoveryScale);
  const density = state.tool === "eraser" ? 0 : (recovery === null
    ? 0.06 + velocityRatio * 0.44
    : 0.5 * (1 - recovery));
  const diameter = activeThickness() * state.zoom * cursorScale;
  dom.cursor.style.width = diameter + "px";
  dom.cursor.style.height = diameter + "px";
  dom.cursor.style.left = state.cursorClientX + "px";
  dom.cursor.style.top = state.cursorClientY + "px";
  dom.cursor.style.borderColor = state.tool === "spray" ? state.color : "#ffffff";
  dom.cursor.style.color = state.tool === "spray" ? state.color : "#ffffff";
  dom.cursor.style.setProperty("--cursor-density", String(density));
  const fluidAmount = state.tool === "eraser" ? 0 : Math.min(1.15, Math.abs(state.cursorFluidAmount));
  dom.cursor.style.setProperty("--cursor-angle", state.cursorFluidAngle + "rad");
  dom.cursor.style.setProperty("--cursor-stretch", String(1 + fluidAmount * CURSOR_STRETCH));
  dom.cursor.style.setProperty("--cursor-squash", String(Math.max(0.55, 1 - fluidAmount * CURSOR_SQUASH)));
  dom.cursor.style.borderRadius = cursorBlobRadius(fluidAmount);
  dom.cursor.classList.toggle("is-eraser", state.tool === "eraser");
  dom.cursor.classList.toggle("is-visible", state.mode && state.cursorInside && !state.spaceHeld);
}

function animateCursorFluid(timestamp) {
  cursorAnimationFrame = 0;
  const previousFrameAt = state.cursorLastFrameAt || timestamp;
  const elapsed = Math.min(32, Math.max(1, timestamp - previousFrameAt)) / 1000;
  state.cursorLastFrameAt = timestamp;

  const lastMotionAt = state.cursorLastSample?.timestamp || 0;
  if (timestamp - lastMotionAt > 24) {
    const decay = Math.exp(-elapsed * 7.5);
    state.cursorVelocity *= decay;
    state.cursorVelocityX *= decay;
    state.cursorVelocityY *= decay;
  }

  const velocityRatio = Math.min(1, state.cursorVelocity / CURSOR_FULL_SPEED);
  const springTarget = state.tool === "eraser" ? 0 : velocityRatio;
  const springAcceleration = (springTarget - state.cursorFluidAmount) * CURSOR_SPRING_STIFFNESS
    - state.cursorFluidVelocity * CURSOR_SPRING_DAMPING;
  state.cursorFluidVelocity += springAcceleration * elapsed;
  state.cursorFluidAmount += state.cursorFluidVelocity * elapsed;

  if (state.cursorVelocity > 0.012) {
    const targetAngle = Math.atan2(state.cursorVelocityY, state.cursorVelocityX);
    const angleDelta = Math.atan2(
      Math.sin(targetAngle - state.cursorFluidAngle),
      Math.cos(targetAngle - state.cursorFluidAngle)
    );
    state.cursorFluidAngle += angleDelta * (1 - Math.exp(-elapsed * 11));
  }
  state.cursorFluidPhase += elapsed * (CURSOR_PHASE_BASE_SPEED + velocityRatio * CURSOR_PHASE_MOTION_SPEED);

  updateCursor();
  const cursorStillMoving = state.cursorVelocity > 0.003
    || Math.abs(state.cursorFluidAmount) > 0.002
    || Math.abs(state.cursorFluidVelocity) > 0.002
    || Boolean(state.cursorReleaseStartedAt);
  if (cursorStillMoving && state.mode && state.cursorInside) requestCursorAnimation();
}

function requestCursorAnimation() {
  if (cursorAnimationFrame) return;
  cursorAnimationFrame = window.requestAnimationFrame(animateCursorFluid);
}

function showQuickReleaseCursorFeedback() {
  state.cursorReleaseStartedAt = performance.now();
  updateCursor();
  requestCursorAnimation();
}

function updateToolInterface() {
  const erasing = state.tool === "eraser";
  dom.sprayTool.classList.toggle("is-active", !erasing);
  dom.eraserTool.classList.toggle("is-active", erasing);
  dom.sprayTool.setAttribute("aria-pressed", String(!erasing));
  dom.eraserTool.setAttribute("aria-pressed", String(erasing));
  dom.thicknessSlider.value = String(activeThickness());
  dom.thicknessSlider.setAttribute("aria-label", erasing ? "Eraser thickness" : "Spray thickness");
  dom.thicknessTool.textContent = erasing ? "Eraser thickness" : "Spray thickness";
  dom.thicknessValue.textContent = activeThickness() + " px";
  updateCursor();
}

function selectTool(tool) {
  if (activeAction) finishActiveAction();
  state.tool = tool;
  if (tool === "eraser") {
    state.cursorFluidAmount = 0;
    state.cursorFluidVelocity = 0;
  }
  updateToolInterface();
}

function valveFlowAt(action, timestamp) {
  return Math.max(0.08, Math.min(1, (timestamp - action.startedAt) / VALVE_OPEN_MS));
}

function movementCoverage(speed) {
  return Math.max(0.25, Math.min(1, 1.08 - speed / 1.7));
}

function addSpraySample(action, point, timestamp, flow = valveFlowAt(action, timestamp)) {
  action.samples.push({
    x: point.x,
    y: point.y,
    flow,
    coverage: movementCoverage(action.pointerSpeed),
    t: timestamp - action.startedAt
  });
}

function emitSprayFringe(action, point, elapsed, flow = 1, direction = null) {
  const normalizedFlow = Math.max(0.08, Math.min(1, flow));
  const emissionScale = Math.max(0.65, Math.min(2, elapsed / 16.67));
  const count = Math.max(1, Math.min(10, Math.round((2 + action.size / 22) * emissionScale * normalizedFlow)));
  const dotScale = 0.65 + Math.min(2, action.size * 0.018);
  const coverage = movementCoverage(action.pointerSpeed);
  const particleAlpha = Math.max(0.08, normalizedFlow * (0.22 + coverage * 0.78));
  // Use the fully opened core radius, rather than the current flow radius:
  // later samples may expand over earlier low-flow marks. This keeps every
  // particle outside the eventual paint body as the valve opens.
  const coreRadius = action.size * 0.39;
  const tangent = direction && Math.hypot(direction.x, direction.y) > 0.01
    ? Math.atan2(direction.y, direction.x)
    : null;

  for (let index = 0; index < count; index += 1) {
    const isEdgeClump = Math.random() < 0.22;
    const radius = dotScale * normalizedFlow * (isEdgeClump ? 0.9 + Math.random() * 0.8 : 0.28 + Math.random() * 0.5);
    const side = Math.random() < 0.5 ? -1 : 1;
    const angle = tangent === null
      ? Math.random() * Math.PI * 2
      : tangent + side * (Math.PI / 2);
    const distance = coreRadius + radius + action.size * (0.025 + Math.pow(Math.random(), 1.7) * 0.115);
    action.fringe.push({
      x: point.x + Math.cos(angle) * distance,
      y: point.y + Math.sin(angle) * distance,
      r: radius,
      alpha: particleAlpha * (0.72 + Math.random() * 0.28)
    });
  }
}

function sprayLoop(timestamp) {
  if (!activeAction || activeAction.type !== "spray") return;

  const action = activeAction;
  const elapsed = Math.max(8, Math.min(40, timestamp - action.lastTimestamp || 16.67));
  const from = action.lastEmissionPoint;
  const to = action.pointer;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const direction = distance >= 0.5 ? { x: to.x - from.x, y: to.y - from.y } : action.lastSprayDirection;
  const spacing = Math.max(1.5, action.size * 0.08);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const flow = valveFlowAt(action, timestamp);

  if (distance >= 0.5) {
    for (let step = 1; step <= steps; step += 1) {
      const amount = step / steps;
      const point = {
        x: from.x + (to.x - from.x) * amount,
        y: from.y + (to.y - from.y) * amount
      };
      addSpraySample(action, point, timestamp, flow);
      emitSprayFringe(action, point, elapsed / steps, flow, direction);
    }
  } else {
    addSpraySample(action, to, timestamp, flow);
    if (timestamp - action.lastStationaryFringe > 70) {
      emitSprayFringe(action, to, Math.min(elapsed, 16.67), flow, direction);
      action.lastStationaryFringe = timestamp;
    }
  }

  action.lastEmissionPoint = { ...to };
  if (distance >= 0.5) action.lastSprayDirection = direction;
  action.lastTimestamp = timestamp;
  renderActivePaint();
  sprayFrame = window.requestAnimationFrame(sprayLoop);
}

function beginSpray(event) {
  const point = clientToSurface(event.clientX, event.clientY);
  const startedAt = performance.now();
  activeAction = {
    type: "spray",
    pointerId: event.pointerId,
    before: clonePieces(),
    color: state.color,
    size: state.spraySize,
    samples: [],
    fringe: [],
    pointer: point,
    lastEmissionPoint: point,
    lastSprayDirection: null,
    lastTimestamp: startedAt,
    lastStationaryFringe: startedAt,
    startedAt,
    pointerSpeed: 0,
    lastPointerSample: { point, timestamp: startedAt },
    anchorChains: [getAnchorChainAt(event.clientX, event.clientY)],
    lastAnchorSample: performance.now()
  };
  addSpraySample(activeAction, point, startedAt, 0.08);
  emitSprayFringe(activeAction, point, 33.34, 0.08);
  sprayFrame = window.requestAnimationFrame(sprayLoop);
}

function pointToSegmentDistance(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const amount = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + dx * amount), point.y - (from.y + dy * amount));
}

function sprayIntersectsEraser(piece, geometry, point, radius) {
  const samples = piece.samples.map((sample) => ({
    x: geometry.x + sample.nx * geometry.width,
    y: geometry.y + sample.ny * geometry.height
  }));
  const hitRadius = radius + piece.size * 0.39;

  if (samples.length === 1 && Math.hypot(point.x - samples[0].x, point.y - samples[0].y) <= hitRadius) return true;
  for (let index = 1; index < samples.length; index += 1) {
    if (pointToSegmentDistance(point, samples[index - 1], samples[index]) <= hitRadius) return true;
  }
  return piece.fringe.some((particle) => {
    const x = geometry.x + particle.nx * geometry.width;
    const y = geometry.y + particle.ny * geometry.height;
    return Math.hypot(point.x - x, point.y - y) <= radius + particle.r;
  });
}

function eraseAt(point) {
  const radius = state.eraserSize / 2;
  let changed = false;
  const nextPieces = [];

  for (const piece of pieces) {
    if (piece.creatorId !== creatorId) {
      nextPieces.push(piece);
      continue;
    }

    const geometry = getAnchorGeometry(findAnchor(piece.anchorId));
    if (!geometry) {
      nextPieces.push(piece);
      continue;
    }

    if (piece.samples.length > 0) {
      if (sprayIntersectsEraser(piece, geometry, point, radius)) {
        changed = true;
        nextPieces.push({
          ...piece,
          erasures: [...piece.erasures, {
            nx: (point.x - geometry.x) / geometry.width,
            ny: (point.y - geometry.y) / geometry.height,
            r: radius
          }]
        });
      } else {
        nextPieces.push(piece);
      }
    } else {
      const remaining = piece.particles.filter((particle) => {
        const x = geometry.x + particle.nx * geometry.width;
        const y = geometry.y + particle.ny * geometry.height;
        const keep = Math.hypot(x - point.x, y - point.y) > radius + particle.r;
        if (!keep) changed = true;
        return keep;
      });

      if (remaining.length > 0) nextPieces.push({ ...piece, particles: remaining });
    }
  }

  pieces = nextPieces;
  return changed;
}

function eraseAlong(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const spacing = Math.max(3, state.eraserSize * 0.18);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  let changed = false;

  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    changed = eraseAt({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount
    }) || changed;
  }
  return changed;
}

function beginEraser(event) {
  const point = clientToSurface(event.clientX, event.clientY);
  activeAction = {
    type: "eraser",
    pointerId: event.pointerId,
    before: clonePieces(),
    lastPoint: point,
    changed: eraseAt(point)
  };
  render();
}

function beginPan(event) {
  activeAction = {
    type: "pan",
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY
  };
  dom.body.classList.add("is-panning");
  dom.cursor.classList.remove("is-visible");
}

function moveViewportPan(event) {
  state.panX += event.clientX - activeAction.clientX;
  state.panY += event.clientY - activeAction.clientY;
  activeAction.clientX = event.clientX;
  activeAction.clientY = event.clientY;
  applyViewportTransform();
}

function finalizeSpray(action) {
  if (action.samples.length === 0) return;
  const anchorId = chooseCommonAnchor(action.anchorChains);
  const geometry = getAnchorGeometry(findAnchor(anchorId));
  if (!geometry || geometry.width <= 0 || geometry.height <= 0) return;

  pieces.push({
    id: createId("piece"),
    creatorId,
    anchorId,
    color: action.color,
    size: action.size,
    samples: action.samples.map((sample) => ({
      nx: (sample.x - geometry.x) / geometry.width,
      ny: (sample.y - geometry.y) / geometry.height,
      flow: sample.flow,
      coverage: sample.coverage
    })),
    fringe: action.fringe.map((particle) => ({
      nx: (particle.x - geometry.x) / geometry.width,
      ny: (particle.y - geometry.y) / geometry.height,
      r: particle.r,
      alpha: particle.alpha
    })),
    erasures: [],
    particles: []
  });
  recordMutation(action.before);
}

function applySprayRelease(action, releasedAt) {
  const releaseStart = Math.max(0, releasedAt - action.startedAt - VALVE_RELEASE_MS);
  for (const sample of action.samples) {
    if (!Number.isFinite(sample.t) || sample.t < releaseStart) continue;
    const progress = Math.min(1, (sample.t - releaseStart) / VALVE_RELEASE_MS);
    sample.flow *= 1 - progress * 0.86;
  }
}

function finishActiveAction(showReleaseFeedback = false) {
  if (!activeAction) return;
  const action = activeAction;
  activeAction = null;
  window.cancelAnimationFrame(sprayFrame);

  if (action.type === "spray") {
    const releasedAt = performance.now();
    applySprayRelease(action, releasedAt);
    finalizeSpray(action);
    if (showReleaseFeedback && releasedAt - action.startedAt <= QUICK_RELEASE_MS) showQuickReleaseCursorFeedback();
  } else if (action.type === "eraser" && action.changed) {
    recordMutation(action.before);
  } else if (action.type === "pan") {
    dom.body.classList.remove("is-panning");
  }

  render();
}

function onCanvasPointerDown(event) {
  if (!state.mode || (event.button !== 0 && event.button !== 1)) return;
  event.preventDefault();
  recordCursorMotion(event.clientX, event.clientY);
  dom.canvas.setPointerCapture(event.pointerId);

  if (state.spaceHeld || event.button === 1) {
    beginPan(event);
  } else if (state.tool === "eraser") {
    beginEraser(event);
  } else {
    beginSpray(event);
  }
}

function onCanvasPointerMove(event) {
  state.cursorClientX = event.clientX;
  state.cursorClientY = event.clientY;
  recordCursorMotion(event.clientX, event.clientY);
  updateCursor();

  if (!activeAction || activeAction.pointerId !== event.pointerId) return;

  if (activeAction.type === "pan") {
    moveViewportPan(event);
    return;
  }

  const point = clientToSurface(event.clientX, event.clientY);
  if (activeAction.type === "spray") {
    const now = performance.now();
    const previous = activeAction.lastPointerSample;
    const elapsed = Math.max(1, now - previous.timestamp);
    const speed = Math.hypot(point.x - previous.point.x, point.y - previous.point.y) / elapsed;
    activeAction.pointerSpeed = activeAction.pointerSpeed * 0.55 + speed * 0.45;
    activeAction.lastPointerSample = { point, timestamp: now };
    activeAction.pointer = point;
    if (performance.now() - activeAction.lastAnchorSample > 45) {
      activeAction.anchorChains.push(getAnchorChainAt(event.clientX, event.clientY));
      activeAction.lastAnchorSample = performance.now();
    }
  } else if (activeAction.type === "eraser") {
    activeAction.changed = eraseAlong(activeAction.lastPoint, point) || activeAction.changed;
    activeAction.lastPoint = point;
    render();
  }
}

function onCanvasPointerUp(event) {
  if (!activeAction || activeAction.pointerId !== event.pointerId) return;
  if (dom.canvas.hasPointerCapture(event.pointerId)) dom.canvas.releasePointerCapture(event.pointerId);
  finishActiveAction(event.type === "pointerup");
}

function onViewportPointerDown(event) {
  const wantsPan = event.button === 1 || (event.button === 0 && state.spaceHeld);
  if (!state.mode || event.target !== dom.shell || !wantsPan) return;
  event.preventDefault();
  activateViewportTransform();
  dom.shell.setPointerCapture(event.pointerId);
  beginPan(event);
}

function onViewportPointerMove(event) {
  if (!activeAction || activeAction.type !== "pan" || activeAction.pointerId !== event.pointerId) return;
  if (!dom.shell.hasPointerCapture(event.pointerId)) return;
  moveViewportPan(event);
}

function onViewportPointerUp(event) {
  if (!activeAction || activeAction.type !== "pan" || activeAction.pointerId !== event.pointerId) return;
  if (!dom.shell.hasPointerCapture(event.pointerId)) return;
  dom.shell.releasePointerCapture(event.pointerId);
  finishActiveAction();
}

function syncZoomControl() {
  const normalized = (state.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
  const percentage = Math.round(normalized * 100);
  dom.zoomSlider.value = String(percentage);
  dom.zoomSlider.setAttribute("aria-valuetext", percentage + "%");
  dom.zoomSlider.style.setProperty("--zoom-fill", normalized * 100 + "%");
  dom.zoomSliderWrap.style.setProperty("--zoom-thumb-top", (1 - normalized) * 70 + "px");
  dom.zoomValue.value = percentage + "%";
  dom.zoomValue.textContent = dom.zoomValue.value;
  dom.zoomIn.disabled = state.zoom >= MAX_ZOOM;
  dom.zoomOut.disabled = state.zoom <= MIN_ZOOM;
}

function showZoomFeedback() {
  window.clearTimeout(zoomFeedbackTimer);
  dom.zoomControls?.classList.add("show-readout");
  zoomFeedbackTimer = window.setTimeout(() => {
    dom.zoomControls?.classList.remove("show-readout");
  }, 900);
}

function clampViewportPan() {
  if (!state.mode || !state.viewportTransformActive) return;

  const scaledWidth = dom.surface.scrollWidth * state.zoom;
  const scaledHeight = dom.surface.scrollHeight * state.zoom;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (scaledWidth <= viewportWidth) {
    state.panX = (viewportWidth - scaledWidth) / 2;
  } else {
    state.panX = Math.max(viewportWidth - scaledWidth, Math.min(0, state.panX));
  }

  if (scaledHeight <= viewportHeight) {
    state.panY = (viewportHeight - scaledHeight) / 2;
  } else {
    state.panY = Math.max(viewportHeight - scaledHeight, Math.min(0, state.panY));
  }
}

function applyViewportTransform() {
  if (!state.mode || !state.viewportTransformActive) return;
  clampViewportPan();
  dom.surface.style.transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.zoom})`;
  updateCursor();
}

function activateViewportTransform() {
  if (!state.mode || state.viewportTransformActive) return;
  const scrollY = window.scrollY;
  state.panX = 0;
  state.panY = -scrollY * state.zoom;
  state.viewportTransformActive = true;
  dom.body.classList.add("graffiti-viewport");
  window.scrollTo(0, 0);
  applyViewportTransform();
}

function setZoom(nextZoom, clientX = window.innerWidth / 2, clientY = window.innerHeight / 2) {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(nextZoom * 20) / 20));
  if (next === state.zoom) {
    syncZoomControl();
    showZoomFeedback();
    return;
  }

  activateViewportTransform();
  const oldZoom = state.zoom;
  const localX = (clientX - state.panX) / oldZoom;
  const localY = (clientY - state.panY) / oldZoom;
  state.zoom = next;
  state.panX = clientX - localX * next;
  state.panY = clientY - localY * next;
  applyViewportTransform();
  syncZoomControl();
  showZoomFeedback();
  scheduleZoomRasterRefresh();
}

function percentageToZoom(percentage) {
  return MIN_ZOOM + (Math.max(0, Math.min(100, percentage)) / 100) * (MAX_ZOOM - MIN_ZOOM);
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function componentToHex(value) {
  return clampChannel(value).toString(16).padStart(2, "0");
}

function rgbToHex(red, green, blue) {
  return "#" + componentToHex(red) + componentToHex(green) + componentToHex(blue);
}

function hexToRgb(hex) {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function rgbToHsv(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }

  if (hue < 0) hue += 360;
  return {
    h: hue,
    s: max === 0 ? 0 : (delta / max) * 100,
    v: max * 100
  };
}

function hsvToRgb(hue, saturation, value) {
  const h = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const v = value / 100;
  const chroma = v * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (segment < 1) [r, g, b] = [chroma, x, 0];
  else if (segment < 2) [r, g, b] = [x, chroma, 0];
  else if (segment < 3) [r, g, b] = [0, chroma, x];
  else if (segment < 4) [r, g, b] = [0, x, chroma];
  else if (segment < 5) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  const match = v - chroma;
  return {
    r: Math.round((r + match) * 255),
    g: Math.round((g + match) * 255),
    b: Math.round((b + match) * 255)
  };
}

function markSelectedColor(hex, isCustom = false) {
  document.querySelectorAll(".color-swatch").forEach((swatch) => {
    const selected = !isCustom && swatch.dataset.color.toLowerCase() === hex.toLowerCase();
    swatch.classList.toggle("is-selected", selected);
    swatch.setAttribute("aria-pressed", String(selected));
  });
  dom.customColorButton.classList.toggle("is-selected", isCustom);
}

function syncColorInputs(rgb) {
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  dom.hexInput.value = hex.toUpperCase();
  dom.redInput.value = String(rgb.r);
  dom.greenInput.value = String(rgb.g);
  dom.blueInput.value = String(rgb.b);
  dom.currentColor.style.background = hex;
  dom.customColorPreview.style.background = hex;
  dom.svField.style.setProperty("--picker-hue", String(state.hsv.h));
  dom.svHandle.style.left = state.hsv.s + "%";
  dom.svHandle.style.top = 100 - state.hsv.v + "%";
  dom.hueInput.value = String(Math.round(state.hsv.h));
}

function applyCustomColor(hex, updateHsv = true) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const normalized = rgbToHex(rgb.r, rgb.g, rgb.b);
  state.color = normalized;
  state.customColor = normalized;
  if (updateHsv) state.hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  syncColorInputs(rgb);
  markSelectedColor(normalized, true);
  selectTool("spray");
  return true;
}

function applyHsvColor() {
  const rgb = hsvToRgb(state.hsv.h, state.hsv.s, state.hsv.v);
  applyCustomColor(rgbToHex(rgb.r, rgb.g, rgb.b), false);
}

function openColorPicker() {
  state.previousPickerColor = state.color;
  dom.previousColor.style.background = state.previousPickerColor;
  const rgb = hexToRgb(state.customColor) || { r: 17, g: 17, b: 17 };
  state.hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  applyCustomColor(state.customColor, false);
  dom.colorPicker.hidden = false;
  dom.customColorButton.setAttribute("aria-expanded", "true");
}

function closeColorPicker() {
  dom.colorPicker.hidden = true;
  dom.customColorButton.setAttribute("aria-expanded", "false");
}

function updateSaturationBrightness(event) {
  const rect = dom.svField.getBoundingClientRect();
  state.hsv.s = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
  state.hsv.v = Math.max(0, Math.min(100, (1 - (event.clientY - rect.top) / rect.height) * 100));
  applyHsvColor();
}

function handleSaturationPointerDown(event) {
  event.preventDefault();
  dom.svField.setPointerCapture(event.pointerId);
  updateSaturationBrightness(event);

  const move = (moveEvent) => updateSaturationBrightness(moveEvent);
  const end = (endEvent) => {
    if (dom.svField.hasPointerCapture(endEvent.pointerId)) dom.svField.releasePointerCapture(endEvent.pointerId);
    dom.svField.removeEventListener("pointermove", move);
    dom.svField.removeEventListener("pointerup", end);
    dom.svField.removeEventListener("pointercancel", end);
  };

  dom.svField.addEventListener("pointermove", move);
  dom.svField.addEventListener("pointerup", end);
  dom.svField.addEventListener("pointercancel", end);
}

function resetPrototypeData() {
  if (!window.confirm("Remove all locally stored graffiti and reset the anonymous prototype identity?")) return;

  const keysToRemove = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith(STORAGE_PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem(CREATOR_KEY);

  creatorId = getOrCreateCreatorId();
  currentPageKey = getPageKey();
  pieces = [];
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
  render();
  dom.prototypePanel.hidden = true;
  dom.prototypeToggle.setAttribute("aria-expanded", "false");
  showToast("Prototype data reset.");
}

dom.launch.addEventListener("click", () => setMode(true));
dom.closeMode.addEventListener("click", () => setMode(false));
dom.sprayTool.addEventListener("click", () => selectTool("spray"));
dom.eraserTool.addEventListener("click", () => selectTool("eraser"));

dom.thicknessSlider.addEventListener("input", () => {
  const value = Number(dom.thicknessSlider.value);
  if (state.tool === "eraser") state.eraserSize = value;
  else state.spraySize = value;
  updateToolInterface();
});

document.querySelectorAll(".color-swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => {
    state.color = swatch.dataset.color;
    markSelectedColor(state.color, false);
    selectTool("spray");
    closeColorPicker();
  });
});

dom.customColorButton.addEventListener("click", () => {
  if (dom.colorPicker.hidden) openColorPicker();
  else closeColorPicker();
});
dom.pickerClose.addEventListener("click", closeColorPicker);
dom.svField.addEventListener("pointerdown", handleSaturationPointerDown);
dom.svField.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 5 : 1;
  if (event.key === "ArrowLeft") state.hsv.s -= step;
  else if (event.key === "ArrowRight") state.hsv.s += step;
  else if (event.key === "ArrowUp") state.hsv.v += step;
  else if (event.key === "ArrowDown") state.hsv.v -= step;
  else return;
  event.preventDefault();
  state.hsv.s = Math.max(0, Math.min(100, state.hsv.s));
  state.hsv.v = Math.max(0, Math.min(100, state.hsv.v));
  applyHsvColor();
});

dom.hueInput.addEventListener("input", () => {
  state.hsv.h = Number(dom.hueInput.value);
  applyHsvColor();
});

dom.hexInput.addEventListener("input", () => {
  const value = dom.hexInput.value.startsWith("#") ? dom.hexInput.value : "#" + dom.hexInput.value;
  if (/^#[0-9a-f]{6}$/i.test(value)) applyCustomColor(value);
});

[dom.redInput, dom.greenInput, dom.blueInput].forEach((input) => {
  input.addEventListener("input", () => {
    const rgb = {
      r: clampChannel(dom.redInput.value),
      g: clampChannel(dom.greenInput.value),
      b: clampChannel(dom.blueInput.value)
    };
    applyCustomColor(rgbToHex(rgb.r, rgb.g, rgb.b));
  });
});

dom.undo.addEventListener("click", undo);
dom.redo.addEventListener("click", redo);
dom.zoomIn.addEventListener("click", () => setZoom(state.zoom + ZOOM_STEP));
dom.zoomOut.addEventListener("click", () => setZoom(state.zoom - ZOOM_STEP));
dom.zoomReset.addEventListener("click", () => setZoom(MIN_ZOOM));
dom.zoomSlider.addEventListener("input", (event) => setZoom(percentageToZoom(Number(event.currentTarget.value))));
dom.zoomSlider.addEventListener("change", refreshZoomRaster);
dom.zoomSlider.addEventListener("pointerdown", showZoomFeedback);

dom.canvas.addEventListener("pointerdown", onCanvasPointerDown);
dom.canvas.addEventListener("pointermove", onCanvasPointerMove);
dom.canvas.addEventListener("pointerup", onCanvasPointerUp);
dom.canvas.addEventListener("pointercancel", onCanvasPointerUp);
dom.canvas.addEventListener("auxclick", (event) => event.preventDefault());
dom.canvas.addEventListener("pointerenter", (event) => {
  state.cursorInside = true;
  state.cursorClientX = event.clientX;
  state.cursorClientY = event.clientY;
  state.cursorLastSample = { x: event.clientX, y: event.clientY, timestamp: performance.now() };
  state.cursorVelocity = 0;
  state.cursorVelocityX = 0;
  state.cursorVelocityY = 0;
  state.cursorFluidAmount = 0;
  state.cursorFluidVelocity = 0;
  updateCursor();
});
dom.canvas.addEventListener("pointerleave", () => {
  if (!activeAction) {
    state.cursorInside = false;
    state.cursorLastSample = null;
    updateCursor();
  }
});
window.addEventListener("wheel", (event) => {
  if (!state.mode) return;

  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    setZoom(state.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), event.clientX, event.clientY);
    return;
  }

  event.preventDefault();
  activateViewportTransform();

  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? window.innerHeight
      : 1;
  const horizontalDelta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
  const verticalDelta = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
  state.panX -= horizontalDelta * unit;
  state.panY -= verticalDelta * unit;
  applyViewportTransform();
}, { passive: false });

dom.shell.addEventListener("pointerdown", onViewportPointerDown);
dom.shell.addEventListener("pointermove", onViewportPointerMove);
dom.shell.addEventListener("pointerup", onViewportPointerUp);
dom.shell.addEventListener("pointercancel", onViewportPointerUp);
dom.shell.addEventListener("auxclick", (event) => event.preventDefault());

dom.prototypeToggle.addEventListener("click", () => {
  const open = dom.prototypePanel.hidden;
  dom.prototypePanel.hidden = !open;
  dom.prototypeToggle.setAttribute("aria-expanded", String(open));
});
dom.reset.addEventListener("click", resetPrototypeData);

dom.subscribe.addEventListener("click", () => showToast("Thanks — this sample button works outside Graffiti Mode."));
dom.bookmark.addEventListener("click", () => {
  const pressed = dom.bookmark.getAttribute("aria-pressed") === "true";
  dom.bookmark.setAttribute("aria-pressed", String(!pressed));
  dom.bookmark.textContent = pressed ? "Save for later" : "Saved";
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;

  if (event.key === "Escape" && state.mode) {
    event.preventDefault();
    setMode(false);
    return;
  }

  if (!state.mode || editingText) return;

  if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "0") setZoom(MIN_ZOOM);
    else setZoom(state.zoom + (event.key === "-" ? -ZOOM_STEP : ZOOM_STEP));
    return;
  }

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    activateViewportTransform();
    const panStep = event.shiftKey ? 160 : 64;
    if (event.key === "ArrowUp") state.panY += panStep;
    else if (event.key === "ArrowDown") state.panY -= panStep;
    else if (event.key === "ArrowLeft") state.panX += panStep;
    else state.panX -= panStep;
    applyViewportTransform();
    return;
  }

  if (event.code === "Space") {
    state.spaceHeld = true;
    dom.cursor.classList.remove("is-visible");
    event.preventDefault();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code !== "Space") return;
  state.spaceHeld = false;
  if (activeAction && activeAction.type === "pan") finishActiveAction();
  updateCursor();
});

window.addEventListener("blur", () => {
  state.spaceHeld = false;
  finishActiveAction();
  updateCursor();
});

window.addEventListener("hashchange", () => {
  persistPieces();
  currentPageKey = getPageKey();
  pieces = loadPieces();
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
  render();
  showToast("Loaded graffiti for this exact URL.");
});

window.addEventListener("beforeunload", persistPieces);
window.addEventListener("resize", () => {
  resizeCanvas();
  applyViewportTransform();
});
window.addEventListener("scroll", () => {
  if (!state.mode || !state.viewportTransformActive) render();
}, { passive: true });

if (window.ResizeObserver) {
  const surfaceObserver = new ResizeObserver(resizeCanvas);
  surfaceObserver.observe(dom.surface);
}

syncZoomControl();
dom.previousColor.style.background = state.color;
applyCustomColor(state.customColor);
markSelectedColor("#111111", false);
updateToolInterface();
updateHistoryButtons();
resizeCanvas();
