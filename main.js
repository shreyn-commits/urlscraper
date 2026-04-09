import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const INITIAL_ROWS = 30;
const INITIAL_COLS = 12;

const state = {
  sheets: [createSheet("Sheet 1", INITIAL_ROWS, INITIAL_COLS)],
  activeSheetId: "",
  selection: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
  status: "Ready.",
  providers: {
    openai: createProviderState(),
    claude: createProviderState()
  },
  slashMenus: {
    prompt: createSlashMenuState(),
    conditionPrompt: createSlashMenuState()
  },
  aiModal: {
    open: false,
    mode: "create",
    columnIndex: null,
    insertAt: null
  },
  jsonViewer: {
    open: false,
    title: "",
    raw: "",
    parsed: null,
    row: null,
    col: null
  },
  auth: {
    loading: true,
    firebaseConfig: null,
    ready: false,
    user: null,
    settings: null
  },
  firebase: {
    app: null,
    auth: null,
    db: null,
    provider: null
  }
};

state.activeSheetId = state.sheets[0].id;

const els = {
  sheet: document.getElementById("sheet"),
  sheetTabs: document.getElementById("sheetTabs"),
  csvFile: document.getElementById("csvFile"),
  exportBtn: document.getElementById("exportBtn"),
  addRowBtn: document.getElementById("addRowBtn"),
  addColBtn: document.getElementById("addColBtn"),
  addAiColumnBtn: document.getElementById("addAiColumnBtn"),
  deleteRowBtn: document.getElementById("deleteRowBtn"),
  deleteColBtn: document.getElementById("deleteColBtn"),
  newSheetBtn: document.getElementById("newSheetBtn"),
  renameSheetBtn: document.getElementById("renameSheetBtn"),
  selectionSummary: document.getElementById("selectionSummary"),
  activeCellName: document.getElementById("activeCellName"),
  formulaInput: document.getElementById("formulaInput"),
  provider: document.getElementById("provider"),
  modelSelect: document.getElementById("modelSelect"),
  refreshModelsBtn: document.getElementById("refreshModelsBtn"),
  modelHelp: document.getElementById("modelHelp"),
  apiKey: document.getElementById("apiKey"),
  aiColumnName: document.getElementById("aiColumnName"),
  prompt: document.getElementById("prompt"),
  outputFields: document.getElementById("outputFields"),
  conditionPrompt: document.getElementById("conditionPrompt"),
  promptSlashMenu: document.getElementById("promptSlashMenu"),
  conditionSlashMenu: document.getElementById("conditionSlashMenu"),
  runSelectedRowBtn: document.getElementById("runSelectedRowBtn"),
  runAiBtn: document.getElementById("runAiBtn"),
  status: document.getElementById("status"),
  sheetMeta: document.getElementById("sheetMeta"),
  aiColumnModal: document.getElementById("aiColumnModal"),
  aiColumnModalTitle: document.getElementById("aiColumnModalTitle"),
  closeAiModalBtn: document.getElementById("closeAiModalBtn"),
  cancelAiModalBtn: document.getElementById("cancelAiModalBtn"),
  saveAiColumnBtn: document.getElementById("saveAiColumnBtn"),
  jsonViewerModal: document.getElementById("jsonViewerModal"),
  jsonViewerTitle: document.getElementById("jsonViewerTitle"),
  jsonViewerBody: document.getElementById("jsonViewerBody"),
  closeJsonViewerBtn: document.getElementById("closeJsonViewerBtn"),
  copyJsonBtn: document.getElementById("copyJsonBtn"),
  createColumnsFromJsonBtn: document.getElementById("createColumnsFromJsonBtn"),
  authOverlay: document.getElementById("authOverlay"),
  googleSignInBtn: document.getElementById("googleSignInBtn"),
  authNote: document.getElementById("authNote"),
  signOutBtn: document.getElementById("signOutBtn"),
  userChip: document.getElementById("userChip")
};

function createProviderState() {
  return {
    apiKey: "",
    modelOptions: [],
    selectedModel: "",
    modelHelp: "Enter an API key to load models.",
    loading: false
  };
}

function createDefaultUserSettings(email = "") {
  return {
    email,
    displayName: "",
    picture: "",
    env: {
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: ""
    },
    providerApiKeys: {
      openai: "",
      claude: ""
    },
    providerModels: {
      openai: "",
      claude: ""
    }
  };
}

function normalizeUserSettings(settings = {}, user = null) {
  const defaults = createDefaultUserSettings(user?.email || settings.email || "");
  return {
    ...defaults,
    ...settings,
    env: {
      ...defaults.env,
      ...(settings.env || {})
    },
    providerApiKeys: {
      ...defaults.providerApiKeys,
      ...(settings.providerApiKeys || {})
    },
    providerModels: {
      ...defaults.providerModels,
      ...(settings.providerModels || {})
    }
  };
}

function applyUserSettings(user, settings) {
  const normalized = normalizeUserSettings(settings, user);
  state.auth.user = user;
  state.auth.settings = normalized;
  state.providers.openai.apiKey = normalized.providerApiKeys.openai || normalized.env.OPENAI_API_KEY || "";
  state.providers.claude.apiKey = normalized.providerApiKeys.claude || normalized.env.ANTHROPIC_API_KEY || "";
  state.providers.openai.selectedModel = normalized.providerModels.openai || "";
  state.providers.claude.selectedModel = normalized.providerModels.claude || "";
  els.userChip.textContent = user ? `${user.name || user.email}` : "";
  els.userChip.classList.toggle("hidden", !user);
}

