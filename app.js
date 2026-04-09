const INITIAL_ROWS = 30;
const INITIAL_COLS = 12;
const state = {
  sheets: [createSheet("Sheet 1", INITIAL_ROWS, INITIAL_COLS)],
  activeSheetId: "sheet-1",
  selection: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
  status: "Ready.",
  modelOptions: [],
  selectedModel: "",
  modelHelp: "Enter an API key to load models.",
  modelsLoading: false,
  slashMenus: {
    prompt: createSlashMenuState(),
    conditionPrompt: createSlashMenuState()
  }
};

const els = {
  sheet: document.getElementById("sheet"),
  sheetTabs: document.getElementById("sheetTabs"),
  csvFile: document.getElementById("csvFile"),
  exportBtn: document.getElementById("exportBtn"),
  addRowBtn: document.getElementById("addRowBtn"),
  addColBtn: document.getElementById("addColBtn"),
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
  aiScope: document.getElementById("aiScope"),
  prompt: document.getElementById("prompt"),
  conditionPrompt: document.getElementById("conditionPrompt"),
  promptSlashMenu: document.getElementById("promptSlashMenu"),
  conditionSlashMenu: document.getElementById("conditionSlashMenu"),
  runAiBtn: document.getElementById("runAiBtn"),
  status: document.getElementById("status"),
  sheetMeta: document.getElementById("sheetMeta")
};

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
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""))
  };
}

state.activeSheetId = state.sheets[0].id;

function getActiveSheet() {
  return state.sheets.find((sheet) => sheet.id === state.activeSheetId) || state.sheets[0];
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
    sheet.cells.push(Array.from({ length: sheet.cells[0]?.length || minCols }, () => ""));
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

function evaluateCell(sheet, row, col, cache = new Map(), stack = new Set()) {
  const key = `${row},${col}`;
  if (cache.has(key)) return cache.get(key);

  const raw = getRawCell(sheet, row, col);
  if (!raw.startsWith("=")) {
    cache.set(key, raw);
    return raw;
  }

  if (stack.has(key)) {
    return "#CYCLE";
  }

  stack.add(key);
  const expression = raw.slice(1).trim();
  let result = "#ERROR";

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

      if (/^\s*[A-Z]+\d+\s*$/i.test(working)) {
        const ref = parseCellRef(working.trim());
        result = evaluateCell(sheet, ref.row, ref.col, cache, stack);
      } else {
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
    }
  } catch {
    result = "#ERROR";
  }

  stack.delete(key);
  cache.set(key, result);
  return result;
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
  const startRow = Math.min(start.row, end.row);
  const endRow = Math.max(start.row, end.row);
  const startCol = Math.min(start.col, end.col);
  const endCol = Math.max(start.col, end.col);
  const values = [];

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      values.push(evaluateCell(sheet, row, col, cache, stack));
    }
  }

  return values;
}

function getDisplayCell(sheet, row, col, cache = new Map()) {
  return evaluateCell(sheet, row, col, cache, new Set());
}

function getUsedRange(sheet) {
  let lastRow = 0;
  let lastCol = 0;
  for (let row = 0; row < sheet.cells.length; row++) {
    for (let col = 0; col < sheet.cells[row].length; col++) {
      if ((sheet.cells[row][col] || "").trim() !== "") {
        lastRow = Math.max(lastRow, row);
        lastCol = Math.max(lastCol, col);
      }
    }
  }
  return { rows: lastRow + 1, cols: lastCol + 1 };
}

function formatSelectionSummary() {
  const bounds = getSelectionBounds();
  const start = `${columnLabel(bounds.startCol)}${bounds.startRow + 1}`;
  const end = `${columnLabel(bounds.endCol)}${bounds.endRow + 1}`;
  if (start === end) return `${start} selected`;
  return `${start}:${end} selected`;
}

