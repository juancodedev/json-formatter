import { autoUnpack } from '../unpackers.js';
import { jsonrepair } from 'jsonrepair';

export const PY_OBJ_MARKER = '___PY_INTERNAL_OBJ___';
const PY_TUPLE_MARKER = '___PY_TUPLE___';

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
    const newObj = {};
    for (const key in obj) {
      newObj[key] = unwrapTuples(obj[key]);
    }
    return newObj;
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
    if (char === '"' || char === "'") {
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

  // Ordenar por longitud descendente: el más largo suele ser el más relevante
  candidates.sort((a, b) => b.length - a.length);
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

  // PASO 0 — Extraer JSON de texto con contenido mezclado.
  // Si el texto no arranca con { o [ (o no termina con } o ]),
  // buscamos bloques JSON dentro del texto.
  const startsAsJson = text.startsWith('{') || text.startsWith('[');
  const endsAsJson = text.endsWith('}') || text.endsWith(']');
  if (!startsAsJson || !endsAsJson) {
    const candidates = extractJsonCandidates(text);
    if (candidates.length > 0) {
      text = candidates[0]; // Usar el candidato más largo
    }
  }

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

  // 4e. Convertir tuplas de Python (...) a objetos JSON marcados.
  //     Se envuelven como {"___PY_TUPLE___": [...]} para preservar la semántica de tupla.
  //     Solo grupos que NO están precedidos por un identificador (no son llamadas a función).
  let tuplePrev = '';
  while (tuplePrev !== preprocessed) {
    tuplePrev = preprocessed;
    preprocessed = preprocessed.replace(/\(([^()]*)\)/g, (match, inner, offset) => {
      const charBefore = offset > 0 ? preprocessed[offset - 1] : '';
      if (/[a-zA-Z0-9_]/.test(charBefore)) return match; // Function call
      return '{"' + PY_TUPLE_MARKER + '":[' + inner + ']}'; // Tuple → wrapped array
    });
  }

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

  return { data: unwrapTuples(inject(parsed)), format: protectedObjs.length > 0 ? 'python' : 'json' };
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
      // Agregar espacios alrededor de <...> para legibilidad (estilo beautifier.io)
      return raw.replace(/<([^<>]+)>/g, '< $1 >');
    }
    // Escapar comillas simples y envolver
    return `'${obj.replace(/'/g, "\\'")}'`;
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
    const newObj = {};
    for (const key in obj) {
      const cleanKey = key.startsWith(PY_OBJ_MARKER) ? stripMarkers(key) : key;
      newObj[cleanKey] = stripMarkers(obj[key]);
    }
    return newObj;
  }
  return obj;
}