async function loadUserSettings(user) {
  if (!state.firebase.db || !user?.uid) {
    return normalizeUserSettings({}, user);
  }

  const ref = doc(state.firebase.db, "users", user.uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    const defaults = normalizeUserSettings({}, user);
    await setDoc(
      ref,
      {
        ...defaults,
        email: user.email || "",
        displayName: user.name || user.email || "",
        picture: user.picture || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
    return defaults;
  }

  return normalizeUserSettings(snapshot.data(), user);
}

async function persistUserSettings() {
  if (!state.firebase.db || !state.auth.user?.uid || !state.auth.settings) return;
  const ref = doc(state.firebase.db, "users", state.auth.user.uid);
  await setDoc(
    ref,
    {
      ...state.auth.settings,
      email: state.auth.user.email || state.auth.settings.email || "",
      displayName: state.auth.user.name || state.auth.settings.displayName || "",
      picture: state.auth.user.picture || state.auth.settings.picture || "",
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

function saveUserSettings() {
  void persistUserSettings().catch(() => {});
}

function createSlashMenuState() {
  return {
    visible: false,
    items: [],
    selectedIndex: 0,
    triggerStart: 0,
    cursorEnd: 0
  };
}

function createSheet(name, rows, cols) {
  return {
    id: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => "")),
    aiColumns: {},
    columnLabels: {},
    aiResults: {}
  };
}

function getActiveSheet() {
  return state.sheets.find((sheet) => sheet.id === state.activeSheetId) || state.sheets[0];
}

function getProviderState(provider = els.provider.value) {
  return state.providers[provider];
}

function setProviderApiKey(provider, apiKey) {
  const providerState = getProviderState(provider);
  providerState.apiKey = apiKey;
  if (state.auth.settings) {
    state.auth.settings.providerApiKeys[provider] = apiKey;
    const envKey = getProviderEnvKey(provider);
    if (envKey) state.auth.settings.env[envKey] = apiKey;
    saveUserSettings();
  }
}

function setProviderModel(provider, model) {
  const providerState = getProviderState(provider);
  providerState.selectedModel = model;
  if (state.auth.settings) {
    state.auth.settings.providerModels[provider] = model;
    saveUserSettings();
  }
}

function getProviderEnvKey(provider) {
  return provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}

function parseOutputFieldNames(text) {
  return String(text || "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function normalizeAiColumns(sheet) {
  if (!sheet.aiColumns) sheet.aiColumns = {};
  return sheet.aiColumns;
}

function normalizeSheetMetadata(sheet) {
  if (!sheet.columnLabels) sheet.columnLabels = {};
  if (!sheet.aiResults) sheet.aiResults = {};
  return sheet;
}

function shiftIndexMap(indexMap, insertedAt) {
  const next = {};
  for (const [rawCol, value] of Object.entries(indexMap || {})) {
    const col = Number(rawCol);
    next[col >= insertedAt ? col + 1 : col] = value;
  }
  return next;
}

function shiftIndexMapForDelete(indexMap, startCol, endCol) {
  const width = endCol - startCol + 1;
  const next = {};
  for (const [rawCol, value] of Object.entries(indexMap || {})) {
    const col = Number(rawCol);
    if (col < startCol) next[col] = value;
    if (col > endCol) next[col - width] = value;
  }
  return next;
}

function shiftAiResultKeysOnRowInsert(sheet, insertedAt) {
  const next = {};
  for (const [key, value] of Object.entries(sheet.aiResults || {})) {
    const [rowText, colText] = key.split(":");
    const row = Number(rowText);
    const col = Number(colText);
    const nextRow = row >= insertedAt ? row + 1 : row;
    next[`${nextRow}:${col}`] = value;
  }
  sheet.aiResults = next;
}

function shiftAiResultKeysOnRowDelete(sheet, startRow, endRow) {
  const width = endRow - startRow + 1;
  const next = {};
  for (const [key, value] of Object.entries(sheet.aiResults || {})) {
    const [rowText, colText] = key.split(":");
    const row = Number(rowText);
    const col = Number(colText);
    if (row < startRow) next[`${row}:${col}`] = value;
    if (row > endRow) next[`${row - width}:${col}`] = value;
  }
  sheet.aiResults = next;
}

function shiftAiResultKeysOnColInsert(sheet, insertedAt) {
  const next = {};
  for (const [key, value] of Object.entries(sheet.aiResults || {})) {
    const [rowText, colText] = key.split(":");
    const row = Number(rowText);
    const col = Number(colText);
    const nextCol = col >= insertedAt ? col + 1 : col;
    next[`${row}:${nextCol}`] = value;
  }
  sheet.aiResults = next;
}

function shiftAiResultKeysOnColDelete(sheet, startCol, endCol) {
  const width = endCol - startCol + 1;
  const next = {};
  for (const [key, value] of Object.entries(sheet.aiResults || {})) {
    const [rowText, colText] = key.split(":");
    const row = Number(rowText);
    const col = Number(colText);
    if (col < startCol) next[`${row}:${col}`] = value;
    if (col > endCol) next[`${row}:${col - width}`] = value;
  }
  sheet.aiResults = next;
}

function shiftAiColumnsOnInsert(sheet, insertedAt) {
  const normalized = normalizeAiColumns(sheet);
  const next = {};
  for (const [rawCol, config] of Object.entries(normalized)) {
    const col = Number(rawCol);
    next[col >= insertedAt ? col + 1 : col] = config;
  }
  sheet.aiColumns = next;
  sheet.columnLabels = shiftIndexMap(sheet.columnLabels, insertedAt);
  for (const config of Object.values(sheet.aiColumns)) {
    if (config.outputColumns) {
      config.outputColumns = shiftIndexMap(config.outputColumns, insertedAt);
    }
  }
}

function shiftAiColumnsOnDelete(sheet, startCol, endCol) {
  const width = endCol - startCol + 1;
  const normalized = normalizeAiColumns(sheet);
  const next = {};
  for (const [rawCol, config] of Object.entries(normalized)) {
    const col = Number(rawCol);
    if (col < startCol) next[col] = config;
    if (col > endCol) next[col - width] = config;
  }
  sheet.aiColumns = next;
  sheet.columnLabels = shiftIndexMapForDelete(sheet.columnLabels, startCol, endCol);
  for (const config of Object.values(sheet.aiColumns)) {
    if (config.outputColumns) {
      config.outputColumns = shiftIndexMapForDelete(config.outputColumns, startCol, endCol);
    }
  }
}

function getSelectionBounds() {
  const { startRow, startCol, endRow, endCol } = state.selection;
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol)
  };
}

function setStatus(message) {
  state.status = message;
  els.status.textContent = message;
}

function columnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function columnIndexFromLabel(label) {
  let index = 0;
  for (const char of label.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function ensureSize(sheet, minRows, minCols) {
  while (sheet.cells.length < minRows) {
    sheet.cells.push(Array.from({ length: Math.max(sheet.cells[0]?.length || 0, minCols) }, () => ""));
  }

  const currentCols = sheet.cells[0]?.length || 0;
  if (currentCols < minCols) {
    for (const row of sheet.cells) {
      while (row.length < minCols) row.push("");
    }
  }
}

function getRawCell(sheet, row, col) {
  ensureSize(sheet, row + 1, col + 1);
  return sheet.cells[row][col] ?? "";
}

function setRawCell(sheet, row, col, value) {
  ensureSize(sheet, row + 1, col + 1);
  sheet.cells[row][col] = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripJsonFence(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function tryParseJson(text) {
  if (text && typeof text === "object") return text;
  const source = stripJsonFence(text);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function flattenJson(value, prefix = "", output = []) {
  if (Array.isArray(value)) {
    if (!value.length) {
      output.push({ path: prefix || "value", value: [] });
      return output;
    }
    value.forEach((item, index) => {
      flattenJson(item, prefix ? `${prefix}.${index}` : String(index), output);
    });
    return output;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) {
      output.push({ path: prefix || "value", value: {} });
      return output;
    }
    for (const [key, child] of entries) {
      flattenJson(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }

  output.push({ path: prefix || "value", value });
  return output;
}

function stringifyCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function summarizeJson(parsed) {
  if (!parsed || typeof parsed !== "object") return stringifyCellValue(parsed);
  const priorityKeys = ["result", "answer", "value", "output", "text", "name", "title", "decision"];
  for (const key of priorityKeys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      const candidate = parsed[key];
      if (candidate !== null && candidate !== undefined && typeof candidate !== "object") {
        return stringifyCellValue(candidate);
      }
    }
  }
  const firstLeaf = flattenJson(parsed).find((item) => item.value !== null && typeof item.value !== "object");
  return firstLeaf ? stringifyCellValue(firstLeaf.value) : JSON.stringify(parsed);
}

function formatJsonPretty(raw, parsed) {
  if (parsed && typeof parsed === "object") {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(raw ?? "");
    }
  }
  return String(raw ?? "");
}

function parseCellRef(reference) {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference.trim());
  if (!match) throw new Error("Invalid cell reference");
  return {
    col: columnIndexFromLabel(match[1]),
    row: Number(match[2]) - 1
  };
}

function getRangeValues(sheet, startRef, endRef, cache, stack) {
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef);
  const values = [];

  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++) {
    for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col++) {
      values.push(evaluateCell(sheet, row, col, cache, stack));
    }
  }

  return values;
}

function evaluateCell(sheet, row, col, cache = new Map(), stack = new Set()) {
  const key = `${row},${col}`;
  if (cache.has(key)) return cache.get(key);

  const raw = getRawCell(sheet, row, col);
  if (!raw.startsWith("=")) {
    cache.set(key, raw);
    return raw;
  }

  if (stack.has(key)) return "#CYCLE";
  stack.add(key);

  let result = "#ERROR";
  const expression = raw.slice(1).trim();

  try {
    if (/^[A-Z]+\d+$/i.test(expression)) {
      const ref = parseCellRef(expression);
      result = evaluateCell(sheet, ref.row, ref.col, cache, stack);
    } else {
      let working = expression.toUpperCase();
      working = working.replace(/(SUM|AVERAGE)\(([A-Z]+\d+):([A-Z]+\d+)\)/g, (_, fn, start, end) => {
        const values = getRangeValues(sheet, start, end, cache, stack)
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value));
        if (!values.length) return "0";
        const total = values.reduce((sum, value) => sum + value, 0);
        return fn === "AVERAGE" ? String(total / values.length) : String(total);
      });

      working = working.replace(/\b([A-Z]+\d+)\b/g, (_, refText) => {
        const ref = parseCellRef(refText);
        const value = evaluateCell(sheet, ref.row, ref.col, cache, stack);
        const num = Number(value);
        return Number.isFinite(num) ? String(num) : "0";
      });

      if (/^[0-9+\-*/().\s]+$/.test(working)) {
        const computed = Function(`"use strict"; return (${working});`)();
        result = Number.isFinite(computed) ? String(computed) : "#ERROR";
      }
    }
  } catch {
    result = "#ERROR";
  }

  stack.delete(key);
  cache.set(key, result);
  return result;
}

