import { describe, it, expect } from 'vitest';
import { extractJsonCandidates, trySmartParse, stringifyPython, stripMarkers, PY_OBJ_MARKER } from './formatter.js';

// ============================================================================
// Helper: validates that a string parses successfully and returns expected data
// ============================================================================
function expectParse(input, expected, expectedFormat = 'json') {
  const result = trySmartParse(input);
  expect(result).not.toBeNull();
  expect(result.format).toBe(expectedFormat);
  // For repaired JSON, we compare the stripped data
  const cleaned = stripMarkers(result.data);
  expect(cleaned).toEqual(expected);
}

function expectParseError(input, messageContains = '') {
  expect(() => trySmartParse(input)).toThrow(SyntaxError);
  if (messageContains) {
    expect(() => trySmartParse(input)).toThrow(messageContains);
  }
}

// ============================================================================
// extractJsonCandidates
// ============================================================================
describe('extractJsonCandidates', () => {
  it('returns empty array for text without JSON', () => {
    expect(extractJsonCandidates('hello world')).toEqual([]);
    expect(extractJsonCandidates('')).toEqual([]);
  });

  it('extracts a single JSON object from mixed text', () => {
    const text = 'Log: user logged in\n{"name":"Juan","age":42}\nEnd of log.';
    const candidates = extractJsonCandidates(text);
    expect(candidates).toEqual(['{"name":"Juan","age":42}']);
  });

  it('extracts a JSON array from mixed text', () => {
    const text = 'Items: [1, 2, 3] done.';
    expect(extractJsonCandidates(text)).toEqual(['[1, 2, 3]']);
  });

  it('extracts the longest candidate when multiple exist', () => {
    const text = '{"a":1} and {"b":2,"c":3}';
    const candidates = extractJsonCandidates(text);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0]).toBe('{"b":2,"c":3}');
  });

  it('handles nested objects', () => {
    const text = 'outer {"a":{"b":{"c":1}}} done';
    expect(extractJsonCandidates(text)).toEqual(['{"a":{"b":{"c":1}}}']);
  });

  it('handles strings with braces inside', () => {
    const text = '{"key": "value with {braces} inside"} trailing';
    expect(extractJsonCandidates(text)).toEqual(['{"key": "value with {braces} inside"}']);
  });

  it('handles single-quoted strings', () => {
    const text = "{'key': 'value'}";
    expect(extractJsonCandidates(text)).toEqual(["{'key': 'value'}"]);
  });

  it('handles escaped quotes in strings', () => {
    const text = '{"quote": "she said \\"hello\\""}';
    expect(extractJsonCandidates(text)).toEqual(['{"quote": "she said \\"hello\\""}']);
  });

  it('resets on bracket mismatch', () => {
    const text = '{"users":["a","b","c"} trailing';
    // The } at the end mismatches with [, so no candidates found
    expect(extractJsonCandidates(text)).toEqual([]);
  });

  it('filters out empty candidates', () => {
    expect(extractJsonCandidates(' {} ')).toEqual([]);
    expect(extractJsonCandidates(' [] ')).toEqual([]);
  });
});

// ============================================================================
// Caso 1: JSON minificado
// ============================================================================
describe('Caso 1 — JSON minificado', () => {
  it('parses minified JSON object', () => {
    expectParse('{"name":"Juan","age":42,"city":"Santiago"}', {
      name: 'Juan',
      age: 42,
      city: 'Santiago'
    });
  });
});

// ============================================================================
// Caso 2: JSON con múltiples niveles
// ============================================================================
describe('Caso 2 — JSON con múltiples niveles', () => {
  it('parses nested JSON', () => {
    const input = '{"user":{"name":"Juan","contact":{"email":"juan@email.com","phone":"123456789"}}}';
    expectParse(input, {
      user: {
        name: 'Juan',
        contact: {
          email: 'juan@email.com',
          phone: '123456789'
        }
      }
    });
  });
});

// ============================================================================
// Caso 3: JSON con arrays
// ============================================================================
describe('Caso 3 — JSON con arrays', () => {
  it('parses JSON with arrays', () => {
    const input = '{"products":[{"id":1,"name":"Laptop"},{"id":2,"name":"Mouse"},{"id":3,"name":"Keyboard"}]}';
    expectParse(input, {
      products: [
        { id: 1, name: 'Laptop' },
        { id: 2, name: 'Mouse' },
        { id: 3, name: 'Keyboard' }
      ]
    });
  });
});

