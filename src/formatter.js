import { autoUnpack } from '../unpackers.js';
import { jsonrepair } from 'jsonrepair';

export const PY_OBJ_MARKER = '___PY_INTERNAL_OBJ___';
const PY_TUPLE_MARKER = '___PY_TUPLE___';

// Bloque entre corchetes sin estructura de datos: [INFO], [2024-01-01 10:00:00]
const LOG_TAG = /^\[[^[\]{}"',]*\]$/;
const PY_KEYWORDS = { True: 'true', False: 'false', None: 'null' };

function isLogTag(block) {
  return LOG_TAG.test(block) && Number.isNaN(Number(block.slice(1, -1)));
}

/**
 * Indica si la comilla en la posición i abre un string.
 * Un apóstrofe pegado a una palabra (Don't, O'Brien) no lo hace,
 * salvo los prefijos de string de Python (u'...', b'...').
 */
function opensString(text, i) {
  if (text[i] === '"') return true;
  if (text[i] !== "'") return false;
  if (!/\w/.test(text[i - 1] ?? '')) return true;
  return /(?:^|\W)[ub]$/i.test(text.slice(Math.max(0, i - 2), i));
}

/** Retorna el índice siguiente al cierre del string que abre en start. */
function skipString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/** Retorna el índice siguiente al '>' que balancea el '<' en start, o -1. */
function findReprEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '<') depth++;
    else if (text[i] === '>' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Retorna el índice siguiente al ')' que balancea el '(' en start, o -1. */
function findCallEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (opensString(text, i)) {
      i = skipString(text, i) - 1;
    } else if (text[i] === '(') {
      depth++;
    } else if (text[i] === ')' && --depth === 0) {
      return i + 1;
    }
  }
  return -1;
}

/** Retorna el índice donde termina el comentario JS que abre en start, o start si no hay. */
function skipComment(text, start) {
  if (text[start] !== '/') return start;
  if (text[start + 1] === '/') {
    const end = text.indexOf('\n', start);
    return end === -1 ? text.length : end;
  }
  if (text[start + 1] === '*') {
    const end = text.indexOf('*/', start);
    return end === -1 ? text.length : end + 2;
  }
  return start;
}

/**
 * Convierte la sintaxis exclusiva de Python a algo que jsonrepair entienda.
 * Recorre el texto token a token para que el contenido de los strings y
 * comentarios se copie intacto. Lo que no tiene equivalente JSON
 * (<...>, llamadas, u'...', b'...') se reemplaza usando protect.
 */
function convertPythonSyntax(text, protect) {
  const word = /[\w$][\w$.]*/y;
  const reprStart = /<\s*[A-Za-z_]/y;
  let out = '';
  let openTuples = 0;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === '"' || char === "'") {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }

    const commentEnd = skipComment(text, i);
    if (commentEnd > i) {
      out += text.slice(i, commentEnd);
      i = commentEnd;
      continue;
    }

    reprStart.lastIndex = i;
    if (reprStart.test(text)) {
      const end = findReprEnd(text, i);
      if (end !== -1) {
        out += protect(text.slice(i, end));
        i = end;
        continue;
      }
    }

    word.lastIndex = i;
    const match = word.exec(text);
    if (match) {
      const wordEnd = i + match[0].length;
      const next = text[wordEnd];
      let end = -1;
      if ((next === '"' || next === "'") && /^[ub]$/i.test(match[0])) {
        end = skipString(text, wordEnd);
      } else if (next === '(' && !/^\d/.test(match[0])) {
        end = findCallEnd(text, wordEnd);
      }
      if (end !== -1) {
        out += protect(text.slice(i, end));
        i = end;
      } else {
        out += Object.hasOwn(PY_KEYWORDS, match[0]) ? PY_KEYWORDS[match[0]] : match[0];
        i = wordEnd;
      }
      continue;
    }

    // Las tuplas se envuelven como {"___PY_TUPLE___": [...]} para preservar su semántica
    if (char === '(') {
      openTuples++;
      out += `{"${PY_TUPLE_MARKER}":[`;
    } else if (char === ')' && openTuples > 0) {
      openTuples--;
      out += ']}';
    } else {
      out += char;
    }
    i++;
  }

  return out;
}

