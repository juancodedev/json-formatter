import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { placeholder } from '@codemirror/view';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { autoUnpack } from './unpackers.js';
import { jsonrepair } from 'jsonrepair';

// --- State and Config ---
let editor;
const STORAGE_KEY = 'json_formatter_prefs';
const PY_OBJ_MARKER = '___PY_INTERNAL_OBJ___';

const elements = {
  container: document.getElementById('editor-container'),
  indentSize: document.getElementById('indent-size'),
  outputFormat: document.getElementById('output-format'),
  formatBtn: document.getElementById('formatBtn'),
  minifyBtn: document.getElementById('minifyBtn'),
  copyBtn: document.getElementById('copyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  clearBtn: document.getElementById('clearBtn'),
  fileUpload: document.getElementById('fileUpload'),
  themeToggle: document.getElementById('themeToggle'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  mainContainer: document.querySelector('.main-container'),
  statusText: document.querySelector('.status-text'),
  statusPanel: document.getElementById('status')
};

// --- Initialization ---
async function init() {
  const savedPrefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  const theme = savedPrefs.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);

  if (savedPrefs.indent) elements.indentSize.value = savedPrefs.indent;
  if (savedPrefs.format) elements.outputFormat.value = savedPrefs.format;
  if (savedPrefs.sidebarHidden) {
    elements.mainContainer.classList.add('sidebar-hidden');
  }

  setupEditor(theme === 'dark');
  setupEventListeners();
  
  // Initial demo content
  const demoJson = {
    name: "JSON Formatter Premium",
    version: "2.0.0",
    features: ["Beautify", "Minify", "Copy", "Download"],
    settings: {
      theme: theme,
      indent: savedPrefs.indent || 4
    }
  };
  setEditorContent(JSON.stringify(demoJson, null, 4));
}

function setupEditor(isDark) {
  const extensions = [
    basicSetup,
    json(),
    placeholder('Paste your "messy" JSON here...'),
    search({ top: true }),
    highlightSelectionMatches()
  ];

  if (isDark) {
    extensions.push(oneDark);
  }

  editor = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: extensions
    }),
    parent: elements.container
  });
}

/**
 * Helpers para obtener y establecer contenido en CM6 (ya que no usamos el wrapper)
 */
function getEditorContent() {
  return editor.state.doc.toString();
}

function setEditorContent(text) {
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text }
  });
}

/**
 * Intenta convertir un string que parece JSON o un objeto JS en un objeto válido.
 */
