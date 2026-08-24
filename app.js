"use strict";

const STORAGE_PREFIX = "web-graffiti:page:";
const CREATOR_KEY = "web-graffiti:anonymous-creator";
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = (MAX_ZOOM - MIN_ZOOM) * 0.05;
const HISTORY_LIMIT = 24;

const dom = {
  body: document.body,
  shell: document.querySelector("#surface-shell"),
  surface: document.querySelector("#site-surface"),
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

const context = dom.canvas.getContext("2d");
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
  browsingScrollY: 0,
  spaceHeld: false,
  cursorClientX: 0,
  cursorClientY: 0,
  cursorInside: false,
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

function renderStoredSpray(piece, geometry) {
  const samples = piece.samples.map((sample) => ({
    x: geometry.x + sample.nx * geometry.width,
    y: geometry.y + sample.ny * geometry.height
  }));
  const fringe = piece.fringe.map((particle) => ({
    x: geometry.x + particle.nx * geometry.width,
    y: geometry.y + particle.ny * geometry.height,
    r: particle.r
  }));

  if (piece.erasures.length === 0) {
    drawSprayMark(context, piece.color, samples, piece.size, fringe);
    return;
  }

  if (pieceCanvas.width !== dom.canvas.width || pieceCanvas.height !== dom.canvas.height) {
    pieceCanvas.width = dom.canvas.width;
    pieceCanvas.height = dom.canvas.height;
  }
  pieceContext.clearRect(0, 0, pieceCanvas.width, pieceCanvas.height);
  pieceContext.globalCompositeOperation = "source-over";
  drawSprayMark(pieceContext, piece.color, samples, piece.size, fringe);
  pieceContext.globalCompositeOperation = "destination-out";
  pieceContext.fillStyle = "#000000";
  pieceContext.beginPath();
  for (const erasure of piece.erasures) {
    const x = geometry.x + erasure.nx * geometry.width;
    const y = geometry.y + erasure.ny * geometry.height;
    pieceContext.moveTo(x + erasure.r, y);
    pieceContext.arc(x, y, erasure.r, 0, Math.PI * 2);
  }
  pieceContext.fill();
  pieceContext.globalCompositeOperation = "source-over";
  context.drawImage(pieceCanvas, 0, 0);
}

function render() {
  context.clearRect(0, 0, dom.canvas.width, dom.canvas.height);

  for (const piece of pieces) {
    const anchor = findAnchor(piece.anchorId);
    const geometry = getAnchorGeometry(anchor);
    if (!geometry || geometry.width <= 0 || geometry.height <= 0) continue;
    if (piece.samples.length > 0) {
      renderStoredSpray(piece, geometry);
    } else {
      context.fillStyle = piece.color;
      context.beginPath();
      for (const particle of piece.particles) {
        const x = geometry.x + particle.nx * geometry.width;
        const y = geometry.y + particle.ny * geometry.height;
        context.moveTo(x + particle.r, y);
        context.arc(x, y, particle.r, 0, Math.PI * 2);
      }
      context.fill();
    }
  }

  if (activeAction && activeAction.type === "spray") {
    drawSprayMark(context, activeAction.color, activeAction.samples, activeAction.size, activeAction.fringe);
  }
}

function resizeCanvas() {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    const width = Math.max(dom.surface.scrollWidth, dom.surface.clientWidth);
    const height = Math.max(dom.surface.scrollHeight, dom.surface.clientHeight);
    if (dom.canvas.width !== Math.ceil(width) || dom.canvas.height !== Math.ceil(height)) {
      dom.canvas.width = Math.ceil(width);
      dom.canvas.height = Math.ceil(height);
      dom.canvas.style.width = width + "px";
      dom.canvas.style.height = height + "px";
    }
    render();
  });
}

function clientToSurface(clientX, clientY) {
  const rect = dom.canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (dom.canvas.width / rect.width),
    y: (clientY - rect.top) * (dom.canvas.height / rect.height)
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
    state.panY = -state.browsingScrollY;
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
    applyViewportTransform();
    updateToolInterface();
    showToast("Graffiti Mode is active. Website controls are locked.");
  } else {
    const returnScrollY = Math.max(0, -state.panY / state.zoom);
    state.spaceHeld = false;
    dom.body.classList.remove("is-panning");
    dom.surface.style.transform = "";
    window.scrollTo(0, returnScrollY);
    showToast("Graffiti Mode closed. Website controls are active.");
  }
}

function activeThickness() {
  return state.tool === "eraser" ? state.eraserSize : state.spraySize;
}

function updateCursor() {
  const diameter = activeThickness() * state.zoom;
  dom.cursor.style.width = diameter + "px";
  dom.cursor.style.height = diameter + "px";
  dom.cursor.style.left = state.cursorClientX + "px";
  dom.cursor.style.top = state.cursorClientY + "px";
  dom.cursor.style.borderColor = state.tool === "spray" ? state.color : "#ffffff";
  dom.cursor.classList.toggle("is-eraser", state.tool === "eraser");
  dom.cursor.classList.toggle("is-visible", state.mode && state.cursorInside && !state.spaceHeld);
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
  updateToolInterface();
}