function getDisplayCell(sheet, row, col, cache = new Map()) {
  return evaluateCell(sheet, row, col, cache, new Set());
}

function getUsedRange(sheet) {
  let lastRow = 0;
  let lastCol = 0;
  for (let row = 0; row < sheet.cells.length; row++) {
    for (let col = 0; col < sheet.cells[row].length; col++) {
      if (String(sheet.cells[row][col] ?? "").trim() !== "") {
        lastRow = Math.max(lastRow, row);
        lastCol = Math.max(lastCol, col);
      }
    }
  }
  return { rows: lastRow + 1, cols: lastCol + 1 };
}

function getConfiguredColumnCount(sheet) {
  const aiColumns = Object.keys(normalizeAiColumns(sheet)).map(Number);
  return aiColumns.length ? Math.max(...aiColumns) + 1 : 0;
}

function getGridSize(sheet) {
  ensureSize(sheet, INITIAL_ROWS, INITIAL_COLS);
  return {
    rows: Math.max(sheet.cells.length, INITIAL_ROWS),
    cols: Math.max(sheet.cells[0]?.length || 0, INITIAL_COLS)
  };
}

function formatSelectionSummary() {
  const bounds = getSelectionBounds();
  const start = `${columnLabel(bounds.startCol)}${bounds.startRow + 1}`;
  const end = `${columnLabel(bounds.endCol)}${bounds.endRow + 1}`;
  return start === end ? `${start} selected` : `${start}:${end} selected`;
}

function getColumnDisplayName(sheet, col) {
  const aiName = normalizeAiColumns(sheet)[col]?.name?.trim();
  const firstRowValue = String(getRawCell(sheet, 0, col) ?? "").trim();
  return aiName || firstRowValue || columnLabel(col);
}

function getColumnPromptKey(sheet, col) {
  const name = getColumnDisplayName(sheet, col);
  return /[{}]/.test(name) ? columnLabel(col) : name;
}

function getAiResultKey(row, col) {
  return `${row}:${col}`;
}

function getAiCellRecord(sheet, row, col) {
  normalizeSheetMetadata(sheet);
  return sheet.aiResults[getAiResultKey(row, col)] || null;
}

function setAiCellRecord(sheet, row, col, record) {
  normalizeSheetMetadata(sheet);
  sheet.aiResults[getAiResultKey(row, col)] = record;
}

function getOutputColumnLabel(config, path) {
  return `${config.name} - ${path}`;
}

function getAiColumnEnd(sheet, aiCol) {
  const config = normalizeAiColumns(sheet)[aiCol];
  const outputColumns = Object.values(config?.outputColumns || {});
  return outputColumns.length ? Math.max(aiCol, ...outputColumns) : aiCol;
}

function ensureOutputColumn(sheet, aiCol, path, displayLabel) {
  const config = normalizeAiColumns(sheet)[aiCol];
  if (!config) return null;

  if (!config.outputColumns) config.outputColumns = {};
  if (config.outputColumns[path] !== undefined) return config.outputColumns[path];

  const insertAt = getAiColumnEnd(sheet, aiCol) + 1;
  shiftAiResultKeysOnColInsert(sheet, insertAt);
  shiftAiColumnsOnInsert(sheet, insertAt);
  for (const row of sheet.cells) {
    row.splice(insertAt, 0, "");
  }

  config.outputColumns[path] = insertAt;
  sheet.columnLabels[insertAt] = displayLabel;
  return insertAt;
}

function writeJsonOutputsToSheet(sheet, row, aiCol, config, parsed) {
  const flatEntries = flattenJson(parsed);
  const presentPaths = new Set();
  for (const entry of flatEntries) {
    const path = entry.path || "value";
    const displayLabel = getOutputColumnLabel(config, path);
    const outputCol = ensureOutputColumn(sheet, aiCol, path, displayLabel);
    if (outputCol === null) continue;
    setRawCell(sheet, row, outputCol, stringifyCellValue(entry.value));
    presentPaths.add(path);
  }

  for (const [path, outputCol] of Object.entries(config.outputColumns || {})) {
    if (!presentPaths.has(path)) {
      setRawCell(sheet, row, outputCol, "");
    }
  }
}

function makeUniqueObjectKey(target, preferred, fallback) {
  const base = String(preferred || fallback || "Column").trim() || String(fallback || "Column");
  let candidate = base;
  let index = 2;
  while (Object.prototype.hasOwnProperty.call(target, candidate)) {
    candidate = `${base} (${index})`;
    index += 1;
  }
  return candidate;
}

function getRowContextData(sheet, row) {
  const used = getUsedRange(sheet);
  const totalCols = Math.max(used.cols, getConfiguredColumnCount(sheet), state.selection.endCol + 1, 1);
  const cache = new Map();
  const columnsByLetter = {};
  const columnsByName = {};
  const jsonData = {};

  for (let col = 0; col < totalCols; col++) {
    const letter = columnLabel(col);
    const value = getDisplayCell(sheet, row, col, cache);
    const displayName = getColumnDisplayName(sheet, col);

    columnsByLetter[letter] = value;
    columnsByName[displayName.toLowerCase()] = value;
    jsonData[makeUniqueObjectKey(jsonData, displayName, letter)] = value;
  }

  return { columnsByLetter, columnsByName, jsonData };
}

function getRowPayload(sheet, row, startCol, endCol) {
  const cache = new Map();
  const payload = {};

  for (let col = startCol; col <= endCol; col++) {
    const displayName = getColumnDisplayName(sheet, col);
    const letter = columnLabel(col);
    const key = makeUniqueObjectKey(payload, displayName, letter);
    payload[key] = getDisplayCell(sheet, row, col, cache);
  }

  return JSON.stringify(payload, null, 2);
}

function buildPromptContext(sheet, row, col, currentValue) {
  const rowContext = getRowContextData(sheet, row);
  return {
    rowNumber: row + 1,
    currentColumn: columnLabel(col),
    currentValue,
    cellRef: `${columnLabel(col)}${row + 1}`,
    sheetName: sheet.name,
    rowJson: JSON.stringify(rowContext.jsonData, null, 2),
    columns: rowContext.columnsByLetter,
    namedColumns: rowContext.columnsByName
  };
}

function resolvePromptTemplate(template, context) {
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    const normalized = key.toLowerCase();

    if (normalized === "row_number") return String(context.rowNumber);
    if (normalized === "current_value") return String(context.currentValue ?? "");
    if (normalized === "current_column") return context.currentColumn;
    if (normalized === "cell_ref") return context.cellRef;
    if (normalized === "sheet_name") return context.sheetName;
    if (normalized === "row_json") return context.rowJson;

    const columnMatch = /^column:(.+)$/i.exec(key);
    if (columnMatch) {
      const lookup = columnMatch[1].trim();
      const byLetter = context.columns[lookup.toUpperCase()];
      if (byLetter !== undefined) return String(byLetter);
      const byName = context.namedColumns[lookup.toLowerCase()];
      if (byName !== undefined) return String(byName);
      return "";
    }

    return "";
  });
}