function renderModelSelect() {
  if (state.modelsLoading) {
    els.modelSelect.innerHTML = '<option value="">Loading models...</option>';
    els.modelSelect.value = "";
    els.modelHelp.textContent = state.modelHelp;
    return;
  }

  if (!state.modelOptions.length) {
    els.modelSelect.innerHTML = '<option value="">Enter an API key to load models</option>';
    els.modelSelect.value = "";
    els.modelHelp.textContent = state.modelHelp;
    return;
  }

  els.modelSelect.innerHTML = state.modelOptions
    .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`)
    .join("");

  const selected =
    state.modelOptions.find((option) => option.id === state.selectedModel)?.id || state.modelOptions[0].id;
  state.selectedModel = selected;
  els.modelSelect.value = selected;
  els.modelHelp.textContent = state.modelHelp;
}

function renderSlashMenu(targetId) {
  const menuState = state.slashMenus[targetId];
  const menuEl = targetId === "prompt" ? els.promptSlashMenu : els.conditionSlashMenu;

  if (!menuState.visible || !menuState.items.length) {
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
  ensureSize(sheet, INITIAL_ROWS, INITIAL_COLS);
  const cache = new Map();
  const bounds = getSelectionBounds();
  const rowCount = Math.max(sheet.cells.length, INITIAL_ROWS);
  const colCount = Math.max(sheet.cells[0]?.length || 0, INITIAL_COLS);

  const headerCells = Array.from({ length: colCount }, (_, col) => {
    const selected = col >= bounds.startCol && col <= bounds.endCol ? " selected-header" : "";
    return `<th class="column-header${selected}" data-col-header="${col}">${columnLabel(col)}</th>`;
  }).join("");

  const bodyRows = Array.from({ length: rowCount }, (_, row) => {
    const rowSelected = row >= bounds.startRow && row <= bounds.endRow ? " selected-header" : "";
    const cells = Array.from({ length: colCount }, (_, col) => {
      const raw = getRawCell(sheet, row, col);
      const display = getDisplayCell(sheet, row, col, cache);
      const isActive = row === state.selection.endRow && col === state.selection.endCol;
      const inSelection = row >= bounds.startRow && row <= bounds.endRow && col >= bounds.startCol && col <= bounds.endCol;
      const classes = ["sheet-cell"];
      if (inSelection) classes.push("selected");
      if (isActive) classes.push("active");
      if (raw.startsWith("=")) classes.push("formula");
      const value = isActive ? raw : display;
      return `
        <td class="${classes.join(" ")}" data-cell="true" data-row="${row}" data-col="${col}">
          <input
            data-cell-input="true"
            data-row="${row}"
            data-col="${col}"
            value="${escapeHtml(value)}"
            spellcheck="false"
          />
        </td>`;
    }).join("");

    return `<tr><th class="row-header${rowSelected}" data-row-header="${row}">${row + 1}</th>${cells}</tr>`;
  }).join("");

  els.sheet.innerHTML = `<thead><tr><th class="corner-cell"></th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>`;
  els.selectionSummary.textContent = formatSelectionSummary();
  els.activeCellName.textContent = `${columnLabel(state.selection.endCol)}${state.selection.endRow + 1}`;
  els.formulaInput.value = getRawCell(sheet, state.selection.endRow, state.selection.endCol);

  const used = getUsedRange(sheet);
  els.sheetMeta.textContent = `${used.rows} rows, ${used.cols} columns, ${state.sheets.length} sheet${state.sheets.length === 1 ? "" : "s"}`;
  els.status.textContent = state.status;
  renderTabs();
}

function render() {
  renderSheet();
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
  const lastCol = (sheet.cells[0]?.length || INITIAL_COLS) - 1;
  state.selection = { startRow: row, startCol: 0, endRow: row, endCol: lastCol };
  render();
}

function selectColumn(col) {
  const sheet = getActiveSheet();
  const lastRow = sheet.cells.length - 1;
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
        index++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === ',') {
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

  const maxCols = Math.max(...rows.map((row) => row.length));
  const sheet = getActiveSheet();
  sheet.cells = Array.from({ length: Math.max(rows.length, INITIAL_ROWS) }, (_, rowIndex) =>
    Array.from({ length: Math.max(maxCols, INITIAL_COLS) }, (_, colIndex) => rows[rowIndex]?.[colIndex] ?? "")
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
  link.download = `${getActiveSheet().name.replace(/\s+/g, "-").toLowerCase() || "sheet"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function insertRow() {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  const colCount = sheet.cells[0]?.length || INITIAL_COLS;
  sheet.cells.splice(bounds.endRow + 1, 0, Array.from({ length: colCount }, () => ""));
  selectCell(bounds.endRow + 1, bounds.startCol);
  setStatus("Row inserted.");
}

function insertColumn() {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  for (const row of sheet.cells) {
    row.splice(bounds.endCol + 1, 0, "");
  }
  selectCell(bounds.startRow, bounds.endCol + 1);
  setStatus("Column inserted.");
}

function deleteRow() {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  sheet.cells.splice(bounds.startRow, bounds.endRow - bounds.startRow + 1);
  if (!sheet.cells.length) {
    sheet.cells = Array.from({ length: INITIAL_ROWS }, () => Array.from({ length: INITIAL_COLS }, () => ""));
  }
  selectCell(Math.min(bounds.startRow, sheet.cells.length - 1), bounds.startCol);
  setStatus("Selected row range deleted.");
}

function deleteColumn() {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  for (const row of sheet.cells) {
    row.splice(bounds.startCol, bounds.endCol - bounds.startCol + 1);
    if (!row.length) row.push("");
  }
  selectCell(bounds.startRow, Math.min(bounds.startCol, sheet.cells[0].length - 1));
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

function getRowPayload(sheet, row, startCol, endCol) {
  const payload = {};
  for (let col = startCol; col <= endCol; col++) {
    payload[columnLabel(col)] = getDisplayCell(sheet, row, col);
  }
  return JSON.stringify(payload, null, 2);
}

function getRowDataMap(sheet, row) {
  const used = getUsedRange(sheet);
  const totalCols = Math.max(used.cols, state.selection.endCol + 1, INITIAL_COLS);
  const cache = new Map();
  const rowData = {};

  for (let col = 0; col < totalCols; col++) {
    rowData[columnLabel(col)] = getDisplayCell(sheet, row, col, cache);
  }

  return rowData;
}

function buildPromptContext(sheet, row, col, currentValue) {
  const rowData = getRowDataMap(sheet, row);
  return {
    rowNumber: row + 1,
    currentColumn: columnLabel(col),
    currentValue,
    cellRef: `${columnLabel(col)}${row + 1}`,
    sheetName: sheet.name,
    rowJson: JSON.stringify(rowData, null, 2),
    columns: rowData
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
      const column = columnMatch[1].trim().toUpperCase();
      return String(context.columns[column] ?? "");
    }

    return "";
  });
}

function getSlashItems() {
  const sheet = getActiveSheet();
  const used = getUsedRange(sheet);
  const totalCols = Math.max(used.cols, state.selection.endCol + 1, INITIAL_COLS);
  const helpers = [
    { label: "/current_value", subtitle: "Insert the current cell or row payload", token: "{{current_value}}", search: "current_value value cell" },
    { label: "/row_number", subtitle: "Insert the current row number", token: "{{row_number}}", search: "row_number row number" },
    { label: "/current_column", subtitle: "Insert the active column letter", token: "{{current_column}}", search: "current_column column letter" },
    { label: "/cell_ref", subtitle: "Insert the active cell reference like B7", token: "{{cell_ref}}", search: "cell_ref cell reference" },
    { label: "/row_json", subtitle: "Insert the full current row as JSON", token: "{{row_json}}", search: "row_json row json" },
    { label: "/sheet_name", subtitle: "Insert the current sheet name", token: "{{sheet_name}}", search: "sheet_name sheet" }
  ];

  const columns = Array.from({ length: totalCols }, (_, col) => {
    const letter = columnLabel(col);
    return {
      label: `/${letter}`,
      subtitle: `Insert column ${letter} from the current row`,
      token: `{{column:${letter}}}`,
      search: `${letter.toLowerCase()} column ${letter.toLowerCase()}`
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
  const match = /(?:^|\s)\/([a-zA-Z0-9_]*)$/.exec(beforeCursor);

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
  return answer.startsWith("RUN");
}

async function loadModels() {
  const provider = els.provider.value;
  const apiKey = els.apiKey.value.trim();

  if (!apiKey) {
    state.modelOptions = [];
    state.selectedModel = "";
    state.modelHelp = "Enter an API key to load models.";
    renderModelSelect();
    return;
  }

  state.modelsLoading = true;
  state.modelHelp = `Loading supported ${provider} models...`;
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

    state.modelOptions = data.models || [];
    state.selectedModel =
      state.modelOptions.find((option) => option.id === state.selectedModel)?.id || state.modelOptions[0]?.id || "";
    state.modelHelp =
      data.message ||
      (state.modelOptions.length
        ? `Loaded ${state.modelOptions.length} supported ${provider} model${state.modelOptions.length === 1 ? "" : "s"}.`
        : "No supported models were returned for this key.");
  } catch (error) {
    state.modelOptions = [];
    state.selectedModel = "";
    state.modelHelp = error.message || "Unable to load models.";
  } finally {
    state.modelsLoading = false;
    renderModelSelect();
  }
}

function buildJobs(scope) {
  const sheet = getActiveSheet();
  const bounds = getSelectionBounds();
  const used = getUsedRange(sheet);
  const jobs = [];

  if (scope === "cell") {
    const value = getDisplayCell(sheet, bounds.endRow, bounds.endCol);
    jobs.push({
      input: value,
      target: { row: bounds.endRow, col: bounds.endCol + 1 },
      context: buildPromptContext(sheet, bounds.endRow, bounds.endCol, value)
    });
  }

  if (scope === "selection") {
    const width = bounds.endCol - bounds.startCol + 1;
    for (let row = bounds.startRow; row <= bounds.endRow; row++) {
      for (let col = bounds.startCol; col <= bounds.endCol; col++) {
        const value = getDisplayCell(sheet, row, col);
        jobs.push({
          input: value,
          target: { row, col: col + width },
          context: buildPromptContext(sheet, row, col, value)
        });
      }
    }
  }

  if (scope === "column") {
    const columnBounds =
      bounds.startCol === bounds.endCol && bounds.startRow === bounds.endRow
        ? { startRow: 0, endRow: Math.max(used.rows - 1, bounds.endRow), startCol: bounds.startCol, endCol: bounds.endCol }
        : bounds;
    const width = columnBounds.endCol - columnBounds.startCol + 1;
    for (let row = columnBounds.startRow; row <= columnBounds.endRow; row++) {
      for (let col = columnBounds.startCol; col <= columnBounds.endCol; col++) {
        const value = getDisplayCell(sheet, row, col);
        jobs.push({
          input: value,
          target: { row, col: col + width },
          context: buildPromptContext(sheet, row, col, value)
        });
      }
    }
  }

  if (scope === "row") {
    const rowBounds =
      bounds.startCol === bounds.endCol && bounds.startRow === bounds.endRow
        ? { startRow: bounds.startRow, endRow: bounds.endRow, startCol: 0, endCol: Math.max(used.cols - 1, bounds.endCol) }
        : bounds;
    const outputCol = rowBounds.endCol + 1;
    for (let row = rowBounds.startRow; row <= rowBounds.endRow; row++) {
      const rowPayload = getRowPayload(sheet, row, rowBounds.startCol, rowBounds.endCol);
      jobs.push({
        input: rowPayload,
        target: { row, col: outputCol },
        context: buildPromptContext(sheet, row, rowBounds.startCol, rowPayload)
      });
    }
  }

  return jobs;
}

async function runAi() {
  const promptTemplate = els.prompt.value.trim();
  const conditionTemplate = els.conditionPrompt.value.trim();
  const provider = els.provider.value;
  const apiKey = els.apiKey.value.trim();
  const model = els.modelSelect.value || state.selectedModel;

  if (!promptTemplate) {
    setStatus("Add a prompt first.");
    renderSheet();
    return;
  }

  if (!model) {
    setStatus("Load models for this key and choose one first.");
    renderSheet();
    return;
  }

  const jobs = buildJobs(els.aiScope.value);
  if (!jobs.length) {
    setStatus("Nothing selected for AI processing.");
    renderSheet();
    return;
  }

  const sheet = getActiveSheet();
  let completed = 0;
  let skipped = 0;

  setStatus(`Running ${provider} on ${jobs.length} item${jobs.length === 1 ? "" : "s"}...`);
  renderSheet();

  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];

    try {
      const resolvedCondition = conditionTemplate ? resolvePromptTemplate(conditionTemplate, job.context) : "";
      const shouldRun = await shouldRunJob({
        provider,
        apiKey,
        model,
        conditionPrompt: resolvedCondition,
        job
      });

      if (!shouldRun) {
        setRawCell(sheet, job.target.row, job.target.col, "");
        skipped++;
        setStatus(`Checked ${index + 1}/${jobs.length} items. ${skipped} skipped by condition.`);
        renderSheet();
        continue;
      }

      const resolvedPrompt = resolvePromptTemplate(promptTemplate, job.context);
      const data = await callAiEndpoint({
        provider,
        apiKey,
        model,
        prompt: resolvedPrompt,
        text: job.input
      });

      setRawCell(sheet, job.target.row, job.target.col, data.result || "");
      completed++;
      setStatus(`Processed ${index + 1}/${jobs.length} items. ${skipped} skipped.`);
      renderSheet();
    } catch (error) {
      setRawCell(sheet, job.target.row, job.target.col, error.message || "Request failed");
      setStatus(`Stopped on item ${index + 1}: ${error.message || "Request failed"}`);
      renderSheet();
      return;
    }
  }

  setStatus(`AI run complete. ${completed} completed, ${skipped} skipped.`);
  renderSheet();
}

function bindTableEvents() {
  els.sheet.addEventListener("pointerdown", (event) => {
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
}

function bindPromptTextarea(textarea) {
  textarea.addEventListener("input", () => {
    updateSlashMenu(textarea);
  });

  textarea.addEventListener("click", () => {
    updateSlashMenu(textarea);
  });

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
  els.deleteRowBtn.addEventListener("click", deleteRow);
  els.deleteColBtn.addEventListener("click", deleteColumn);
  els.newSheetBtn.addEventListener("click", addSheet);
  els.renameSheetBtn.addEventListener("click", renameSheet);
  els.runAiBtn.addEventListener("click", runAi);
  els.refreshModelsBtn.addEventListener("click", loadModels);

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
    state.modelOptions = [];
    state.selectedModel = "";
    state.modelHelp = "Load models for the selected provider.";
    renderModelSelect();
    if (els.apiKey.value.trim()) loadModels();
  });

  els.modelSelect.addEventListener("change", () => {
    state.selectedModel = els.modelSelect.value;
  });

  els.apiKey.addEventListener("blur", () => {
    const detectedProvider = detectProviderFromKey(els.apiKey.value.trim());
    if (detectedProvider && detectedProvider !== els.provider.value) {
      els.provider.value = detectedProvider;
    }
    if (els.apiKey.value.trim()) loadModels();
  });

  els.sheetTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sheet-id]");
    if (!button) return;
    state.activeSheetId = button.dataset.sheetId;
    state.selection = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
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
}

bindTableEvents();
bindUi();
render();
