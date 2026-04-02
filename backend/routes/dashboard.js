const express = require('express');
const Document = require('../models/Document');
const { protect, ownerOrAdmin, checkSubscription } = require('../middleware/auth');

const router = express.Router();

// Función para formatear números al formato peruano
// Convierte 5000 → "5.000" (sin decimales si son .00)
// Convierte 1234.56 → "1.234,56" (con decimales si existen)
function formatNumberES(value) {
  if (value === null || value === undefined || isNaN(value)) return '0';
  
  // Convertir a número
  const num = parseFloat(value);
  if (isNaN(num)) return '0';
  
  // Verificar si tiene decimales significativos
  const hasDecimals = num % 1 !== 0;
  
  // Separar parte entera y decimal
  const parts = num.toFixed(2).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];
  
  // Agregar separador de miles (punto cada 3 dígitos)
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  
  // Solo mostrar decimales si existen y no son .00
  if (hasDecimals && decimalPart !== '00') {
    // Eliminar ceros al final si los hay (ej: 50 → 5, 5.500,50 → 5.500,5)
    const cleanDecimal = decimalPart.replace(/0+$/, '');
    return `${formattedInteger},${cleanDecimal}`;
  }
  
  // Sin decimales
  return formattedInteger;
}

// Función para parsear números en formato peruano/español
// Formato estándar: punto (.) = separador de miles, coma (,) = decimal
// Ejemplos: 5.000 = 5000, 99,65 = 99.65, 1.234,56 = 1234.56
function parseNumberES(value) {
  if (!value || value === '' || value === '0' || value === '0,0' || value === '0.0') return 0;
  
  let str = value.toString().trim();
  
  // Limpiar símbolo de moneda si existe
  str = str.replace(/^S\/\s*/i, '');
  str = str.replace(/^S\//, '');
  
  // Si tiene ambos separadores (coma y punto)
  if (str.includes(',') && str.includes('.')) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      // Formato: 1.234,56 (coma es decimal, punto es miles)
      // Eliminar puntos, cambiar coma por punto
      const cleaned = str.replace(/\./g, '').replace(',', '.');
      const result = parseFloat(cleaned);
      return isNaN(result) ? 0 : result;
    } else {
      // Formato: 1,234.56 (punto es decimal, coma es miles)
      // Eliminar comas
      const cleaned = str.replace(/,/g, '');
      const result = parseFloat(cleaned);
      return isNaN(result) ? 0 : result;
    }
  }
  
  // Si solo tiene coma
  if (str.includes(',')) {
    const parts = str.split(',');
    if (parts.length === 2) {
      const afterComma = parts[1];
      // Si tiene 1-2 dígitos después de la coma → es decimal (99,65 = 99.65)
      // Si tiene 3 dígitos → podría ser miles, pero en formato español eso es raro
      // Asumimos que coma siempre es decimal en formato español puro
      const cleaned = str.replace(',', '.');
      const result = parseFloat(cleaned);
      return isNaN(result) ? 0 : result;
    } else {
      // Múltiples comas (error), eliminar todas
      const cleaned = str.replace(/,/g, '');
      const result = parseFloat(cleaned);
      return isNaN(result) ? 0 : result;
    }
  }
  
  // Si solo tiene punto
  if (str.includes('.')) {
    const parts = str.split('.');
    
    // Si tiene múltiples puntos → todos son separadores de miles (5.000.000)
    if (parts.length > 2) {
      const cleaned = str.replace(/\./g, '');
      const result = parseFloat(cleaned);
      return isNaN(result) ? 0 : result;
    }
    
    // Si tiene solo un punto
    if (parts.length === 2) {
      const afterDot = parts[1];
      
      // Si tiene exactamente 3 dígitos después del punto → es separador de miles (5.000 = 5000)
      if (afterDot.length === 3) {
        const cleaned = str.replace(/\./g, '');
        const result = parseFloat(cleaned);
        return isNaN(result) ? 0 : result;
      }
      
      // Si tiene 1-2 dígitos después del punto → es decimal (5.50 = 5.5)
      if (afterDot.length <= 2) {
        const result = parseFloat(str);
        return isNaN(result) ? 0 : result;
      }
      
      // Más de 3 dígitos → asumir miles (aunque es raro)
      const cleaned = str.replace(/\./g, '');
      const result = parseFloat(cleaned);
      return isNaN(result) ? 0 : result;
    }
  }
  
  // Sin separadores (número entero simple)
  const result = parseFloat(str);
  return isNaN(result) ? 0 : result;
}

// Productos disponibles
const productosList = [
  'Tarjeta de Crédito (TC)',
  '(ET)'
];

const mesesList = [
  'enero 2026', 'febrero 2026', 'marzo 2026', 'abril 2026',
  'mayo 2026', 'junio 2026', 'julio 2026', 'agosto 2026',
  'septiembre 2026', 'octubre 2026', 'noviembre 2026', 'diciembre 2026'
];

