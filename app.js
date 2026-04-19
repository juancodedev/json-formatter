const jsonInput = document.getElementById("jsonInput");
const formatBtn = document.getElementById("formatBtn");
const minifyBtn = document.getElementById("minifyBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.classList.remove("ok", "error");
  if (type) statusEl.classList.add(type);
}

function tryParseJson(value) {
  return JSON.parse(value);
}

formatBtn.addEventListener("click", () => {
  try {
    const parsed = tryParseJson(jsonInput.value);
    jsonInput.value = JSON.stringify(parsed, null, 2);
    setStatus("JSON formatted successfully.", "ok");
  } catch (error) {
    setStatus(`Invalid JSON: ${error.message}`, "error");
  }
});

minifyBtn.addEventListener("click", () => {
  try {
    const parsed = tryParseJson(jsonInput.value);
    jsonInput.value = JSON.stringify(parsed);
    setStatus("JSON minified successfully.", "ok");
  } catch (error) {
    setStatus(`Invalid JSON: ${error.message}`, "error");
  }
});

clearBtn.addEventListener("click", () => {
  jsonInput.value = "";
  setStatus("");
  jsonInput.focus();
});