// ============================================================================
// Caso 4: JSON grande en una sola línea
// ============================================================================
describe('Caso 4 — JSON grande en una sola línea', () => {
  it('parses larger single-line JSON', () => {
    const input = '{"company":"Lawen Tech Solutions","employees":[{"id":1,"name":"Juan","role":"Developer"},{"id":2,"name":"Maria","role":"Designer"},{"id":3,"name":"Pedro","role":"QA"}],"active":true,"created":"2026-06-22"}';
    const result = trySmartParse(input);
    expect(result).not.toBeNull();
    expect(result.format).toBe('json');
    const data = stripMarkers(result.data);
    expect(data.company).toBe('Lawen Tech Solutions');
    expect(data.employees).toHaveLength(3);
    expect(data.active).toBe(true);
  });
});

// ============================================================================
// Caso 5: JSON con caracteres especiales
// ============================================================================
describe('Caso 5 — JSON con caracteres especiales', () => {
  it('handles newlines and escaped quotes in strings', () => {
    // Note: the actual input would have literal newlines escaped as \n in JSON
    const input = '{"message":"Hola mundo","description":"Línea 1\\nLínea 2\\nLínea 3","quote":"\\"JSON Formatter\\""}';
    expectParse(input, {
      message: 'Hola mundo',
      description: 'Línea 1\nLínea 2\nLínea 3',
      quote: '"JSON Formatter"'
    });
  });
});

// ============================================================================
// Caso 6: JSON con Unicode
// ============================================================================
describe('Caso 6 — JSON con Unicode', () => {
  it('handles Unicode characters', () => {
    const input = '{"country":"Chile","city":"Ñuñoa","emoji":"🚀","currency":"$"}';
    expectParse(input, {
      country: 'Chile',
      city: 'Ñuñoa',
      emoji: '🚀',
      currency: '$'
    });
  });
});

// ============================================================================
// Caso 7: JSON con valores nulos
// ============================================================================
describe('Caso 7 — JSON con valores nulos', () => {
  it('handles null values', () => {
    expectParse('{"name":"Juan","lastname":null,"email":null}', {
      name: 'Juan',
      lastname: null,
      email: null
    });
  });
});

// ============================================================================
// Caso 8: JSON con tipos variados
// ============================================================================
describe('Caso 8 — JSON con tipos variados', () => {
  it('handles mixed types', () => {
    expectParse('{"string":"text","number":123,"decimal":99.99,"boolean":true,"null_value":null}', {
      string: 'text',
      number: 123,
      decimal: 99.99,
      boolean: true,
      null_value: null
    });
  });
});

// ============================================================================
// Caso 9: JSON anidado complejo
// ============================================================================
describe('Caso 9 — JSON anidado complejo', () => {
  it('parses complex nested JSON', () => {
    const input = '{"order":{"id":"ORD-001","customer":{"name":"Juan","address":{"street":"Av. Siempre Viva","number":123}},"items":[{"product":"Laptop","qty":1},{"product":"Mouse","qty":2}]}}';
    const result = trySmartParse(input);
    expect(result).not.toBeNull();
    const data = stripMarkers(result.data);
    expect(data.order.id).toBe('ORD-001');
    expect(data.order.customer.address.street).toBe('Av. Siempre Viva');
    expect(data.order.items).toHaveLength(2);
  });
});

// ============================================================================
// Caso 10: Coma sobrante — jsonrepair
// ============================================================================
describe('Caso 10 — Coma sobrante', () => {
  it('repairs trailing comma', () => {
    expectParse('{"name":"Juan","age":42,}', {
      name: 'Juan',
      age: 42
    });
  });
});

// ============================================================================
// Caso 11: Comillas simples — jsonrepair
// ============================================================================
describe('Caso 11 — Comillas simples', () => {
  it('repairs single quotes to double quotes', () => {
    expectParse("{'name':'Juan','age':42}", {
      name: 'Juan',
      age: 42
    });
  });
});