// @route   GET /api/dashboard/summary
// @desc    Obtener resumen general del dashboard
// @access  Private
router.get('/summary', protect, checkSubscription, async (req, res) => {
  try {
    const clientId = req.user._id;
    const isAdmin = req.user.role === 'admin';

    // Si es admin, obtener todos los documentos
    // Si es cliente, solo los suyos
    const query = isAdmin ? {} : { clientId };

    const documents = await Document.find(query);

    // Calcular estadísticas
    let totalClientes = 0;
    let montoTotal = 0;
    let totalGanancias = 0;
    let sumaPonderadaTasas = 0;
    let sumaMontos = 0;

    const processedRows = [];

    documents.forEach(doc => {
      const mergedData = doc.getMergedData();
      
      mergedData.data.forEach(row => {
        // Verificar si la fila tiene DNI (columna 2)
        if (row[2] && row[2].toString().trim() !== '') {
          totalClientes++;

          // Monto (columna 6)
          const monto = parseNumberES(row[6]);
          montoTotal += monto;
          sumaMontos += monto;

          // Tasa (columna 7)
          const tasa = parseNumberES(row[7]);
          sumaPonderadaTasas += tasa * monto;

          // Ganancias (columna 10)
          const ganancia = parseNumberES(row[10]);
          totalGanancias += ganancia;

          processedRows.push({
            fecha: row[0],
            mes: row[1],
            dni: row[2],
            nombre: row[3],
            producto: row[5],
            monto,
            tasa,
            ganancia,
            observacion: row[9]
          });
        }
      });
    });

    // Calcular promedio ponderado de tasas
    const promedioTasa = sumaMontos > 0 ? (sumaPonderadaTasas / sumaMontos) : 0;

    res.json({
      success: true,
      summary: {
        totalClientes,
        montoTotal: formatNumberES(montoTotal),
        montoTotalRaw: montoTotal, // Valor numérico para cálculos si es necesario
        promedioTasa: parseFloat(promedioTasa.toFixed(2)),
        totalGanancias: formatNumberES(totalGanancias),
        totalGananciasRaw: totalGanancias,
        totalDocuments: documents.length
      },
      trialWarning: req.trialWarning || null
    });
  } catch (error) {
    console.error('Error obteniendo resumen:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo resumen del dashboard'
    });
  }
});

// @route   GET /api/dashboard/by-months
// @desc    Obtener análisis por meses
// @access  Private
router.get('/by-months', protect, checkSubscription, async (req, res) => {
  try {
    const clientId = req.user._id;
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin ? {} : { clientId };

    const documents = await Document.find(query);

    // Inicializar datos por mes
    const porMeses = mesesList.map(mesCompleto => {
      const mes = mesCompleto.split(' ')[0]; // Extraer solo el nombre del mes
      return {
        mes: mes.charAt(0).toUpperCase() + mes.slice(1),
        clientes: 0,
        monto: 0,
        ganancias: 0
      };
    });

    documents.forEach(doc => {
      const mergedData = doc.getMergedData();
      const mesIndex = mesesList.findIndex(m => 
        m.toLowerCase().includes(doc.month.toLowerCase())
      );

      if (mesIndex >= 0) {
        mergedData.data.forEach(row => {
          if (row[2] && row[2].toString().trim() !== '') {
            porMeses[mesIndex].clientes++;

            porMeses[mesIndex].monto += parseNumberES(row[6]);
            porMeses[mesIndex].ganancias += parseNumberES(row[10]);
          }
        });
      }
    });

    // Formatear valores al formato peruano
    const porMesesFormatted = porMeses.map(mes => ({
      ...mes,
      monto: formatNumberES(mes.monto),
      ganancias: formatNumberES(mes.ganancias)
    }));

    res.json({
      success: true,
      porMeses: porMesesFormatted,
      trialWarning: req.trialWarning || null
    });
  } catch (error) {
    console.error('Error obteniendo análisis por meses:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo análisis por meses'
    });
  }
});

// @route   GET /api/dashboard/by-products
// @desc    Obtener conteo por productos
// @access  Private
router.get('/by-products', protect, checkSubscription, async (req, res) => {
  try {
    const clientId = req.user._id;
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin ? {} : { clientId };

    const documents = await Document.find(query);

    // Inicializar conteo por producto
    const porProductos = productosList.map(producto => ({
      producto,
      total: 0
    }));

    documents.forEach(doc => {
      const mergedData = doc.getMergedData();
      
      mergedData.data.forEach(row => {
        if (row[2] && row[2].toString().trim() !== '') {
          const productoCell = row[5] ? row[5].toString().toLowerCase().trim() : '';
          
          const productIndex = productosList.findIndex(p => 
            p.toLowerCase() === productoCell
          );
          
          if (productIndex >= 0) {
            porProductos[productIndex].total++;
          }
        }
      });
    });

    res.json({
      success: true,
      porProductos,
      trialWarning: req.trialWarning || null
    });
  } catch (error) {
    console.error('Error obteniendo análisis por productos:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo análisis por productos'
    });
  }
});