function emitSprayFringe(action, point, elapsed) {
  const coreRadius = action.size * 0.39;
  const outerRadius = action.size * 0.48;
  const emissionScale = Math.max(0.65, Math.min(2, elapsed / 16.67));
  const count = Math.max(1, Math.min(10, Math.round((2 + action.size / 22) * emissionScale)));
  const dotScale = 0.65 + Math.min(2, action.size * 0.018);

  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = coreRadius + Math.pow(Math.random(), 1.65) * (outerRadius - coreRadius);
    const isEdgeClump = Math.random() < 0.22;
    action.fringe.push({
      x: point.x + Math.cos(angle) * distance,
      y: point.y + Math.sin(angle) * distance,
      r: dotScale * (isEdgeClump ? 0.9 + Math.random() * 0.8 : 0.28 + Math.random() * 0.5)
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
  const spacing = Math.max(1.5, action.size * 0.08);
  const steps = Math.max(1, Math.ceil(distance / spacing));

  if (distance >= 0.5) {
    for (let step = 1; step <= steps; step += 1) {
      const amount = step / steps;
      const point = {
        x: from.x + (to.x - from.x) * amount,
        y: from.y + (to.y - from.y) * amount
      };
      action.samples.push(point);
      emitSprayFringe(action, point, elapsed / steps);
    }
  } else if (timestamp - action.lastStationaryFringe > 70) {
    emitSprayFringe(action, to, Math.min(elapsed, 16.67));
    action.lastStationaryFringe = timestamp;
  }

  action.lastEmissionPoint = { ...to };
  action.lastTimestamp = timestamp;
  render();
  sprayFrame = window.requestAnimationFrame(sprayLoop);
}

function beginSpray(event) {
  const point = clientToSurface(event.clientX, event.clientY);
  activeAction = {
    type: "spray",
    pointerId: event.pointerId,
    before: clonePieces(),
    color: state.color,
    size: state.spraySize,
    samples: [point],
    fringe: [],
    pointer: point,
    lastEmissionPoint: point,
    lastTimestamp: performance.now(),
    lastStationaryFringe: performance.now(),
    anchorChains: [getAnchorChainAt(event.clientX, event.clientY)],
    lastAnchorSample: performance.now()
  };
  emitSprayFringe(activeAction, point, 33.34);
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
      ny: (sample.y - geometry.y) / geometry.height
    })),
    fringe: action.fringe.map((particle) => ({
      nx: (particle.x - geometry.x) / geometry.width,
      ny: (particle.y - geometry.y) / geometry.height,
      r: particle.r
    })),
    erasures: [],
    particles: []
  });
  recordMutation(action.before);
}

function finishActiveAction() {
  if (!activeAction) return;
  const action = activeAction;
  activeAction = null;
  window.cancelAnimationFrame(sprayFrame);

  if (action.type === "spray") {
    finalizeSpray(action);
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
  updateCursor();

  if (!activeAction || activeAction.pointerId !== event.pointerId) return;

  if (activeAction.type === "pan") {
    moveViewportPan(event);
    return;
  }

  const point = clientToSurface(event.clientX, event.clientY);
  if (activeAction.type === "spray") {
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
  finishActiveAction();
}

function onViewportPointerDown(event) {
  const wantsPan = event.button === 1 || (event.button === 0 && state.spaceHeld);
  if (!state.mode || event.target !== dom.shell || !wantsPan) return;
  event.preventDefault();
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
  if (!state.mode) return;

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
  if (!state.mode) return;
  clampViewportPan();
  dom.surface.style.transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.zoom})`;
  updateCursor();
}

function setZoom(nextZoom, clientX = window.innerWidth / 2, clientY = window.innerHeight / 2) {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(nextZoom * 20) / 20));
  if (next === state.zoom) {
    syncZoomControl();
    showZoomFeedback();
    return;
  }

  const oldZoom = state.zoom;
  const localX = (clientX - state.panX) / oldZoom;
  const localY = (clientY - state.panY) / oldZoom;
  state.zoom = next;
  state.panX = clientX - localX * next;
  state.panY = clientY - localY * next;
  applyViewportTransform();
  syncZoomControl();
  showZoomFeedback();
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
  updateCursor();
});
dom.canvas.addEventListener("pointerleave", () => {
  if (!activeAction) {
    state.cursorInside = false;
    updateCursor();
  }
});
window.addEventListener("wheel", (event) => {
  if (!state.mode) return;
  event.preventDefault();

  if (event.ctrlKey || event.metaKey) {
    setZoom(state.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), event.clientX, event.clientY);
    return;
  }

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
