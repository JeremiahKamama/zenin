/**
 * Shared download / export / clipboard utilities for Zenin Admin.
 *
 * Identical to frontend/src/utils/downloadHelpers.js — kept as a local copy
 * because admin has its own independent build.
 */

export function downloadBlob(filename, content, mimeType = "text/plain;charset=utf-8") {
  if (typeof document === "undefined") return;
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCsvFile(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    downloadBlob(filename, "", "text/csv;charset=utf-8");
    return;
  }

  const keys = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );
  const lines = [
    keys.join(","),
    ...rows.map((row) => keys.map((key) => escapeCsvValue(row?.[key])).join(",")),
  ];
  downloadBlob(filename, `${lines.join("\n")}\n`, "text/csv;charset=utf-8");
}

export function downloadJsonFile(filename, value) {
  downloadBlob(filename, `${JSON.stringify(value, null, 2)}\n`, "application/json;charset=utf-8");
}

export async function copyTextToClipboard(value) {
  const text = String(value ?? "");
  if (!text) return;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") return;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