function trySmartParse(text) {
  text = text.trim();
  if (!text) return null;

  // PASO 1 — Des-ofuscar/Des-empaquetar (P.A.C.K.E.R., URL encode, etc.)
  try { text = autoUnpack(text); } catch (e) { /* silencioso */ }

  // PASO 2 — Quitar comillas externas si se pegó el bloque como string literal
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.substring(1, text.length - 1);
  }

  // PASO 3 — Intento rápido de JSON estándar
  try { 
    return { data: JSON.parse(text), format: 'json' }; 
  } catch (_) { /* continuar */ }

  // PASO 4 — Preprocesador de objetos Python nativos
  // Proteger objetos que no tienen equivalente JSON (datetime, Decimal, <...>, u'...')
  // para que jsonrepair y JSON.parse no los malinterpreten.
  const protectedObjs = [];
  const protect = (match) => {
    protectedObjs.push(match);
    return `"${PY_OBJ_MARKER}${protectedObjs.length - 1}"`;
  };

  let preprocessed = text;
  
  // 4a. Strings unicode Python 2 (soporte para comillas escapadas)
  preprocessed = preprocessed
    .replace(/\bu'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => protect(`u'${inner}'`))
    .replace(/\bu"([^"\\]*(?:\\.[^"\\]*)*)"/g, (_, inner) => protect(`u"${inner}"`));

  // 4b & 4c. Objetos y Funciones (anidados, ej: <QuerySet [<Model: ...>]>, func(other()))
  let changed = true;
  while (changed) {
    const original = preprocessed;
    // Marcamos los objetos más internos primero (entre < > sin otros < > dentro)
    preprocessed = preprocessed.replace(/<[^<>]+>/g, protect);
    // Marcamos las funciones más internas primero
    preprocessed = preprocessed.replace(/[a-zA-Z_][a-zA-Z0-9_.]*\([^()]*\)/g, protect);
    changed = (preprocessed !== original);
  }

  preprocessed = preprocessed
    // 4d. Booleanos y None de Python → JSON
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null');

  // PASO 5 — jsonrepair: repara cualquier JSON-like (claves sin comillas,
  //          comillas simples, comas finales, comentarios, etc.)
  let repaired;
  try {
    repaired = jsonrepair(preprocessed);
  } catch (repairError) {
    // Si jsonrepair falla, lanzamos el error original de JSON.parse
    throw new SyntaxError(`No se pudo interpretar el contenido: ${repairError.message}`);
  }

  // PASO 6 — Parsear el JSON ya reparado
  const parsed = JSON.parse(repaired);

  // PASO 7 — Reinyectar los objetos Python originales (marcados en el paso 4)
  const inject = (obj) => {
    if (typeof obj === 'string') {
      // Limpiar posibles comillas de escape de jsonrepair si existen
      let markerCandidate = obj;
      if (obj.startsWith('"') && obj.endsWith('"') && obj.includes(PY_OBJ_MARKER)) {
        markerCandidate = obj.slice(1, -1);
      }

      if (markerCandidate.startsWith(PY_OBJ_MARKER)) {
        const indexStr = markerCandidate.replace(PY_OBJ_MARKER, '');
        const index = parseInt(indexStr, 10);
        
        if (isNaN(index) || index < 0 || index >= protectedObjs.length) {
          return obj;
        }

        let value = protectedObjs[index];
        // Resolvemos marcadores anidados (pueden estar con o sin comillas escapadas)
        const nestedRegex = new RegExp(`"?${PY_OBJ_MARKER}(\\d+)"?`, 'g');
        value = value.replace(nestedRegex, (_, idx) => {
          const res = inject(PY_OBJ_MARKER + idx);
          return res.startsWith(PY_OBJ_MARKER) ? res.slice(PY_OBJ_MARKER.length) : res;
        });
        return PY_OBJ_MARKER + value;
      }
    }
    if (Array.isArray(obj)) return obj.map(inject);
    if (obj !== null && typeof obj === 'object') {
      const newObj = {};
      for (const key in obj) {
        // Resolvemos el marcador pero MANTENEMOS el prefijo para que el stringifier sepa que es un objeto Python
        const resolvedKey = inject(key);
        newObj[resolvedKey] = inject(obj[key]);
      }
      return newObj;
    }
    return obj;
  };

  return { data: inject(parsed), format: protectedObjs.length > 0 ? 'python' : 'json' };
}

// --- Actions ---
function setStatus(message, type = '') {
  elements.statusText.textContent = message;
  elements.statusPanel.className = 'status-panel ' + type;
  setTimeout(() => {
    if (elements.statusText.textContent === message) {
      elements.statusText.textContent = 'Ready';
      elements.statusPanel.className = 'status-panel';
    }
  }, 4000);
}

function formatJson() {
  const content = getEditorContent();
  try {
    const { data, format: detectedFormat } = trySmartParse(content);
    if (!data) return;
    
    const indent = elements.indentSize.value;
    const selectedFormat = elements.outputFormat.value;
    const actualFormat = selectedFormat === 'auto' ? detectedFormat : selectedFormat;
    
    const spacer = indent === 'tabs' ? '\t' : parseInt(indent);
    
    let formatted;
    if (actualFormat === 'python') {
      formatted = stringifyPython(data, spacer);
    } else {
      const cleaned = stripMarkers(data);
      formatted = JSON.stringify(cleaned, null, spacer);
    }
    
    setEditorContent(formatted);
    setStatus(`Formatted as ${actualFormat.toUpperCase()} successfully`, 'ok');
  } catch (e) {
    setStatus('Invalid Format: ' + e.message, 'error');
  }
}

/**
 * Stringificador personalizado para formato de diccionario de Python
 */
function stringifyPython(obj, indent, level = 0) {
  const space = typeof indent === 'string' ? indent : ' '.repeat(indent);
  const currentIndent = space.repeat(level);
  const nextIndent = space.repeat(level + 1);

  if (obj === null) return 'None';
  if (obj === true) return 'True';
  if (obj === false) return 'False';

  if (typeof obj === 'string') {
    // Si es un objeto de Python marcado, quitamos la marca y devolvemos SIN comillas
    if (obj.startsWith(PY_OBJ_MARKER)) {
      return obj.slice(PY_OBJ_MARKER.length);
    }
    // Escapar comillas simples y envolver
    return `'${obj.replace(/'/g, "\\'")}'`;
  }

  if (typeof obj !== 'object') return obj.toString();

  const isArray = Array.isArray(obj);
  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';
  
  const entries = isArray 
    ? obj.map(item => stringifyPython(item, indent, level + 1))
    : Object.entries(obj).map(([key, val]) => {
        let pyKey;
        if (typeof key === 'string' && key.startsWith(PY_OBJ_MARKER)) {
          pyKey = key.slice(PY_OBJ_MARKER.length);
        } else {
          pyKey = typeof key === 'string' ? `'${key}'` : key;
        }
        return `${pyKey}: ${stringifyPython(val, indent, level + 1)}`;
      });

  if (entries.length === 0) return `${open}${close}`;

  return `${open}\n${nextIndent}${entries.join(',\n' + nextIndent)}\n${currentIndent}${close}`;
}

/**
 * Elimina los marcadores internos para cuando se exporta a JSON puro
 */
function stripMarkers(obj) {
  if (typeof obj === 'string') {
    if (obj.startsWith(PY_OBJ_MARKER)) {
      let val = obj.slice(PY_OBJ_MARKER.length);
      // Limpieza de tipos Python para JSON puro
      // u'texto' -> texto
      if (/^u['"]/.test(val)) return val.substring(2, val.length - 1);
      // Decimal('100') -> 100
      if (/^Decimal\(/.test(val)) {
        const m = val.match(/\(['"]?(.+?)['"]?\)/);
        if (m) return isNaN(m[1]) ? m[1] : parseFloat(m[1]);
      }
      return val;
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(stripMarkers);
  if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      const cleanKey = key.startsWith(PY_OBJ_MARKER) ? stripMarkers(key) : key;
      newObj[cleanKey] = stripMarkers(obj[key]);
    }
    return newObj;
  }
  return obj;
}

function minifyJson() {
  const content = getEditorContent();
  try {
    const { data } = trySmartParse(content);
    if (!data) return;
    const cleaned = stripMarkers(data);
    setEditorContent(JSON.stringify(cleaned));
    setStatus('Minified successfully', 'ok');
  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
  }
}

async function copyToClipboard() {
  const content = getEditorContent();
  try {
    await navigator.clipboard.writeText(content);
    setStatus('Copied to clipboard', 'ok');
  } catch (e) {
    setStatus('Failed to copy', 'error');
  }
}

function downloadJson() {
  const content = getEditorContent();
  if (!content) return;
  
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'formatted.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Download started', 'ok');
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    setEditorContent(event.target.result);
    setStatus('File loaded: ' + file.name, 'ok');
  };
  reader.readAsText(file);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  
  const content = getEditorContent();
  elements.container.innerHTML = '';
  setupEditor(newTheme === 'dark');
  setEditorContent(content);

  const prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  prefs.theme = newTheme;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

// --- Event Listeners ---
function setupEventListeners() {
  elements.formatBtn.addEventListener('click', formatJson);
  elements.minifyBtn.addEventListener('click', minifyJson);
  elements.copyBtn.addEventListener('click', copyToClipboard);
  elements.downloadBtn.addEventListener('click', downloadJson);
  elements.clearBtn.addEventListener('click', () => {
    setEditorContent('');
    setStatus('Editor cleared');
    // Focus the editor after clear
    const view = elements.container.querySelector('.cm-content');
    if (view) view.focus();
  });
  elements.fileUpload.addEventListener('change', handleFileUpload);
  elements.themeToggle.addEventListener('click', toggleTheme);
  
  elements.sidebarToggle.addEventListener('click', () => {
    elements.mainContainer.classList.toggle('sidebar-hidden');
    // Save preference
    const prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    prefs.sidebarHidden = elements.mainContainer.classList.contains('sidebar-hidden');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  });

  // Shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      formatJson();
    }
  });

  elements.indentSize.addEventListener('change', () => {
    const prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    prefs.indent = elements.indentSize.value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  });

  elements.outputFormat.addEventListener('change', () => {
    const prefs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    prefs.format = elements.outputFormat.value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  });
}

init();
