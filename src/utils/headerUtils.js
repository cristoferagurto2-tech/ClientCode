/**
 * Utilidades para manejo y corrección de headers de documentos
 * Soluciona el problema de headers corruptos guardados como strings JSON
 */

/**
 * Detecta y corrige un header corrupto
 * Maneja formatos: {'0':'F',...}, {"0":"F",...}, [object Object]
 * @param {string|object} header - Header a corregir
 * @returns {string} - Nombre de la columna corregido
 */
export const fixCorruptedHeader = (header) => {
  // Si es null o undefined, retornar string vacío
  if (!header) return 'Columna';
  
  // Si ya es objeto con label, devolver el label
  if (typeof header === 'object' && header !== null && header.label) {
    return header.label;
  }
  
  // Si es string, intentar corregir
  if (typeof header === 'string') {
    // Método 1: Detectar patrón {'0':'F', '1':'e', ...} o {"0":"F", ...}
    if (header.match(/['"]\d+['"]\s*:/)) {
      try {
        // Reemplazar comillas simples por dobles para JSON válido
        const jsonStr = header.replace(/'/g, '"');
        const obj = JSON.parse(jsonStr);
        // Unir todos los valores para reconstruir el nombre
        const reconstructed = Object.values(obj).join('');
        if (reconstructed && reconstructed.length > 0) {
          return reconstructed;
        }
      } catch (e) {
        // Si falla el parseo, continuar con siguiente método
        console.warn('No se pudo parsear header como JSON:', header);
      }
    }
    
    // Método 2: Si es [object Object]
    if (header === '[object Object]') {
      return 'Columna';
    }
    
    // Si es string normal, devolverlo tal cual
    return header;
  }
  
  // Fallback para cualquier otro tipo
  return String(header) || 'Columna';
};

/**
 * Genera una key única basada en el label
 * @param {string} label - Nombre de la columna
 * @param {string[]} existingKeys - Keys ya existentes para evitar duplicados
 * @returns {string} - Key única generada
 */
export const generateUniqueKey = (label, existingKeys = []) => {
  if (!label) return 'columna';
  
  let baseKey = label
    .toLowerCase()
    .normalize('NFD') // Normalizar caracteres especiales (tildes)
    .replace(/[\u0300-\u036f]/g, '') // Remover tildes
    .replace(/[^a-z0-9]/g, '_') // Reemplazar caracteres especiales por guiones bajos
    .replace(/_+/g, '_') // Evitar múltiples guiones consecutivos
    .replace(/^_|_$/g, ''); // Quitar guiones al inicio y final
  
  if (!baseKey) baseKey = 'columna';
  
  // Si ya existe, agregar número
  let key = baseKey;
  let counter = 1;
  
  while (existingKeys.includes(key)) {
    key = `${baseKey}_${counter}`;
    counter++;
  }
  
  return key;
};

/**
 * Detecta el tipo de campo basado en el nombre
 * @param {string} label - Nombre de la columna
 * @returns {string} - Tipo detectado (text, select, monto, percentage, auto, select-fecha)
 */
export const detectFieldType = (label) => {
  if (!label) return 'text';
  
  const lower = label.toLowerCase();
  
  if (lower === 'fecha') return 'select-fecha';
  if (lower === 'mes') return 'auto';
  if (lower.includes('producto')) return 'select';
  if (lower.includes('monto')) return 'monto';
  if (lower === 'tasa') return 'percentage';
  if (lower.includes('ganancia')) return 'monto';
  
  return 'text';
};

/**
 * Normaliza un header individual al formato estructurado
 * @param {string|object} header - Header a normalizar
 * @param {number} index - Índice de la columna
 * @param {string[]} existingKeys - Keys ya existentes
 * @returns {object} - Header normalizado {key, label, type, order}
 */
export const normalizeHeader = (header, index = 0, existingKeys = []) => {
  const label = fixCorruptedHeader(header);
  const key = generateUniqueKey(label, existingKeys);
  const type = detectFieldType(label);
  
  return {
    key,
    label,
    type,
    order: index
  };
};

/**
 * Normaliza un array completo de headers
 * @param {array} headers - Array de headers a normalizar
 * @returns {array} - Array de headers normalizados
 */
export const normalizeHeaders = (headers) => {
  if (!Array.isArray(headers) || headers.length === 0) {
    return [];
  }
  
  const existingKeys = [];
  
  return headers.map((header, index) => {
    const normalized = normalizeHeader(header, index, existingKeys);
    existingKeys.push(normalized.key);
    return normalized;
  });
};

/**
 * Renderiza un header de forma segura
 * Maneja tanto objetos como strings corruptos
 * @param {string|object} header - Header a renderizar
 * @param {number} index - Índice para fallback
 * @returns {string} - Texto seguro para renderizar
 */
export const renderHeaderLabel = (header, index = 0) => {
  // Si es objeto con label, usar el label
  if (typeof header === 'object' && header !== null && header.label) {
    return header.label;
  }
  
  // Si es string corrupto o normal, corregirlo
  if (typeof header === 'string') {
    return fixCorruptedHeader(header);
  }
  
  // Fallback con nombres por defecto
  const defaultNames = [
    'Fecha', 'Mes', 'DNI', 'Nombre y Apellidos', 'Teléfono',
    'Producto', 'Monto', 'Tasa', 'Lugar', 'Observación', 'Ganancias'
  ];
  
  return defaultNames[index] || `Columna ${index + 1}`;
};

export default {
  fixCorruptedHeader,
  generateUniqueKey,
  detectFieldType,
  normalizeHeader,
  normalizeHeaders,
  renderHeaderLabel
};
