const express = require('express');
const Document = require('../models/Document');
const { protect, ownerOrAdmin, checkSubscription } = require('../middleware/auth');

const router = express.Router();

// Headers por defecto (mismos que en tu frontend)
const defaultHeaders = [
  'Fecha', 'Mes', 'DNI', 'Nombre y Apellidos', 'Celular',
  'Producto', 'Monto', 'Tasa', 'Lugar', 'Observación', 'Ganancias'
];

// Productos disponibles
const productosList = [
  'Tarjeta de Crédito (TC)',
  '(ET)'
];

// @route   GET /api/documents/:month
// @desc    Obtener documento de un mes específico
// @access  Private
router.get('/:month', protect, checkSubscription, async (req, res) => {
  try {
    const { month } = req.params;
    const clientId = req.user._id;

    // Validar mes
    const validMonths = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    if (!validMonths.includes(month)) {
      return res.status(400).json({
        success: false,
        error: 'Mes no válido'
      });
    }

    // Buscar documento
    let document = await Document.findOne({
      clientId,
      month,
      year: 2026
    });

    // Si no existe, crear uno nuevo con datos vacíos
    if (!document) {
      const emptyData = Array(50).fill(null).map(() => Array(11).fill(''));
      
      document = await Document.create({
        clientId,
        month,
        year: 2026,
        headers: defaultHeaders,
        data: emptyData,
        completedData: []
      });
    }

    // Obtener datos fusionados
    const mergedData = document.getMergedData();

    res.json({
      success: true,
      document: {
        id: document._id,
        month: document.month,
        year: document.year,
        headers: mergedData.headers,
        data: mergedData.data,
        completedData: document.completedData,
        lastModified: document.lastModified,
        trialWarning: req.trialWarning || null
      }
    });
  } catch (error) {
    console.error('Error obteniendo documento:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo documento'
    });
  }
});

// @route   POST /api/documents/:month
// @desc    Crear o actualizar documento completo
// @access  Private
router.post('/:month', protect, checkSubscription, async (req, res) => {
  try {
    const { month } = req.params;
    const { headers, data, targetClientId } = req.body;
    // Si es admin y proporciona targetClientId, usar ese
    const clientId = (req.user.role === 'admin' && targetClientId)
      ? targetClientId
      : req.user._id;

    // Validar mes
    const validMonths = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    if (!validMonths.includes(month)) {
      return res.status(400).json({
        success: false,
        error: 'Mes no válido'
      });
    }

    // Buscar y actualizar o crear
    const document = await Document.findOneAndUpdate(
      { clientId, month, year: 2026 },
      {
        headers: headers || defaultHeaders,
        data: data || [],
        lastModified: Date.now()
      },
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      message: 'Documento guardado correctamente',
      document: {
        id: document._id,
        month: document.month,
        lastModified: document.lastModified
      }
    });
  } catch (error) {
    console.error('Error guardando documento:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando documento'
    });
  }
});

// @route   PUT /api/documents/:month/cell
// @desc    Actualizar una celda específica
// @access  Private
router.put('/:month/cell', protect, checkSubscription, async (req, res) => {
  try {
    const { month } = req.params;
    const { rowIndex, colIndex, value } = req.body;
    const clientId = req.user._id;

    if (rowIndex === undefined || colIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Debes proporcionar rowIndex y colIndex'
      });
    }

    // Buscar documento
    let document = await Document.findOne({
      clientId,
      month,
      year: 2026
    });

    // Si no existe, crearlo
    if (!document) {
      const emptyData = Array(50).fill(null).map(() => Array(11).fill(''));
      document = await Document.create({
        clientId,
        month,
        year: 2026,
        headers: defaultHeaders,
        data: emptyData,
        completedData: []
      });
    }

    // Buscar si ya existe un edit para esta celda
    const existingEditIndex = document.completedData.findIndex(
      edit => edit.rowIndex === rowIndex && edit.colIndex === colIndex
    );

    if (existingEditIndex >= 0) {
      // Actualizar valor existente
      document.completedData[existingEditIndex].value = value;
    } else {
      // Agregar nuevo edit
      document.completedData.push({
        rowIndex,
        colIndex,
        value
      });
    }

    document.lastModified = Date.now();
    await document.save();

    res.json({
      success: true,
      message: 'Celda actualizada',
      cell: { rowIndex, colIndex, value },
      trialWarning: req.trialWarning || null
    });
  } catch (error) {
    console.error('Error actualizando celda:', error);
    res.status(500).json({
      success: false,
      error: 'Error actualizando celda'
    });
  }
});

// @route   POST /api/documents/:month/bulk-update
// @desc    Actualizar múltiples celdas a la vez
// @access  Private
router.post('/:month/bulk-update', protect, checkSubscription, async (req, res) => {
  try {
    const { month } = req.params;
    const { edits } = req.body; // Array de {rowIndex, colIndex, value}
    const clientId = req.user._id;

    if (!Array.isArray(edits)) {
      return res.status(400).json({
        success: false,
        error: 'Edits debe ser un array'
      });
    }

    // Buscar documento
    let document = await Document.findOne({
      clientId,
      month,
      year: 2026
    });

    // Si no existe, crearlo
    if (!document) {
      const emptyData = Array(50).fill(null).map(() => Array(11).fill(''));
      document = await Document.create({
        clientId,
        month,
        year: 2026,
        headers: defaultHeaders,
        data: emptyData,
        completedData: []
      });
    }

    // Procesar cada edit
    edits.forEach(({ rowIndex, colIndex, value }) => {
      const existingEditIndex = document.completedData.findIndex(
        edit => edit.rowIndex === rowIndex && edit.colIndex === colIndex
      );

      if (existingEditIndex >= 0) {
        document.completedData[existingEditIndex].value = value;
      } else {
        document.completedData.push({ rowIndex, colIndex, value });
      }
    });

    document.lastModified = Date.now();
    await document.save();

    res.json({
      success: true,
      message: `${edits.length} celdas actualizadas`,
      updatedCount: edits.length,
      trialWarning: req.trialWarning || null
    });
  } catch (error) {
    console.error('Error en bulk update:', error);
    res.status(500).json({
      success: false,
      error: 'Error actualizando celdas'
    });
  }
});

// @route   GET /api/documents/:month/export
// @desc    Exportar documento a Excel (descarga)
// @access  Private
router.get('/:month/export', protect, checkSubscription, async (req, res) => {
  try {
    const { month } = req.params;
    const clientId = req.user._id;

    const document = await Document.findOne({
      clientId,
      month,
      year: 2026
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Documento no encontrado'
      });
    }

    const mergedData = document.getMergedData();

    // Preparar datos para exportación
    const exportData = {
      headers: mergedData.headers,
      data: mergedData.data,
      month: document.month,
      year: document.year,
      exportedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      data: exportData
    });
  } catch (error) {
    console.error('Error exportando documento:', error);
    res.status(500).json({
      success: false,
      error: 'Error exportando documento'
    });
  }
});

// @route   DELETE /api/documents/:month
// @desc    Eliminar documento
// @access  Private
router.delete('/:month', protect, checkSubscription, async (req, res) => {
  try {
    const { month } = req.params;
    const clientId = req.user._id;

    const result = await Document.deleteOne({
      clientId,
      month,
      year: 2026
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Documento no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Documento eliminado correctamente'
    });
  } catch (error) {
    console.error('Error eliminando documento:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando documento'
    });
  }
});

module.exports = router;