/**
 * Convierte arrays marcados como tuplas de vuelta a una representación
 * que stringifyPython pueda detectar (obj.__isTuple = true).
 */
function unwrapTuples(obj) {
  if (Array.isArray(obj)) {
    const result = obj.map(unwrapTuples);
    result.__isTuple = false; // array normal por defecto
    return result;
  }
  if (obj !== null && typeof obj === 'object') {
    // Detectar wrapper de tupla: { "___PY_TUPLE___": [...] }
    if (obj[PY_TUPLE_MARKER] !== undefined) {
      const arr = unwrapTuples(obj[PY_TUPLE_MARKER]);
      arr.__isTuple = true;
      return arr;
    }
    return Object.fromEntries(Object.entries(obj).map(([key, val]) => [key, unwrapTuples(val)]));
  }
  return obj;
}

/**
 * Encuentra bloques JSON ({...} o [...]) dentro de texto arbitrario.
 * Balancea llaves/corchetes respetando strings (comillas simples y dobles).
 * Retorna los candidatos ordenados por longitud descendente.
 */
export function extractJsonCandidates(text) {
  const candidates = [];
  const stack = [];
  let start = -1;
  let inString = false;
  let stringChar = '';
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (char === '\\') {
        escapeNext = true;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    // Tanto comillas simples como dobles pueden delimitar strings
    if (opensString(text, i)) {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === '{' || char === '[') {
      if (stack.length === 0) start = i;
      stack.push(char);
    } else if (char === '}' || char === ']') {
      if (stack.length === 0) continue;
      const last = stack[stack.length - 1];
      const expectedClose = last === '{' ? '}' : ']';
      if (char === expectedClose) {
        stack.pop();
        if (stack.length === 0 && start >= 0) {
          const candidate = text.substring(start, i + 1);
          // Solo consideramos candidatos con contenido real (> 4 chars = más que " { } ")
          if (candidate.trim().length > 4) {
            candidates.push(candidate);
          }
          start = -1;
        }
      } else {
        // Mismatch de llave/corchete: reiniciamos el stack
        stack.length = 0;
        start = -1;
      }
    }
  }

  // Las etiquetas de log van al final; luego, el más largo suele ser el más relevante
  candidates.sort((a, b) => isLogTag(a) - isLogTag(b) || b.length - a.length);
  return candidates;
}

/**
 * Intenta convertir un string que parece JSON o un objeto JS en un objeto válido.
 * Retorna { data, format } donde format es 'json' o 'python'.
 * Lanza SyntaxError si no se puede interpretar.
 */
export function trySmartParse(text) {
  text = text.trim();
  if (!text) return null;

  // Un JSON válido no necesita ninguna transformación. Un string JSON sigue el
  // flujo normal porque puede contener JSON serializado.
  try {
    const data = JSON.parse(text);
    if (typeof data !== 'string') return { data, format: 'json' };
  } catch (_) { /* continuar */ }

  // PASO 0 — Extraer JSON de texto con contenido mezclado.
  // Si el texto no arranca con { o [ (o no termina con } o ]),
  // buscamos bloques JSON dentro del texto.
  const startsAsJson = text.startsWith('{') || text.startsWith('[');
  const endsAsJson = text.endsWith('}') || text.endsWith(']');
  const startsWithLogTag = isLogTag(text.slice(0, text.indexOf(']') + 1));
  if (!startsAsJson || !endsAsJson || startsWithLogTag) {
    const candidates = extractJsonCandidates(text);
    if (candidates.length > 0) {
      text = candidates[0]; // Usar el candidato más largo
    }
  }

  // PASO 1 — Des-ofuscar/Des-empaquetar (P.A.C.K.E.R., URL encode, etc.)
  //          Solo si el texto no es ya una estructura: sus valores no deben decodificarse.
  if (!/^[[{(]/.test(text)) {
    try { text = autoUnpack(text); } catch (e) { /* silencioso */ }
  }

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

  const preprocessed = convertPythonSyntax(text, protect);

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

        return PY_OBJ_MARKER + protectedObjs[index];
      }
    }
    if (Array.isArray(obj)) return obj.map(inject);
    if (obj !== null && typeof obj === 'object') {
      // Resolvemos el marcador pero MANTENEMOS el prefijo para que el stringifier sepa que es un objeto Python
      return Object.fromEntries(Object.entries(obj).map(([key, val]) => [inject(key), inject(val)]));
    }
    return obj;
  };

  return { data: unwrapTuples(inject(parsed)), format: protectedObjs.length > 0 ? 'python' : 'json' };
}