function renderModelSelect() {
  const providerState = getProviderState();
  const extraSelected =
    providerState.selectedModel && !providerState.modelOptions.some((option) => option.id === providerState.selectedModel)
      ? [{ id: providerState.selectedModel, label: `${providerState.selectedModel} (saved)` }]
      : [];
  const options = [...extraSelected, ...providerState.modelOptions];

  if (providerState.loading) {
    els.modelSelect.innerHTML = '<option value="">Loading models...</option>';
    els.modelSelect.value = "";
    els.modelHelp.textContent = providerState.modelHelp;
    return;
  }

  if (!options.length) {
    const emptyLabel = providerState.apiKey ? "No compatible models loaded yet" : "Enter an API key to load models";
    els.modelSelect.innerHTML = `<option value="">${emptyLabel}</option>`;
    els.modelSelect.value = "";
    els.modelHelp.textContent = providerState.modelHelp;
    return;
  }

  els.modelSelect.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`)
    .join("");

  const selected =
    options.find((option) => option.id === providerState.selectedModel)?.id || providerState.selectedModel || options[0].id;
  providerState.selectedModel = selected;
  els.modelSelect.value = selected;
  els.modelHelp.textContent = providerState.modelHelp;
}

function renderSlashMenu(targetId) {
  const menuState = state.slashMenus[targetId];
  const menuEl = targetId === "prompt" ? els.promptSlashMenu : els.conditionSlashMenu;

  if (!menuState.visible || !menuState.items.length || !state.aiModal.open) {
    menuEl.classList.add("hidden");
    menuEl.innerHTML = "";
    return;
  }

  menuEl.classList.remove("hidden");
  menuEl.innerHTML = menuState.items
    .map((item, index) => {
      const active = index === menuState.selectedIndex ? " active" : "";
      return `
        <button
          type="button"
          class="slash-item${active}"
          data-slash-target="${targetId}"
          data-slash-index="${index}"
        >
          <span class="slash-title">${escapeHtml(item.label)}</span>
          <span class="slash-subtitle">${escapeHtml(item.subtitle)}</span>
        </button>`;
    })
    .join("");
}

function renderTabs() {
  const activeSheet = getActiveSheet();
  els.sheetTabs.innerHTML = state.sheets
    .map((sheet) => {
      const active = sheet.id === activeSheet.id ? " active" : "";
      return `<button class="sheet-tab${active}" data-sheet-id="${sheet.id}" type="button">${escapeHtml(sheet.name)}</button>`;
    })
    .join("");
}

function renderSheet() {
  const sheet = getActiveSheet();
  normalizeAiColumns(sheet);
  normalizeSheetMetadata(sheet);
  const cache = new Map();
  const bounds = getSelectionBounds();
  const size = getGridSize(sheet);

  const headerCells = Array.from({ length: size.cols }, (_, col) => {
    const aiConfig = sheet.aiColumns[col];
    const columnLabelName = sheet.columnLabels[col];
    const classes = ["column-header"];
    if (col >= bounds.startCol && col <= bounds.endCol) classes.push("selected-header");
    if (aiConfig) classes.push("ai-column-header");
    if (columnLabelName && !aiConfig) classes.push("generated-column-header");

    const headerText = columnLabelName || aiConfig?.name || "";
    const headerInner = aiConfig
      ? `<div class="column-header-stack">
          <span class="column-header-label">${columnLabel(col)}</span>
          <button class="column-edit-btn" data-edit-ai-col="${col}" type="button">${escapeHtml(headerText)}</button>
        </div>`
      : columnLabelName
      ? `<div class="column-header-stack">
          <span class="column-header-label">${columnLabel(col)}</span>
          <span class="column-output-label">${escapeHtml(headerText)}</span>
        </div>`
      : `<div class="column-header-stack">
          <span class="column-header-label">${columnLabel(col)}</span>
        </div>`;

    return `<th class="${classes.join(" ")}" data-col-header="${col}">${headerInner}</th>`;
  }).join("");

  const bodyRows = Array.from({ length: size.rows }, (_, row) => {
    const rowClasses = ["row-header"];
    if (row >= bounds.startRow && row <= bounds.endRow) rowClasses.push("selected-header");

    const cells = Array.from({ length: size.cols }, (_, col) => {
      const raw = getRawCell(sheet, row, col);
      const display = getDisplayCell(sheet, row, col, cache);
      const aiConfig = sheet.aiColumns[col];
      const aiRecord = aiConfig ? getAiCellRecord(sheet, row, col) : null;
      const isActive = row === state.selection.endRow && col === state.selection.endCol;
      const inSelection =
        row >= bounds.startRow && row <= bounds.endRow && col >= bounds.startCol && col <= bounds.endCol;
      const classes = ["sheet-cell"];
      if (inSelection) classes.push("selected");
      if (isActive) classes.push("active");
      if (raw.startsWith("=")) classes.push("formula");
      if (aiConfig) classes.push("ai-cell");

      const value = isActive ? raw : aiRecord?.displayValue || display;
      const inputMarkup = `
        <input
          data-cell-input="true"
          data-row="${row}"
          data-col="${col}"
          value="${escapeHtml(value)}"
          spellcheck="false"
        />`;

      const content = aiConfig
        ? `<div class="ai-cell-wrap">
            <button class="ai-result-btn" data-open-json-row="${row}" data-open-json-col="${col}" type="button">${escapeHtml(
              value || "—"
            )}</button>
            <button class="cell-run-btn" data-run-ai-row="${row}" data-run-ai-col="${col}" type="button">Run</button>
          </div>`
        : inputMarkup;

      return `<td class="${classes.join(" ")}" data-cell="true" data-row="${row}" data-col="${col}">${content}</td>`;
    }).join("");

    return `<tr><th class="${rowClasses.join(" ")}" data-row-header="${row}">${row + 1}</th>${cells}</tr>`;
  }).join("");

  els.sheet.innerHTML = `<thead><tr><th class="corner-cell"></th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>`;
  els.selectionSummary.textContent = formatSelectionSummary();
  els.activeCellName.textContent = `${columnLabel(state.selection.endCol)}${state.selection.endRow + 1}`;
  els.formulaInput.value = getRawCell(sheet, state.selection.endRow, state.selection.endCol);
  els.sheetMeta.textContent = `${size.rows} rows, ${size.cols} columns, ${state.sheets.length} sheet${state.sheets.length === 1 ? "" : "s"}`;
  els.status.textContent = state.status;
  renderTabs();
}

function render() {
  renderSheet();
  els.apiKey.value = getProviderState().apiKey;
  renderModelSelect();
  renderSlashMenu("prompt");
  renderSlashMenu("conditionPrompt");
}

function focusSelectedInput() {
  const input = els.sheet.querySelector(
    `[data-cell-input="true"][data-row="${state.selection.endRow}"][data-col="${state.selection.endCol}"]`
  );
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function selectCell(row, col, extendSelection = false, focusInput = false) {
  const sheet = getActiveSheet();
  ensureSize(sheet, row + 1, col + 1);
  if (extendSelection) {
    state.selection.endRow = row;
    state.selection.endCol = col;
  } else {
    state.selection = { startRow: row, startCol: col, endRow: row, endCol: col };
  }
  render();
  if (focusInput) focusSelectedInput();
}

function selectRow(row) {
  const sheet = getActiveSheet();
  const lastCol = getGridSize(sheet).cols - 1;
  state.selection = { startRow: row, startCol: 0, endRow: row, endCol: lastCol };
  render();
}

function selectColumn(col) {
  const sheet = getActiveSheet();
  const lastRow = getGridSize(sheet).rows - 1;
  state.selection = { startRow: 0, startCol: col, endRow: lastRow, endCol: col };
  render();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((line) => line.some((value) => value !== ""));
}

function escapeCSV(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) {
    setStatus("CSV file was empty.");
    render();
    return;
  }

  const sheet = getActiveSheet();
  const maxCols = Math.max(...rows.map((row) => row.length), INITIAL_COLS);
  sheet.aiColumns = {};
  sheet.cells = Array.from({ length: Math.max(rows.length, INITIAL_ROWS) }, (_, rowIndex) =>
    Array.from({ length: maxCols }, (_, colIndex) => rows[rowIndex]?.[colIndex] ?? "")
  );
  state.selection = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
  setStatus("CSV imported into the active sheet.");
  render();
}

function exportCSV() {
  const sheet = getActiveSheet();
  const used = getUsedRange(sheet);
  const rows = [];

  for (let row = 0; row < used.rows; row++) {
    rows.push(sheet.cells[row].slice(0, used.cols).map(escapeCSV).join(","));
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sheet.name.replace(/\s+/g, "-").toLowerCase() || "sheet"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function insertRow() {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  const colCount = getGridSize(sheet).cols;
  sheet.cells.splice(bounds.endRow + 1, 0, Array.from({ length: colCount }, () => ""));
  shiftAiResultKeysOnRowInsert(sheet, bounds.endRow + 1);
  selectCell(bounds.endRow + 1, bounds.startCol);
  setStatus("Row inserted.");
}

function insertColumn() {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  const insertAt = bounds.endCol + 1;
  shiftAiResultKeysOnColInsert(sheet, insertAt);
  shiftAiColumnsOnInsert(sheet, insertAt);
  for (const row of sheet.cells) {
    row.splice(insertAt, 0, "");
  }
  selectCell(bounds.startRow, insertAt);
  setStatus("Column inserted.");
}

function deleteRow() {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  sheet.cells.splice(bounds.startRow, bounds.endRow - bounds.startRow + 1);
  shiftAiResultKeysOnRowDelete(sheet, bounds.startRow, bounds.endRow);
  if (!sheet.cells.length) {
    sheet.cells = Array.from({ length: INITIAL_ROWS }, () => Array.from({ length: INITIAL_COLS }, () => ""));
  }
  selectCell(Math.min(bounds.startRow, sheet.cells.length - 1), bounds.startCol);
  setStatus("Selected row range deleted.");
}

function deleteColumn() {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  shiftAiResultKeysOnColDelete(sheet, bounds.startCol, bounds.endCol);
  shiftAiColumnsOnDelete(sheet, bounds.startCol, bounds.endCol);
  for (const row of sheet.cells) {
    row.splice(bounds.startCol, bounds.endCol - bounds.startCol + 1);
    if (!row.length) row.push("");
  }
  selectCell(bounds.startRow, Math.min(bounds.startCol, getGridSize(sheet).cols - 1));
  setStatus("Selected column range deleted.");
}

function addSheet() {
  const sheet = createSheet(`Sheet ${state.sheets.length + 1}`, INITIAL_ROWS, INITIAL_COLS);
  state.sheets.push(sheet);
  state.activeSheetId = sheet.id;
  state.selection = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
  setStatus("New sheet created.");
  render();
}

function renameSheet() {
  const sheet = getActiveSheet();
  const nextName = window.prompt("Rename sheet", sheet.name);
  if (!nextName) return;
  sheet.name = nextName.trim() || sheet.name;
  setStatus("Sheet renamed.");
  render();
}

function getSlashItems() {
  const sheet = getActiveSheet();
  const totalCols = Math.max(getUsedRange(sheet).cols, getConfiguredColumnCount(sheet), 1);
  const helpers = [
    { label: "/current_value", subtitle: "Insert the current cell value", token: "{{current_value}}", search: "current value current_value cell" },
    { label: "/row_number", subtitle: "Insert the current row number", token: "{{row_number}}", search: "row number row_number" },
    { label: "/current_column", subtitle: "Insert the active column letter", token: "{{current_column}}", search: "current column current_column letter" },
    { label: "/cell_ref", subtitle: "Insert the current cell reference like B7", token: "{{cell_ref}}", search: "cell ref cell_ref reference" },
    { label: "/row_json", subtitle: "Insert the full current row as JSON", token: "{{row_json}}", search: "row json row_json" },
    { label: "/sheet_name", subtitle: "Insert the current sheet name", token: "{{sheet_name}}", search: "sheet name sheet_name" }
  ];

  const columns = Array.from({ length: totalCols }, (_, col) => {
    const letter = columnLabel(col);
    const displayName = getColumnDisplayName(sheet, col);
    const promptKey = getColumnPromptKey(sheet, col);
    return {
      label: `/${displayName}`,
      subtitle: displayName === letter ? `Insert column ${letter} from the current row` : `Insert ${displayName} from the current row (${letter})`,
      token: `{{column:${promptKey}}}`,
      search: `${displayName.toLowerCase()} ${letter.toLowerCase()} column`
    };
  });

  return [...helpers, ...columns];
}

function hideSlashMenu(targetId) {
  state.slashMenus[targetId] = createSlashMenuState();
  renderSlashMenu(targetId);
}

function updateSlashMenu(textarea) {
  const targetId = textarea.id;
  const beforeCursor = textarea.value.slice(0, textarea.selectionStart);
  const match = /(?:^|\s)\/([a-zA-Z0-9_ -]*)$/.exec(beforeCursor);

  if (!match) {
    hideSlashMenu(targetId);
    return;
  }

  const query = match[1].toLowerCase();
  const items = getSlashItems().filter((item) => item.search.includes(query));

  state.slashMenus[targetId] = {
    visible: items.length > 0,
    items,
    selectedIndex: 0,
    triggerStart: textarea.selectionStart - query.length - 1,
    cursorEnd: textarea.selectionStart
  };

  const otherTarget = targetId === "prompt" ? "conditionPrompt" : "prompt";
  hideSlashMenu(otherTarget);
  renderSlashMenu(targetId);
}

function insertSlashToken(targetId, index) {
  const textarea = targetId === "prompt" ? els.prompt : els.conditionPrompt;
  const menuState = state.slashMenus[targetId];
  const item = menuState.items[index];
  if (!item) return;

  const before = textarea.value.slice(0, menuState.triggerStart);
  const after = textarea.value.slice(menuState.cursorEnd);
  const nextValue = `${before}${item.token} ${after}`;
  const nextCursor = `${before}${item.token} `.length;

  textarea.value = nextValue;
  textarea.focus();
  textarea.setSelectionRange(nextCursor, nextCursor);
  hideSlashMenu(targetId);
}

function handleSlashKeydown(event) {
  const targetId = event.target.id;
  const menuState = state.slashMenus[targetId];
  if (!menuState.visible || !menuState.items.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    menuState.selectedIndex = (menuState.selectedIndex + 1) % menuState.items.length;
    renderSlashMenu(targetId);
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    menuState.selectedIndex = (menuState.selectedIndex - 1 + menuState.items.length) % menuState.items.length;
    renderSlashMenu(targetId);
  }

  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    insertSlashToken(targetId, menuState.selectedIndex);
  }

  if (event.key === "Escape") {
    event.preventDefault();
    hideSlashMenu(targetId);
  }
}

function detectProviderFromKey(apiKey) {
  if (!apiKey) return null;
  if (apiKey.startsWith("sk-ant")) return "claude";
  if (apiKey.startsWith("sk-")) return "openai";
  return null;
}

function formatProviderName(provider) {
  return provider === "claude" ? "Claude" : "OpenAI";
}

async function callAiEndpoint(payload) {
  const response = await fetch("/api/run-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function shouldRunJob({ provider, apiKey, model, conditionPrompt, job }) {
  if (!conditionPrompt) return true;

  const gatePrompt = [
    "You are deciding whether a spreadsheet automation should run.",
    "Return exactly one word: RUN or SKIP.",
    "Run the job only if the condition below is satisfied.",
    conditionPrompt
  ].join("\n\n");

  const gateText = [
    `Cell reference: ${job.context.cellRef}`,
    `Current value:\n${job.context.currentValue}`,
    `Row JSON:\n${job.context.rowJson}`,
    `Primary payload:\n${job.input}`
  ].join("\n\n");

  const data = await callAiEndpoint({
    provider,
    apiKey,
    model,
    prompt: gatePrompt,
    text: gateText
  });

  const answer = String(data.result || "").trim().toUpperCase();
  if (!answer) return true;
  if (/\bSKIP\b|\bFALSE\b|\bNO\b/.test(answer) && !/\bRUN\b|\bTRUE\b|\bYES\b/.test(answer)) {
    return false;
  }
  if (/\bRUN\b|\bTRUE\b|\bYES\b/.test(answer)) {
    return true;
  }
  return true;
}

async function loadModels() {
  const provider = els.provider.value;
  const providerState = getProviderState(provider);
  const apiKey = providerState.apiKey.trim();

  if (!apiKey) {
    providerState.modelOptions = [];
    providerState.selectedModel = "";
    providerState.modelHelp = "Enter an API key to load models.";
    providerState.loading = false;
    renderModelSelect();
    return;
  }

  providerState.loading = true;
  providerState.modelHelp = `Loading supported ${formatProviderName(provider)} models...`;
  renderModelSelect();

  try {
    const response = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load models");
    }

    providerState.modelOptions = data.models || [];
    providerState.selectedModel =
      providerState.modelOptions.find((option) => option.id === providerState.selectedModel)?.id ||
      providerState.modelOptions[0]?.id ||
      providerState.selectedModel;
    if (state.auth.settings) {
      state.auth.settings.providerModels[provider] = providerState.selectedModel;
      saveUserSettings();
    }
    providerState.modelHelp =
      data.message ||
      (providerState.modelOptions.length
        ? `Loaded ${providerState.modelOptions.length} supported ${formatProviderName(provider)} model${providerState.modelOptions.length === 1 ? "" : "s"}.`
        : "No supported models from the curated list were available for this key.");
  } catch (error) {
    providerState.modelOptions = [];
    providerState.selectedModel = "";
    providerState.modelHelp = error.message || "Unable to load models.";
  } finally {
    providerState.loading = false;
    renderModelSelect();
  }
}

function syncApiKeyIntoState() {
  const provider = els.provider.value;
  const rawValue = els.apiKey.value.trim();
  const detectedProvider = detectProviderFromKey(rawValue);

  if (detectedProvider && detectedProvider !== provider) {
    setProviderApiKey(detectedProvider, rawValue);
    els.provider.value = detectedProvider;
    els.apiKey.value = state.providers[detectedProvider].apiKey;
    renderModelSelect();
    return detectedProvider;
  }

  setProviderApiKey(provider, rawValue);
  return provider;
}

function setProvider(provider) {
  els.provider.value = provider;
  els.apiKey.value = state.providers[provider].apiKey;
  renderModelSelect();
}

async function fetchPublicConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();
    state.auth.firebaseConfig = data.firebaseConfig || null;
  } catch {
    state.auth.firebaseConfig = null;
  }
}

function isFirebaseConfigReady() {
  const config = state.auth.firebaseConfig || {};
  return Boolean(config.apiKey && config.projectId && config.appId);
}

function renderAuthUi() {
  const signedIn = Boolean(state.auth.user);
  const ready = state.auth.ready && Boolean(state.firebase.auth);
  els.authOverlay.classList.toggle("hidden", signedIn);
  els.signOutBtn.classList.toggle("hidden", !signedIn);
  els.googleSignInBtn.disabled = !ready || state.auth.loading;

  if (!signedIn) {
    if (!isFirebaseConfigReady()) {
      els.authNote.textContent = "Set Firebase env vars in Vercel to enable Google sign-in and saved workspaces.";
    } else if (!ready) {
      els.authNote.textContent = "Connecting to Firebase...";
    } else {
      els.authNote.textContent = "Sign in with Google to open your workspace.";
    }
    return;
  }
  const user = state.auth.user;
  els.authNote.textContent = `Signed in as ${user.email}.`;
  els.userChip.textContent = `${user.name || user.email}`;
}

async function initializeFirebaseAuth() {
  if (!isFirebaseConfigReady()) {
    state.auth.ready = false;
    renderAuthUi();
    return;
  }

  const app = getApps().length ? getApps()[0] : initializeApp(state.auth.firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  state.firebase.app = app;
  state.firebase.auth = auth;
  state.firebase.db = db;
  state.firebase.provider = new GoogleAuthProvider();
  state.auth.ready = true;

  els.googleSignInBtn.addEventListener("click", async () => {
    try {
      await signInWithPopup(state.firebase.auth, state.firebase.provider);
    } catch (error) {
      setStatus(error?.message || "Google sign-in failed.");
    }
  });

  onAuthStateChanged(state.firebase.auth, async (firebaseUser) => {
    if (!firebaseUser) {
      state.auth.user = null;
      state.auth.settings = null;
      state.providers.openai = createProviderState();
      state.providers.claude = createProviderState();
      els.apiKey.value = "";
      els.modelSelect.innerHTML = '<option value="">Enter an API key to load models</option>';
      renderAuthUi();
      render();
      return;
    }

    const user = {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      name: firebaseUser.displayName || firebaseUser.email || "",
      picture: firebaseUser.photoURL || ""
    };

    try {
      const settings = await loadUserSettings(user);
      applyUserSettings(user, settings);
      renderAuthUi();
      syncApiKeyIntoState();
      render();
    } catch (error) {
      setStatus(error?.message || "Unable to load workspace settings.");
    } finally {
      state.auth.loading = false;
      renderAuthUi();
    }
  });

  renderAuthUi();
}

async function signOut() {
  if (state.firebase.auth) {
    await firebaseSignOut(state.firebase.auth);
  }
}

async function bootstrapApp() {
  await fetchPublicConfig();
  state.auth.loading = false;
  renderAuthUi();
  await initializeFirebaseAuth();
}

function buildAiColumnConfig() {
  const provider = els.provider.value;
  const providerState = getProviderState(provider);
  const model = els.modelSelect.value || providerState.selectedModel;
  const columnIndex =
    state.aiModal.mode === "edit" ? state.aiModal.columnIndex : state.aiModal.insertAt ?? getSelectionBounds().endCol + 1;
  const name = els.aiColumnName.value.trim() || `AI ${columnLabel(columnIndex)}`;
  const prompt = els.prompt.value.trim();
  const outputFields = parseOutputFieldNames(els.outputFields.value);
  const existing = state.aiModal.mode === "edit" && columnIndex !== null ? getActiveSheet().aiColumns[columnIndex] : null;

  if (!prompt) {
    throw new Error("Add a prompt before saving the AI column.");
  }

  if (!model) {
    throw new Error("Load models for this API key and choose one.");
  }

  return {
    name,
    provider,
    model,
    prompt,
    condition: els.conditionPrompt.value.trim(),
    outputFields,
    outputColumns: existing?.outputColumns || {}
  };
}

function closeAiColumnModal() {
  state.aiModal.open = false;
  state.aiModal.mode = "create";
  state.aiModal.columnIndex = null;
  state.aiModal.insertAt = null;
  els.aiColumnModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  hideSlashMenu("prompt");
  hideSlashMenu("conditionPrompt");
}

function openJsonViewer({ title, raw, parsed, row, col }) {
  state.jsonViewer.open = true;
  state.jsonViewer.title = title;
  state.jsonViewer.raw = raw;
  state.jsonViewer.parsed = parsed;
  state.jsonViewer.row = row;
  state.jsonViewer.col = col;
  els.jsonViewerTitle.textContent = title;
  els.jsonViewerBody.textContent = formatJsonPretty(raw, parsed);
  els.createColumnsFromJsonBtn.disabled = !parsed || typeof parsed !== "object";
  els.jsonViewerModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeJsonViewer() {
  state.jsonViewer.open = false;
  state.jsonViewer.title = "";
  state.jsonViewer.raw = "";
  state.jsonViewer.parsed = null;
  state.jsonViewer.row = null;
  state.jsonViewer.col = null;
  els.jsonViewerModal.classList.add("hidden");
  els.createColumnsFromJsonBtn.disabled = true;
  if (!state.aiModal.open) {
    document.body.classList.remove("modal-open");
  }
}

function createColumnsFromJson(parsed, sheet, row, aiCol, config) {
  const flatEntries = flattenJson(parsed);
  if (!flatEntries.length) return;

  const created = [];
  for (const entry of flatEntries) {
    const path = entry.path || "value";
    const displayLabel = path.replace(/\.+/g, " ").trim();
    const outputCol = ensureOutputColumn(sheet, aiCol, path, displayLabel);
    if (outputCol === null) continue;
    setRawCell(sheet, row, outputCol, stringifyCellValue(entry.value));
    created.push({ path, outputCol });
  }

  if (!config.outputColumns) config.outputColumns = {};
  for (const item of created) {
    config.outputColumns[item.path] = item.outputCol;
  }
  normalizeSheetMetadata(sheet);
  render();
}

function configureOutputColumns(sheet, aiCol, config) {
  const outputFields = Array.isArray(config.outputFields) ? config.outputFields : [];
  if (!outputFields.length) return;

  for (const path of outputFields) {
    const displayLabel = path.replace(/\.+/g, " ").trim() || path;
    ensureOutputColumn(sheet, aiCol, path, displayLabel);
  }
}

async function openAiColumnModal(mode = "create", columnIndex = null) {
  const sheet = getActiveSheet();
  normalizeAiColumns(sheet);

  state.aiModal.open = true;
  state.aiModal.mode = mode;
  state.aiModal.columnIndex = columnIndex;
  state.aiModal.insertAt = mode === "create" ? getSelectionBounds().endCol + 1 : columnIndex;

  if (mode === "edit" && columnIndex !== null) {
    const config = sheet.aiColumns[columnIndex];
    els.aiColumnModalTitle.textContent = `Edit ${config.name}`;
    els.aiColumnName.value = config.name;
    els.prompt.value = config.prompt || "";
    els.outputFields.value = (config.outputFields || []).join(", ");
    els.conditionPrompt.value = config.condition || "";
    setProvider(config.provider);
    state.providers[config.provider].selectedModel = config.model;
  } else {
    els.aiColumnModalTitle.textContent = "Create AI Column";
    els.aiColumnName.value = "";
    els.prompt.value = "";
    els.outputFields.value = "";
    els.conditionPrompt.value = "";
    setProvider(els.provider.value);
  }

  els.aiColumnModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  renderModelSelect();

  if (getProviderState().apiKey.trim()) {
    await loadModels();
  }

  window.setTimeout(() => {
    els.aiColumnName.focus();
    els.aiColumnName.select();
  }, 20);
}

function saveAiColumn() {
  try {
    const config = buildAiColumnConfig();
    const sheet = getActiveSheet();
    normalizeAiColumns(sheet);

    if (state.aiModal.mode === "edit" && state.aiModal.columnIndex !== null) {
      sheet.aiColumns[state.aiModal.columnIndex] = config;
      configureOutputColumns(sheet, state.aiModal.columnIndex, config);
      selectCell(state.selection.endRow, state.aiModal.columnIndex, false, false);
      setStatus(`Updated AI column "${config.name}".`);
    } else {
      const insertAt = state.aiModal.insertAt ?? getSelectionBounds().endCol + 1;
      shiftAiColumnsOnInsert(sheet, insertAt);
      for (const row of sheet.cells) {
        row.splice(insertAt, 0, "");
      }
      sheet.aiColumns[insertAt] = config;
      configureOutputColumns(sheet, insertAt, config);
      selectCell(state.selection.endRow, insertAt, false, false);
      setStatus(`Created AI column "${config.name}".`);
    }

    closeAiColumnModal();
    render();
  } catch (error) {
    setStatus(error.message || "Unable to save AI column.");
    renderSheet();
  }
}

function getSelectedAiColumns() {
  const sheet = getActiveSheet();
  normalizeAiColumns(sheet);
  const bounds = getSelectionBounds();
  const columns = [];

  for (let col = bounds.startCol; col <= bounds.endCol; col++) {
    if (sheet.aiColumns[col]) columns.push(col);
  }

  if (!columns.length && sheet.aiColumns[state.selection.endCol]) {
    columns.push(state.selection.endCol);
  }

  return [...new Set(columns)];
}

function getSelectedRows() {
  const bounds = getSelectionBounds();
  const rows = [];
  for (let row = bounds.startRow; row <= bounds.endRow; row++) rows.push(row);
  return rows;
}

function findAiColumnIndex(sheet, targetConfig) {
  for (const [rawCol, config] of Object.entries(normalizeAiColumns(sheet))) {
    if (config === targetConfig) return Number(rawCol);
  }
  return -1;
}

async function executeAiColumnRow(sheet, row, col, config) {
  const providerState = state.providers[config.provider];
  const apiKey = providerState.apiKey.trim();

  if (!apiKey) {
    throw new Error(`Add a ${formatProviderName(config.provider)} API key to run "${config.name}".`);
  }

  const payloadEndCol = Math.max(getUsedRange(sheet).cols - 1, getConfiguredColumnCount(sheet) - 1, col);
  const rowPayload = getRowPayload(sheet, row, 0, payloadEndCol);
  const currentValue = getDisplayCell(sheet, row, col);
  const context = buildPromptContext(sheet, row, col, currentValue);
  const resolvedCondition = config.condition ? resolvePromptTemplate(config.condition, context) : "";

  const shouldRun = await shouldRunJob({
    provider: config.provider,
    apiKey,
    model: config.model,
    conditionPrompt: resolvedCondition,
    job: { input: rowPayload, context }
  });

  if (!shouldRun) {
    return { status: "skipped", message: `Skipped row ${row + 1} for "${config.name}" because the condition returned SKIP.` };
  }

  const resolvedPrompt = resolvePromptTemplate(config.prompt, context);
  const data = await callAiEndpoint({
    provider: config.provider,
    apiKey,
    model: config.model,
    prompt: resolvedPrompt,
    text: rowPayload
  });

  const rawResult = data.result ?? "";
  const parsedResult = tryParseJson(rawResult);
  const displayValue = parsedResult ? summarizeJson(parsedResult) : String(rawResult);

  setRawCell(sheet, row, col, displayValue);
  setAiCellRecord(sheet, row, col, {
    raw: String(rawResult),
    parsed: parsedResult,
    displayValue
  });

  if (parsedResult && config.outputColumns && Object.keys(config.outputColumns).length) {
    const flatMap = new Map(flattenJson(parsedResult).map((item) => [item.path, item.value]));
    for (const [path, outputCol] of Object.entries(config.outputColumns)) {
      setRawCell(sheet, row, outputCol, stringifyCellValue(flatMap.get(path)));
    }
  }

  return {
    status: "completed",
    message: `Completed row ${row + 1} for "${config.name}".`
  };
}

async function runAiColumnCell(row, col) {
  const sheet = getActiveSheet();
  const config = normalizeAiColumns(sheet)[col];

  if (!config) {
    setStatus("Select an AI column cell first.");
    renderSheet();
    return;
  }

  selectCell(row, col, false, false);
  setStatus(`Running row ${row + 1} for "${config.name}"...`);
  renderSheet();

  try {
    const result = await executeAiColumnRow(sheet, row, col, config);
    setStatus(result.message);
  } catch (error) {
    setRawCell(sheet, row, col, error.message || "Request failed");
    setStatus(error.message || "Request failed");
  }

  renderSheet();
}

async function runAiColumnsForRows(rows, columns) {
  if (!columns.length) {
    setStatus("Create or select an AI column first.");
    renderSheet();
    return;
  }

  if (!rows.length) {
    setStatus("Select at least one row first.");
    renderSheet();
    return;
  }

  const sheet = getActiveSheet();
  const jobs = [];

  for (const row of rows) {
    for (const col of columns) {
      const config = normalizeAiColumns(sheet)[col];
      if (config) jobs.push({ row, config });
    }
  }

  if (!jobs.length) {
    setStatus("Nothing to run in the current selection.");
    renderSheet();
    return;
  }

  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    const liveCol = findAiColumnIndex(sheet, job.config);
    if (liveCol < 0) {
      skipped += 1;
      continue;
    }

    setStatus(`Running ${index + 1}/${jobs.length}: row ${job.row + 1} for "${job.config.name}"...`);
    renderSheet();

    try {
      const result = await executeAiColumnRow(sheet, job.row, liveCol, job.config);
      if (result.status === "skipped") skipped += 1;
      if (result.status === "completed") completed += 1;
      setStatus(result.message);
    } catch (error) {
      failed += 1;
      setRawCell(sheet, job.row, liveCol, error.message || "Request failed");
      setStatus(`Failed row ${job.row + 1} for "${job.config.name}".`);
    }

    renderSheet();
  }

  const failureText = failed ? `, ${failed} failed` : "";
  setStatus(`Finished ${completed} run${completed === 1 ? "" : "s"}, ${skipped} skipped${failureText}.`);
  renderSheet();
}

function runCurrentRowForSelectedAiColumns() {
  runAiColumnsForRows([state.selection.endRow], getSelectedAiColumns());
}

function runSelectedRowsForSelectedAiColumns() {
  runAiColumnsForRows(getSelectedRows(), getSelectedAiColumns());
}

function bindTableEvents() {
  els.sheet.addEventListener("pointerdown", (event) => {
    const editButton = event.target.closest("[data-edit-ai-col]");
    if (editButton) return;

    const runButton = event.target.closest("[data-run-ai-row]");
    if (runButton) return;

    const viewButton = event.target.closest("[data-open-json-row]");
    if (viewButton) return;

    const cell = event.target.closest("[data-cell]");
    const rowHeader = event.target.closest("[data-row-header]");
    const colHeader = event.target.closest("[data-col-header]");

    if (rowHeader) {
      selectRow(Number(rowHeader.dataset.rowHeader));
      return;
    }

    if (colHeader) {
      selectColumn(Number(colHeader.dataset.colHeader));
      return;
    }

    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    selectCell(row, col, event.shiftKey, true);
  });

  els.sheet.addEventListener("input", (event) => {
    const input = event.target.closest("[data-cell-input]");
    if (!input) return;
    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);
    const sheet = getActiveSheet();
    setRawCell(sheet, row, col, input.value);
    els.formulaInput.value = input.value;
  });

  els.sheet.addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-cell-input]");
    if (!input) return;
    const row = Number(input.dataset.row);
    const col = Number(input.dataset.col);

    if (event.key === "Enter") {
      event.preventDefault();
      selectCell(row + 1, col, false, true);
    }

    if (event.key === "Tab") {
      event.preventDefault();
      selectCell(row, col + 1, false, true);
    }
  });

  els.sheet.addEventListener("focusout", (event) => {
    const input = event.target.closest("[data-cell-input]");
    if (!input) return;
    render();
  });

  els.sheet.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-ai-col]");
    if (editButton) {
      event.preventDefault();
      selectColumn(Number(editButton.dataset.editAiCol));
      openAiColumnModal("edit", Number(editButton.dataset.editAiCol));
      return;
    }

    const viewButton = event.target.closest("[data-open-json-row]");
    if (viewButton) {
      event.preventDefault();
      const row = Number(viewButton.dataset.openJsonRow);
      const col = Number(viewButton.dataset.openJsonCol);
      const sheet = getActiveSheet();
      const record = getAiCellRecord(sheet, row, col);
      openJsonViewer({
        title: `${getActiveSheet().name} - ${columnLabel(col)}${row + 1}`,
        raw: record?.raw || getRawCell(sheet, row, col),
        parsed: record?.parsed || tryParseJson(getRawCell(sheet, row, col)),
        row,
        col
      });
      return;
    }

    const runButton = event.target.closest("[data-run-ai-row]");
    if (!runButton) return;
    event.preventDefault();
    runAiColumnCell(Number(runButton.dataset.runAiRow), Number(runButton.dataset.runAiCol));
  });
}

function bindPromptTextarea(textarea) {
  textarea.addEventListener("input", () => updateSlashMenu(textarea));
  textarea.addEventListener("click", () => updateSlashMenu(textarea));
  textarea.addEventListener("keydown", handleSlashKeydown);
  textarea.addEventListener("blur", () => {
    window.setTimeout(() => hideSlashMenu(textarea.id), 120);
  });
}

function bindUi() {
  els.csvFile.addEventListener("change", async () => {
    const file = els.csvFile.files?.[0];
    if (!file) return;
    importCSV(await file.text());
  });

  els.exportBtn.addEventListener("click", exportCSV);
  els.addRowBtn.addEventListener("click", insertRow);
  els.addColBtn.addEventListener("click", insertColumn);
  els.addAiColumnBtn.addEventListener("click", () => {
    openAiColumnModal("create");
  });
  els.deleteRowBtn.addEventListener("click", deleteRow);
  els.deleteColBtn.addEventListener("click", deleteColumn);
  els.newSheetBtn.addEventListener("click", addSheet);
  els.renameSheetBtn.addEventListener("click", renameSheet);
  els.runSelectedRowBtn.addEventListener("click", runCurrentRowForSelectedAiColumns);
  els.runAiBtn.addEventListener("click", runSelectedRowsForSelectedAiColumns);
  els.refreshModelsBtn.addEventListener("click", () => {
    syncApiKeyIntoState();
    loadModels();
  });

  els.closeAiModalBtn.addEventListener("click", closeAiColumnModal);
  els.cancelAiModalBtn.addEventListener("click", closeAiColumnModal);
  els.saveAiColumnBtn.addEventListener("click", saveAiColumn);
  els.closeJsonViewerBtn.addEventListener("click", closeJsonViewer);
  els.copyJsonBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.jsonViewer.raw || els.jsonViewerBody.textContent || "");
      setStatus("Copied JSON to clipboard.");
    } catch {
      setStatus("Could not copy JSON in this browser.");
    }
  });
  els.createColumnsFromJsonBtn.addEventListener("click", () => {
    if (!state.jsonViewer.parsed || typeof state.jsonViewer.parsed !== "object") return;
    const sheet = getActiveSheet();
    const row = state.jsonViewer.row ?? state.selection.endRow;
    const col = state.jsonViewer.col ?? state.selection.endCol;
    const config = normalizeAiColumns(sheet)[col];
    if (!config) return;
    createColumnsFromJson(state.jsonViewer.parsed, sheet, row, col, config);
    closeJsonViewer();
    setStatus(`Created columns from JSON for "${config.name}".`);
  });
  els.signOutBtn.addEventListener("click", signOut);

  els.aiColumnModal.addEventListener("mousedown", (event) => {
    if (event.target === els.aiColumnModal) {
      closeAiColumnModal();
    }
  });

  els.jsonViewerModal.addEventListener("mousedown", (event) => {
    if (event.target === els.jsonViewerModal) {
      closeJsonViewer();
    }
  });

  els.formulaInput.addEventListener("input", () => {
    const sheet = getActiveSheet();
    setRawCell(sheet, state.selection.endRow, state.selection.endCol, els.formulaInput.value);
    const activeInput = els.sheet.querySelector(
      `[data-cell-input="true"][data-row="${state.selection.endRow}"][data-col="${state.selection.endCol}"]`
    );
    if (activeInput instanceof HTMLInputElement) {
      activeInput.value = els.formulaInput.value;
    }
  });

  els.formulaInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      render();
    }
  });

  els.formulaInput.addEventListener("blur", () => {
    render();
  });

  els.provider.addEventListener("change", () => {
    setProvider(els.provider.value);
    if (getProviderState().apiKey.trim()) loadModels();
  });

  els.modelSelect.addEventListener("change", () => {
    setProviderModel(els.provider.value, els.modelSelect.value);
  });

  els.apiKey.addEventListener("input", () => {
    syncApiKeyIntoState();
  });

  els.apiKey.addEventListener("blur", () => {
    const provider = syncApiKeyIntoState();
    setProvider(provider);
    if (getProviderState(provider).apiKey.trim()) loadModels();
  });

  els.sheetTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sheet-id]");
    if (!button) return;
    state.activeSheetId = button.dataset.sheetId;
    state.selection = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    closeAiColumnModal();
    setStatus(`Switched to ${getActiveSheet().name}.`);
    render();
  });

  bindPromptTextarea(els.prompt);
  bindPromptTextarea(els.conditionPrompt);

  [els.promptSlashMenu, els.conditionSlashMenu].forEach((menuEl) => {
    menuEl.addEventListener("mousedown", (event) => {
      const button = event.target.closest("[data-slash-index]");
      if (!button) return;
      event.preventDefault();
      insertSlashToken(button.dataset.slashTarget, Number(button.dataset.slashIndex));
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.jsonViewer.open) {
      closeJsonViewer();
      return;
    }

    if (event.key === "Escape" && state.aiModal.open) {
      closeAiColumnModal();
    }
  });
}

bindTableEvents();
bindUi();
bootstrapApp();
