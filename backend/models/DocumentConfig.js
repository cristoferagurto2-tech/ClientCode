const mongoose = require('mongoose');

const documentConfigSchema = new mongoose.Schema({
  headers: {
    type: [String],
    default: [
      'Fecha',
      'Mes', 
      'DNI',
      'Nombre y Apellidos',
      'Celular',
      'Producto',
      'Monto',
      'Tasa',
      'Lugar',
      'Observación',
      'Ganancias'
    ]
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  }
}, {
  timestamps: true
});

// Método estático para obtener o crear la configuración
documentConfigSchema.statics.getConfig = async function() {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({
      headers: [
        'Fecha',
        'Mes',
        'DNI', 
        'Nombre y Apellidos',
        'Celular',
        'Producto',
        'Monto',
        'Tasa',
        'Lugar',
        'Observación',
        'Ganancias'
      ]
    });
  }
  return config;
};

module.exports = mongoose.model('DocumentConfig', documentConfigSchema);