/** Serializa un string como literal de Python con comillas simples. */
function quotePython(str) {
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `'${escaped}'`;
}

/**
 * Stringificador personalizado para formato de diccionario de Python
 */
export function stringifyPython(obj, indent, level = 0) {
  const space = typeof indent === 'string' ? indent : ' '.repeat(indent);
  const currentIndent = space.repeat(level);
  const nextIndent = space.repeat(level + 1);

  if (obj === null) return 'None';
  if (obj === true) return 'True';
  if (obj === false) return 'False';

  if (typeof obj === 'string') {
    // Si es un objeto de Python marcado, quitamos la marca y devolvemos SIN comillas
    if (obj.startsWith(PY_OBJ_MARKER)) {
      const raw = obj.slice(PY_OBJ_MARKER.length);
      // Los literales u'...' y b'...' son strings: su contenido no se toca
      if (/^[ub]['"]/i.test(raw)) return raw;
      // Agregar espacios alrededor de <...> para legibilidad (estilo beautifier.io)
      return raw.replace(/<\s*([^<>]+?)\s*>/g, '< $1 >');
    }
    return quotePython(obj);
  }

  if (typeof obj !== 'object') return obj.toString();

  const isArray = Array.isArray(obj);
  const isTuple = isArray && obj.__isTuple === true;

  // Renderizar tuplas con sintaxis Python: (a, b) o (a,) o ()
  if (isTuple) {
    if (obj.length === 0) return '()';
    const entries = obj.map(item => stringifyPython(item, indent, level + 1));
    const trailing = obj.length === 1 ? ',' : '';
    // Para tuplas simples en una línea, formatear inline
    const inline = entries.join(', ') + trailing;
    // Si la tupla es simple (contenido corto), mostrarla inline
    const totalLen = inline.length;
    if (totalLen < 60 && !entries.some(e => e.includes('\n'))) {
      return `(${inline})`;
    }
    return `(\n${nextIndent}${entries.join(',\n' + nextIndent)}${trailing ? ',\n' + currentIndent : '\n' + currentIndent})`;
  }

  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';

  const entries = isArray
    ? obj.map(item => stringifyPython(item, indent, level + 1))
    : Object.entries(obj).map(([key, val]) => {
        let pyKey;
        if (typeof key === 'string' && key.startsWith(PY_OBJ_MARKER)) {
          pyKey = key.slice(PY_OBJ_MARKER.length);
        } else {
          pyKey = quotePython(key);
        }
        return `${pyKey}: ${stringifyPython(val, indent, level + 1)}`;
      });

  if (entries.length === 0) return `${open}${close}`;

  return `${open}\n${nextIndent}${entries.join(',\n' + nextIndent)}\n${currentIndent}${close}`;
}

/**
 * Elimina los marcadores internos para cuando se exporta a JSON puro
 */
export function stripMarkers(obj) {
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
    return Object.fromEntries(Object.entries(obj).map(([key, val]) => [stripMarkers(key), stripMarkers(val)]));
  }
  return obj;
}
