/**
 * Consolidación de Unpackers de beautifier.io para uso en el proyecto.
 * Soporta: P.A.C.K.E.R., Urlencode, MyObfuscate y JavascriptObfuscator.
 */

const P_A_C_K_E_R = {
    detect: (str) => {
        return (str.replace(/ /g, '').search(/eval\(function\(p,a,c,k,e,d|eval\(function\(p,a,c,k,e,r/) !== -1);
    },
    unpack: (str) => {
        const payload = str.replace(/^.*eval\(/, '').replace(/\)\s*$/, '');
        try {
            return eval('(' + payload + ')');
        } catch (e) {
            return str;
        }
    }
};

const Urlencoded = {
    detect: (str) => {
        return (str.search(/^%[0-9a-f]{2}/i) !== -1 || str.search(/%[0-9a-f]{2}%[0-9a-f]{2}/i) !== -1);
    },
    unpack: (str) => {
        try {
            return decodeURIComponent(str);
        } catch (e) {
            return str;
        }
    }
};

const JavascriptObfuscator = {
    detect: (str) => {
        return (str.search(/^var _0x[0-9a-f]+=['"]/) !== -1);
    },
    unpack: (str) => {
        if (JavascriptObfuscator.detect(str)) {
            try {
                // Es arriesgado hacer eval de código ofuscado desconocido, 
                // pero así es como funcionan estos unpackers.
                return eval(str + ';');
            } catch (e) {
                return str;
            }
        }
        return str;
    }
};

const MyObfuscate = {
    detect: (str) => {
        return (str.search(/^var _0x[0-9a-f]+=\[/) !== -1);
    },
    unpack: (str) => {
        return JavascriptObfuscator.unpack(str); // Lógica similar
    }
};

/**
 * Función unificada para intentar desempaquetar cualquier formato conocido.
 */
export function autoUnpack(text) {
    let unpacked = text.trim();
    let iterated = true;

    // Intentamos desempaquetar de forma recursiva (por si hay capas)
    while (iterated) {
        iterated = false;
        
        if (P_A_C_K_E_R.detect(unpacked)) {
            unpacked = P_A_C_K_E_R.unpack(unpacked);
            iterated = true;
            continue;
        }

        if (Urlencoded.detect(unpacked)) {
            unpacked = Urlencoded.unpack(unpacked);
            iterated = true;
            continue;
        }

        if (JavascriptObfuscator.detect(unpacked)) {
            const next = JavascriptObfuscator.unpack(unpacked);
            if (next !== unpacked) {
                unpacked = next;
                iterated = true;
            }
        }
    }

    return unpacked;
}