// ============================================================================
// Caso 12: Llave faltante — jsonrepair
// ============================================================================
describe('Caso 12 — Llave faltante', () => {
  it('repairs missing closing brace', () => {
    expectParse('{"name":"Juan","age":42', {
      name: 'Juan',
      age: 42
    });
  });
});

// ============================================================================
// Caso 13: Comillas faltantes en clave — jsonrepair
// ============================================================================
describe('Caso 13 — Comillas faltantes en clave', () => {
  it('repairs unquoted keys', () => {
    expectParse('{name:"Juan","age":42}', {
      name: 'Juan',
      age: 42
    });
  });
});

// ============================================================================
// Caso 14: Array mal cerrado — jsonrepair
// ============================================================================
describe('Caso 14 — Array mal cerrado', () => {
  it('repairs mismatched bracket (} instead of ])', () => {
    expectParse('{"users":["Juan","Pedro","Maria"}', {
      users: ['Juan', 'Pedro', 'Maria']
    });
  });
});

// ============================================================================
// Caso 15: Valor booleano incorrecto (Python True)
// ============================================================================
describe('Caso 15 — Valor booleano incorrecto', () => {
  it('converts Python True to JSON true', () => {
    expectParse('{"active":True}', { active: true });
  });
});

// ============================================================================
// Caso 16: Diccionario Python
// ============================================================================
describe('Caso 16 — Diccionario Python', () => {
  it('parses Python dict with single quotes, True, and None', () => {
    const input = `{
    'name': 'Juan',
    'age': 42,
    'active': True,
    'email': None
}`;
    const result = trySmartParse(input);
    expect(result).not.toBeNull();
    // 'python' format only when Python-specific objects (u'...', <...>, func())
    // are detected. Single quotes + True/None → jsonrepair converts to valid JSON.
    expect(result.format).toBe('json');
    const data = stripMarkers(result.data);
    expect(data).toEqual({
      name: 'Juan',
      age: 42,
      active: true,
      email: null
    });
  });

  it('detects python format with real Python objects', () => {
    // Python dict with u'unicode' string triggers python detection
    const result = trySmartParse("{'status': u'ok', 'count': 1}");
    expect(result).not.toBeNull();
    expect(result.format).toBe('python');
  });

  it('stringifyPython outputs Python-style dict', () => {
    const result = trySmartParse("{'name':'Juan','active':True,'email':None}");
    expect(result).not.toBeNull();
    const output = stringifyPython(result.data, 4);
    expect(output).toContain("'name': 'Juan'");
    expect(output).toContain("True");
    expect(output).toContain("None");
  });
});

// ============================================================================
// Caso 17: Objeto JavaScript
// ============================================================================
describe('Caso 17 — Objeto JavaScript', () => {
  it('parses JS object with unquoted keys and boolean', () => {
    const input = `{
    name: "Juan",
    age: 42,
    active: true
}`;
    expectParse(input, {
      name: 'Juan',
      age: 42,
      active: true
    });
  });
});

// ============================================================================
// Caso 23: JSON extremadamente profundo
// ============================================================================
describe('Caso 23 — JSON extremadamente profundo', () => {
  it('handles deeply nested JSON', () => {
    const input = '{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":{"i":{"j":"value"}}}}}}}}}}';
    const result = trySmartParse(input);
    expect(result).not.toBeNull();
    const data = stripMarkers(result.data);
    // Traverse to the deepest value
    expect(data.a.b.c.d.e.f.g.h.i.j).toBe('value');
  });
});

// ============================================================================
// Caso 24: JSON con 100 elementos — prueba de rendimiento
// ============================================================================
describe('Caso 24 — JSON con 100 elementos (rendimiento)', () => {
  it('parses JSON with 100 items in an array', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const input = JSON.stringify({ items });
    const result = trySmartParse(input);
    expect(result).not.toBeNull();
    const data = stripMarkers(result.data);
    expect(data.items).toHaveLength(100);
    expect(data.items[0].id).toBe(1);
    expect(data.items[99].id).toBe(100);
  });

  it('parses JSON with 100 items in reasonable time', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const input = JSON.stringify({ items });
    const start = performance.now();
    const result = trySmartParse(input);
    const elapsed = performance.now() - start;
    expect(result).not.toBeNull();
    // Should complete in under 100ms
    expect(elapsed).toBeLessThan(100);
  });
});

