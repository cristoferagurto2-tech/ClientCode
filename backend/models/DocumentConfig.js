const mongoose = require('mongoose');

const documentConfigSchema = new mongoose.Schema({
  headers: [{
    key: { 
      type: String, 
      required: true,
      validate: {
        validator: function(v) {
          // Solo letras minúsculas, números y guiones bajos
          return /^[a-z0-9_]+$/.test(v);
        },
        message: 'Key solo puede contener letras minúsculas, números y guiones bajos'
      }
    },
    label: { type: String, required: true },
    type: { 
      type: String, 
      enum: ['text', 'select', 'monto', 'auto', 'select-fecha', 'percentage'],
      default: 'text'
    },
    options: [{ type: String }], // Para selects (Producto)
    order: { type: Number, default: 0 }
  }],
  updatedBy: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  }
}, {
  timestamps: true
});

// Función para generar key único
const generateUniqueKey = (label, existingKeys) => {
  let baseKey = label
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  if (!baseKey) baseKey = 'columna';
  
  let key = baseKey;
  let counter = 1;
  
  while (existingKeys.includes(key)) {
    key = `${baseKey}_${counter}`;
    counter++;
  }
  
  return key;
};

// Función para detectar tipo de campo
const detectFieldType = (label) => {
  const lower = label.toLowerCase();
  if (lower === 'fecha') return 'select-fecha';
  if (lower === 'mes') return 'auto';
  if (lower.includes('producto')) return 'select';
  if (lower.includes('monto')) return 'monto';
  if (lower === 'tasa') return 'percentage';
  if (lower.includes('ganancia')) return 'monto';
  return 'text';
};

// Función para migrar formato viejo a nuevo
const migrateHeaders = (oldHeaders) => {
  if (!Array.isArray(oldHeaders) || oldHeaders.length === 0) {
    return getDefaultHeaders();
  }
  
  // Si ya está en nuevo formato
  if (oldHeaders[0] && typeof oldHeaders[0] === 'object' && oldHeaders[0].key) {
    return oldHeaders;
  }
  
  // Migrar desde formato viejo (strings)
  const existingKeys = [];
  return oldHeaders.map((label, index) => {
    const key = generateUniqueKey(label, existingKeys);
    existingKeys.push(key);
    
    return {
      key,
      label,
      type: detectFieldType(label),
      order: index
    };
  });
};

// Headers por defecto
const getDefaultHeaders = () => [
  { key: 'fecha', label: 'Fecha', type: 'select-fecha', order: 0 },
  { key: 'mes', label: 'Mes', type: 'auto', order: 1 },
  { key: 'dni', label: 'DNI', type: 'text', order: 2 },
  { key: 'nombre', label: 'Nombre y Apellidos', type: 'text', order: 3 },
  { key: 'telefono', label: 'Celular', type: 'text', order: 4 },
  { key: 'producto', label: 'Producto', type: 'select', order: 5 },
  { key: 'monto', label: 'Monto', type: 'monto', order: 6 },
  { key: 'tasa', label: 'Tasa', type: 'percentage', order: 7 },
  { key: 'lugar', label: 'Lugar', type: 'text', order: 8 },
  { key: 'observacion', label: 'Observación', type: 'text', order: 9 },
  { key: 'ganancias', label: 'Ganancias', type: 'monto', order: 10 }
];

// Método estático para obtener o crear la configuración
documentConfigSchema.statics.getConfig = async function() {
  let config = await this.findOne();
  
  if (!config) {
    // Crear configuración inicial con nuevo formato
    config = await this.create({
      headers: getDefaultHeaders()
    });
    console.log('✅ Configuración inicial creada con nuevo formato');
  } else {
    // Verificar si necesita migración
    const needsMigration = config.headers.length > 0 && 
                           typeof config.headers[0] === 'string';
    
    if (needsMigration) {
      console.log('🔄 Migrando configuración al nuevo formato...');
      config.headers = migrateHeaders(config.headers);
      await config.save();
      console.log('✅ Migración completada');
    }
  }
  
  return config;
};

// Exportar funciones auxiliares para uso en otros archivos
documentConfigSchema.statics.migrateHeaders = migrateHeaders;
documentConfigSchema.statics.generateUniqueKey = generateUniqueKey;
documentConfigSchema.statics.detectFieldType = detectFieldType;

module.exports = mongoose.model('DocumentConfig', documentConfigSchema);
