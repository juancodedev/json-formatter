import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { placeholder } from '@codemirror/view';
import { search, highlightSelectionMatches } from '@codemirror/search';

// --- State and Config ---
let editor;
const STORAGE_KEY = 'json_formatter_prefs';

const elements = {
  container: document.getElementById('editor-container'),
  indentSize: document.getElementById('indent-size'),
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

  try {
    return JSON.parse(text);
  } catch (e) {
    // Intento de reparación para formatos "relajados" (comunes al copiar de consola)
    try {
      const repaired = text
        .replace(/,\s*([\]}])/g, '$1') // Comas finales
        .replace(/(['"])?([a-zA-Z0-9_\-]+)(['"])?\s*:/g, '"$2":') // Claves sin comillas o con comillas simples
        .replace(/'/g, '"'); // Comillas simples en valores
      return JSON.parse(repaired);
    } catch (innerError) {
      throw e; // Lanzamos el error original si el reparado también falla
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
    const spacer = indent === 'tabs' ? '\t' : parseInt(indent);
    
    const formatted = JSON.stringify(parsed, null, spacer);
    setEditorContent(formatted);
    setStatus('Formatted successfully', 'ok');
  } catch (e) {
    setStatus('Invalid JSON/Object: ' + e.message, 'error');
  }
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
}

init();
