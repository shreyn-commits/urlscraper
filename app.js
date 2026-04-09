const state = {
  headers: ["A", "B", "C"],
  rows: [["", "", ""]],
  selectedColumn: 0
};

const els = {
  sheet: document.getElementById("sheet"),
  csvFile: document.getElementById("csvFile"),
  exportBtn: document.getElementById("exportBtn"),
  runBtn: document.getElementById("runBtn"),
  provider: document.getElementById("provider"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("apiKey"),
  prompt: document.getElementById("prompt"),
  columnSelect: document.getElementById("columnSelect"),
  status: document.getElementById("status"),
  rowCount: document.getElementById("rowCount")
};

function setStatus(message) {
  els.status.textContent = message;
}

function normalizeRows(rows) {
  const maxLen = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: maxLen }, (_, i) => row[i] ?? ""));
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((value) => value !== ""));
}

function escapeCSV(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function render() {
  els.rowCount.textContent = `${state.rows.length} rows · ${state.headers.length} columns`;
  els.columnSelect.innerHTML = state.headers
    .map((h, i) => `<option value="${i}">${h || `Column ${i + 1}`}</option>`)
    .join("");
  els.columnSelect.value = String(state.selectedColumn);

  els.sheet.innerHTML = `
    <thead>
      <tr>
        ${state.headers
          .map(
            (header, colIndex) => `
              <th>
                <input data-kind="header" data-col="${colIndex}" value="${header}" />
              </th>`
          )
          .join("")}
      </tr>
    </thead>
    <tbody>
      ${state.rows
        .map(
          (row, rowIndex) => `
            <tr>
              ${row
                .map(
                  (value, colIndex) => `
                    <td>
                      <input data-kind="cell" data-row="${rowIndex}" data-col="${colIndex}" value="${String(value ?? "")}" />
                    </td>`
                )
                .join("")}
            </tr>`
        )
        .join("")}
    </tbody>`;
}

function ensureColumnIndex(index) {
  while (state.headers.length <= index) state.headers.push(`Column ${state.headers.length + 1}`);
  state.rows = state.rows.map((row) => {
    const next = row.slice();
    while (next.length <= index) next.push("");
    return next;
  });
}

function bindTableEvents() {
  els.sheet.oninput = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const col = Number(target.dataset.col);
    if (target.dataset.kind === "header") {
      state.headers[col] = target.value || `Column ${col + 1}`;
      render();
      return;
    }
    const row = Number(target.dataset.row);
    ensureColumnIndex(col);
    state.rows[row][col] = target.value;
  };
}

function loadCSV(text) {
  const parsed = parseCSV(text);
  if (!parsed.length) return;
  state.headers = parsed[0].map((h, i) => h || `Column ${i + 1}`);
  state.rows = normalizeRows(parsed.slice(1));
  if (!state.rows.length) state.rows = [Array.from({ length: state.headers.length }, () => "")];
  while (state.rows.some((row) => row.length < state.headers.length)) {
    state.rows = state.rows.map((row) => {
      const next = row.slice();
      while (next.length < state.headers.length) next.push("");
      return next;
    });
  }
  state.selectedColumn = 0;
  render();
  setStatus("CSV loaded.");
}

function exportCSV() {
  const lines = [state.headers.map(escapeCSV).join(",")];
  for (const row of state.rows) lines.push(row.map(escapeCSV).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function runOnColumn() {
  const col = Number(els.columnSelect.value);
  const prompt = els.prompt.value.trim();
  const apiKey = els.apiKey.value.trim();
  if (!prompt || !apiKey) {
    setStatus("Add a prompt and API key first.");
    return;
  }

  ensureColumnIndex(col);
  const outputCol = state.headers.length;
  state.headers.push(`${state.headers[col]} AI`);
  state.rows = state.rows.map((row) => {
    const next = row.slice();
    while (next.length < state.headers.length) next.push("");
    return next;
  });
  render();

  const provider = els.provider.value;
  const model = els.model.value.trim();
  setStatus(`Running ${provider} on ${state.rows.length} rows...`);

  for (let i = 0; i < state.rows.length; i++) {
    const input = state.rows[i][col] ?? "";
    try {
      const response = await fetch("/api/run-column", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey,
          model,
          prompt: `${prompt}\n\nColumn: ${state.headers[col]}`,
          text: input
        })
      });
      const data = await response.json();
      state.rows[i][outputCol] = data.result || data.error || "";
      render();
    } catch (error) {
      state.rows[i][outputCol] = error.message;
      render();
    }
  }

  setStatus("Done.");
}

els.csvFile.addEventListener("change", async () => {
  const file = els.csvFile.files?.[0];
  if (!file) return;
  loadCSV(await file.text());
});
els.exportBtn.addEventListener("click", exportCSV);
els.runBtn.addEventListener("click", runOnColumn);
els.columnSelect.addEventListener("change", () => {
  state.selectedColumn = Number(els.columnSelect.value);
});

state.rows = [["", "", ""]];
render();
bindTableEvents();
