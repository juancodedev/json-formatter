import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { placeholder } from '@codemirror/view';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { trySmartParse, stringifyPython, stripMarkers } from './src/formatter.js';

// --- State and Config ---
let editor;
const STORAGE_KEY = 'json_formatter_prefs';

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
