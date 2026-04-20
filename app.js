import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { placeholder } from '@codemirror/view';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { autoUnpack } from './unpackers.js';

// --- State and Config ---
let editor;
const STORAGE_KEY = 'json_formatter_prefs';
const PY_OBJ_MARKER = '___PY_OBJ___';

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
  
  // 0. Intentar des-ofuscar/des-empaquetar el texto automáticamente
  try {
    text = autoUnpack(text);
  } catch (e) {
    console.warn("Unpack failed, continuing with original text", e);
  }

  // Quitar comillas externas si se pegó el bloque como un string
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.substring(1, text.length - 1);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    try {
      const protectedObjs = [];
      // 1. Extraer y proteger objetos complejos (Decimal, datetime, <...>)
      // Esta regex busca funciones como Decimal(), datetime.datetime() y objetos de Django <...>
      let repaired = text.replace(/(Decimal\(['"]?[^'"]*['"]?\)|[a-zA-Z0-9_.]+\.[a-zA-Z0-9_]+\([^)]*\)|<[^>]+>)/g, (match) => {
        protectedObjs.push(match);
        return `"${PY_OBJ_MARKER}${protectedObjs.length - 1}"`;
      });

      // 2. Traducir tipos básicos y normalizar JSON
      repaired = repaired
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
        .replace(/\bNone\b/g, 'null')
        .replace(/'/g, '"') 
        .replace(/(['"])?([a-zA-Z0-9_\-]+)(['"])?\s*:/g, '"$2":')
        .replace(/,\s*([\]}])/g, '$1');

      const parsed = JSON.parse(repaired);

      // 3. Función recursiva para reinyectar los objetos originales marcados
      const inject = (obj) => {
        if (typeof obj === 'string' && obj.startsWith(PY_OBJ_MARKER)) {
          const index = parseInt(obj.replace(PY_OBJ_MARKER, ''));
          return PY_OBJ_MARKER + protectedObjs[index];
        }
        if (Array.isArray(obj)) return obj.map(inject);
        if (obj !== null && typeof obj === 'object') {
          const newObj = {};
          for (const key in obj) {
            newObj[key] = inject(obj[key]);
          }
          return newObj;
        }
        return obj;
      };

      return inject(parsed);
    } catch (innerError) {
      console.error("Smart Parse failed:", innerError);
      throw e; 
    }
  }
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
    const parsed = trySmartParse(content);
    if (!parsed) return;
    
    const indent = elements.indentSize.value;
    const format = elements.outputFormat.value;
    const spacer = indent === 'tabs' ? '\t' : parseInt(indent);
    
  let formatted;
  if (format === 'python') {
    formatted = stringifyPython(parsed, spacer);
  } else {
    // Si es JSON, limpiamos los marcadores antes de stringify
    const cleaned = stripMarkers(parsed);
    formatted = JSON.stringify(cleaned, null, spacer);
  }
    
    setEditorContent(formatted);
    setStatus(`Formatted as ${format.toUpperCase()} successfully`, 'ok');
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
      return obj.split(PY_OBJ_MARKER).join('');
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
        const pyKey = typeof key === 'string' ? `'${key}'` : key;
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
    return obj.startsWith(PY_OBJ_MARKER) ? obj.split(PY_OBJ_MARKER).join('') : obj;
  }
  if (Array.isArray(obj)) return obj.map(stripMarkers);
  if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = stripMarkers(obj[key]);
    }
    return newObj;
  }
  return obj;
}

function minifyJson() {
  const content = getEditorContent();
  try {
    const parsed = trySmartParse(content);
    if (!parsed) return;
    setEditorContent(JSON.stringify(parsed));
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