// @route   GET /api/dashboard/by-days/:month
// @desc    Obtener análisis por días de un mes específico
// @access  Private
router.get('/by-days/:month', protect, checkSubscription, async (req, res) => {
  try {
    const { month } = req.params;
    const clientId = req.user._id;

    const document = await Document.findOne({
      clientId,
      month,
      year: 2026
    });

    if (!document) {
      return res.json({
        success: true,
        porDias: []
      });
    }

    const mergedData = document.getMergedData();
    const resumenPorDia = {};

    mergedData.data.forEach(row => {
      const fecha = row[0]; // Columna 0 es la fecha
      if (!fecha || !row[2]) return;

      // Extraer día de la fecha (formato: 2026-01-15)
      const dia = fecha.toString().split('-')[2] || fecha.toString();

      if (!resumenPorDia[dia]) {
        resumenPorDia[dia] = {
          dia,
          clientes: 0,
          monto: 0,
          ganancias: 0
        };
      }

      resumenPorDia[dia].clientes++;

      resumenPorDia[dia].monto += parseNumberES(row[6]);
      resumenPorDia[dia].ganancias += parseNumberES(row[10]);
    });

    // Convertir a array y ordenar por día
    const porDias = Object.values(resumenPorDia)
      .sort((a, b) => parseInt(a.dia) - parseInt(b.dia))
      .map(dia => ({
        ...dia,
        monto: formatNumberES(dia.monto),
        ganancias: formatNumberES(dia.ganancias)
      }));

    res.json({
      success: true,
      porDias,
      trialWarning: req.trialWarning || null
    });
  } catch (error) {
    console.error('Error obteniendo análisis por días:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo análisis por días'
    });
  }
});

// @route   GET /api/dashboard/full
// @desc    Obtener dashboard completo (todas las estadísticas)
// @access  Private
router.get('/full', protect, checkSubscription, async (req, res) => {
  try {
    const clientId = req.user._id;
    const isAdmin = req.user.role === 'admin';
    const query = isAdmin ? {} : { clientId };

    const documents = await Document.find(query);

    // Calcular todas las estadísticas
    let totalClientes = 0;
    let montoTotal = 0;
    let totalGanancias = 0;
    let sumaPonderadaTasas = 0;
    let sumaMontos = 0;

    // Por meses
    const porMeses = mesesList.map(mesCompleto => {
      const mes = mesCompleto.split(' ')[0];
      return {
        mes: mes.charAt(0).toUpperCase() + mes.slice(1),
        clientes: 0,
        monto: 0,
        ganancias: 0
      };
    });

    // Por productos
    const porProductos = productosList.map(producto => ({
      producto,
      total: 0
    }));

    documents.forEach(doc => {
      const mergedData = doc.getMergedData();
      const mesIndex = mesesList.findIndex(m => 
        m.toLowerCase().includes(doc.month.toLowerCase())
      );

      mergedData.data.forEach(row => {
        if (row[2] && row[2].toString().trim() !== '') {
          // Totales generales
          totalClientes++;

          const monto = parseNumberES(row[6]);
          montoTotal += monto;
          sumaMontos += monto;

          const tasa = parseNumberES(row[7]);
          sumaPonderadaTasas += tasa * monto;

          const ganancia = parseNumberES(row[10]);
          totalGanancias += ganancia;

          // Por meses
          if (mesIndex >= 0) {
            porMeses[mesIndex].clientes++;
            porMeses[mesIndex].monto += monto;
            porMeses[mesIndex].ganancias += ganancia;
          }

          // Por productos
          const productoCell = row[5] ? row[5].toString().toLowerCase().trim() : '';
          const productIndex = productosList.findIndex(p => 
            p.toLowerCase() === productoCell
          );
          if (productIndex >= 0) {
            porProductos[productIndex].total++;
          }
        }
      });
    });

    // Calcular promedio ponderado
    const promedioTasa = sumaMontos > 0 ? (sumaPonderadaTasas / sumaMontos) : 0;

    // Formatear valores al formato peruano
    const porMesesFormatted = porMeses.map(mes => ({
      ...mes,
      monto: formatNumberES(mes.monto),
      ganancias: formatNumberES(mes.ganancias)
    }));

    res.json({
      success: true,
      dashboard: {
        totalClientes,
        montoTotal: formatNumberES(montoTotal),
        montoTotalRaw: montoTotal,
        promedioTasa: parseFloat(promedioTasa.toFixed(2)),
        totalGanancias: formatNumberES(totalGanancias),
        totalGananciasRaw: totalGanancias,
        totalDocuments: documents.length,
        porMeses: porMesesFormatted,
        porProductos
      },
      trialWarning: req.trialWarning || null
    });
  } catch (error) {
    console.error('Error obteniendo dashboard completo:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo dashboard completo'
    });
  }
});

module.exports = router;