// ============================================================================
// Caso 25: JSON mezclado con texto
// ============================================================================
describe('Caso 25 — JSON mezclado con texto', () => {
  it('extracts and parses JSON from surrounding text', () => {
    const input = `Información del usuario:

{"name":"Juan","age":42,"city":"Santiago"}

Fin del documento.`;
    expectParse(input, {
      name: 'Juan',
      age: 42,
      city: 'Santiago'
    });
  });

  it('extracts JSON from log-style output', () => {
    const input = '[INFO] Response received: {"status":200,"body":{"ok":true}} at 10:30am';
    expectParse(input, {
      status: 200,
      body: { ok: true }
    });
  });

  it('extracts JSON array preceded by text', () => {
    const input = 'Results: [1,2,3,4,5] End.';
    const result = trySmartParse(input);
    expect(result).not.toBeNull();
    const data = stripMarkers(result.data);
    expect(data).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles text with JSON but no surrounding brackets detected', () => {
    // The extraction should find the JSON object even though the text starts with letters
    const input = 'The config is {"port":3000,"host":"localhost"} and that is all';
    expectParse(input, {
      port: 3000,
      host: 'localhost'
    });
  });
});

// ============================================================================
// trySmartParse — edge cases
// ============================================================================
describe('trySmartParse — edge cases', () => {
  it('returns null for empty or whitespace input', () => {
    expect(trySmartParse('')).toBeNull();
    expect(trySmartParse('   ')).toBeNull();
    expect(trySmartParse('\n\t')).toBeNull();
  });

  it('handles JSON with leading/trailing whitespace', () => {
    expectParse('  {"a":1}  ', { a: 1 });
  });

  it('handles JSON number zero', () => {
    expectParse('{"value":0}', { value: 0 });
  });

  it('handles JSON boolean false', () => {
    expectParse('{"flag":false}', { flag: false });
  });

  it('handles empty object', () => {
    expectParse('{}', {});
  });

  it('handles empty array', () => {
    const result = trySmartParse('[]');
    expect(result).not.toBeNull();
    expect(stripMarkers(result.data)).toEqual([]);
  });

  it('handles array of primitives', () => {
    const result = trySmartParse('[1, "two", true, null]');
    expect(result).not.toBeNull();
    expect(stripMarkers(result.data)).toEqual([1, 'two', true, null]);
  });
});

// ============================================================================
// stripMarkers
// ============================================================================
describe('stripMarkers', () => {
  it('passes through plain objects unchanged', () => {
    const obj = { name: 'Juan', age: 42 };
    expect(stripMarkers(obj)).toEqual(obj);
  });

  it('strips Python object markers', () => {
    const obj = { [PY_OBJ_MARKER + '<Model: User>']: 'value' };
    const cleaned = stripMarkers(obj);
    expect(cleaned).toEqual({ '<Model: User>': 'value' });
  });

  it('handles nested marker objects', () => {
    const obj = {
      normal: 'text',
      python: PY_OBJ_MARKER + '<QuerySet [1,2,3]>'
    };
    const cleaned = stripMarkers(obj);
    expect(cleaned).toEqual({
      normal: 'text',
      python: '<QuerySet [1,2,3]>'
    });
  });
});

// ============================================================================
// stringifyPython
// ============================================================================
describe('stringifyPython', () => {
  it('formats objects as Python dict style', () => {
    const output = stringifyPython({ name: 'Juan', age: 42 }, 4);
    expect(output).toContain("'name': 'Juan'");
    expect(output).toContain("'age': 42");
  });

  it('renders None for null', () => {
    expect(stringifyPython(null, 2)).toBe('None');
  });

  it('renders True/False for booleans', () => {
    expect(stringifyPython(true, 2)).toBe('True');
    expect(stringifyPython(false, 2)).toBe('False');
  });

  it('handles arrays', () => {
    const output = stringifyPython([1, 2, 3], 2);
    expect(output).toContain('1');
    expect(output).toContain('2');
    expect(output).toContain('3');
    expect(output.startsWith('[')).toBe(true);
  });

  it('handles nested structures', () => {
    const output = stringifyPython({ user: { name: 'Juan', scores: [10, 20] } }, 2);
    expect(output).toContain("'user':");
    expect(output).toContain("'name': 'Juan'");
    expect(output).toContain('scores');
  });
});
