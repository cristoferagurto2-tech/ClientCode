import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDocuments } from '../context/DocumentsContext';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

// Aplicar el plugin autoTable a jsPDF
import { applyPlugin } from 'jspdf-autotable';
applyPlugin(jsPDF);
import './DocumentEditor.css';

// NUEVO: Importaciones para el sistema de guardado final
import SaveFinalDataModal from './SaveFinalDataModal';
import { savePDFBackup, hasPDFBackup } from '../services/pdfBackupService';

// NUEVO: Importación para escáner de imágenes OCR
import ImageScanner from './ImageScanner';

// CORRECCIÓN: Importar utilidades de headers
import { 
  fixCorruptedHeader, 
  normalizeHeaders, 
  renderHeaderLabel,
  generateUniqueKey,
  detectFieldType 
} from '../utils/headerUtils';

export default function DocumentEditor({ month }) {
  const { user, isReadOnlyMode, getTrialStatus, isAdmin } = useAuth();
  
  // Verificar si el usuario puede descargar PDF (admin, suscritos, VIP o período de prueba activo)
  const canDownloadPDF = () => {
    if (isAdmin) return true;
    if (user?.isSubscribed) return true;
    const trialStatus = getTrialStatus(user?.email);
    // VIP tienen acceso permanente gratuito
    if (trialStatus?.isVIP) return true;
    // Permitir durante el período de prueba
    return trialStatus?.isTrialActive || false;
  };
  const { getMergedData, updateCompletedData, downloadOriginalFile, isDataCorrupted, isSyncing } = useDocuments();
  const [data, setData] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [editedData, setEditedData] = useState({});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [showColorsInPreview, setShowColorsInPreview] = useState(false);
  
  // NUEVO: Estados para el sistema de guardado final
  const [showSaveFinalModal, setShowSaveFinalModal] = useState(false);
  const [savingFinal, setSavingFinal] = useState(false);
  
  // NUEVO: Estado para el escáner OCR
  const [showImageScanner, setShowImageScanner] = useState(false);

  // NUEVO: Estado para mostrar/ocultar formulario móvil de agregar cliente
  const [showMobileForm, setShowMobileForm] = useState(false);

  // NUEVO: Estados para verificación de autenticación y modo solo lectura
  const [authChecked, setAuthChecked] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(true);
  const [trialStatusInfo, setTrialStatusInfo] = useState(null);

  // Estado para el color del PDF (por defecto verde)
  const [pdfColor, setPdfColor] = useState(() => {
    const savedColor = localStorage.getItem('pdfHeaderColor');
    return savedColor ? JSON.parse(savedColor) : [22, 163, 74]; // Verde por defecto
  });
  
  // Colores predefinidos
  const predefinedColors = {
    'Verde': [22, 163, 74],
    'Azul': [37, 99, 235],
    'Rojo': [239, 68, 68],
    'Naranja': [249, 115, 22],
    'Morado': [147, 51, 234],
    'Rosa': [236, 72, 153],
    'Gris': [75, 85, 99],
    'Negro': [0, 0, 0]
  };

  const clientId = user?.id;

  // Columnas exactas del Excel
  const defaultHeaders = [
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
  ];

  const productosList = [
    'Préstamo personal',
    'Crédito de consumo',
    'Tarjeta de crédito',
    'Préstamo vehicular (automotriz)',
    'Crédito hipotecario',
    'Microcrédito'
  ];

  const mesesList = [
    'enero 2026', 'febrero 2026', 'marzo 2026', 'abril 2026',
    'mayo 2026', 'junio 2026', 'julio 2026', 'agosto 2026',
    'septiembre 2026', 'octubre 2026', 'noviembre 2026', 'diciembre 2026'
  ];

  // Función para parsear montos correctamente manejando separadores de miles y decimales
  // Soporta tanto formato peruano (5.000,50) como formato directo (5.909)
  // Ejemplos: "5.000,50" -> 5000.50, "1.000" -> 1000, "5.909" -> 5.909
  const parseMonto = (value) => {
    if (!value || value === '') return 0;
    const str = String(value).trim();
    
    // Contar separadores
    const dotCount = (str.match(/\./g) || []).length;
    const commaCount = (str.match(/,/g) || []).length;
    
    // Si hay una coma, asumimos formato peruano/latinoamericano
    // Ejemplo: "5.000,50" o "500,50"
    if (commaCount > 0) {
      // Eliminar puntos (miles) y reemplazar coma por punto (decimal)
      const normalizedValue = str.replace(/\./g, '').replace(',', '.');
      return parseFloat(normalizedValue) || 0;
    }
    
    // Si solo hay puntos
    if (dotCount > 0) {
      // Si hay más de un punto, son separadores de miles (ej: "5.000")
      if (dotCount > 1) {
        return parseFloat(str.replace(/\./g, '')) || 0;
      }
      
      // Si hay solo un punto, verificar si es decimal o miles
      // Si hay 1-2 dígitos después del punto, es decimal (ej: "5.90")
      // Si hay 3 dígitos después del punto, es separador de miles (ej: "5.000")
      const parts = str.split('.');
      if (parts.length === 2) {
        const afterDot = parts[1];
        if (afterDot.length <= 2) {
          // Es decimal: "5.90" -> 5.90
          return parseFloat(str) || 0;
        } else {
          // Es separador de miles: "5.000" -> 5000
          return parseFloat(str.replace(/\./g, '')) || 0;
        }
      }
    }
    
    // Sin separadores, parsear directamente
    return parseFloat(str) || 0;
  };

  // Función para obtener los días del mes según calendario 2026
  const getDiasDelMes = (mes) => {
    const meses30 = ['abril', 'junio', 'septiembre', 'noviembre'];
    const mesLower = mes.toLowerCase();
    
    if (mesLower === 'febrero') {
      // 2026 no es bisiesto, febrero tiene 28 días
      return 28;
    } else if (meses30.includes(mesLower)) {
      return 30;
    } else {
      return 31;
    }
  };

  // Generar opciones de días para el mes actual
  const getOpcionesDias = () => {
    const diasEnMes = getDiasDelMes(month);
    const opciones = [];
    for (let i = 1; i <= diasEnMes; i++) {
      opciones.push(i.toString().padStart(2, '0'));
    }
    return opciones;
  };

  // Función para obtener la clase de color según la observación (solo para columna 9)
  const getObservacionColorClass = (row) => {
    if (!row || row.length < 10) return '';
    const observacion = String(row[9] || '').toLowerCase().trim();
    
    if (observacion.includes('cobro')) {
      return 'observacion-cobro';
    } else if (observacion.includes('pendiente') || observacion.includes('espera')) {
      return 'observacion-pendiente';
    } else if (observacion.includes('cancelado')) {
      return 'observacion-cancelado';
    }
    return '';
  };

  useEffect(() => {
    if (!clientId) return;
    
    const merged = getMergedData(clientId, month);
    if (merged) {
      // CORRECCIÓN: Usar normalizeHeaders del helper para migrar headers si están en formato viejo
      let docHeaders = merged.headers.length > 0 ? merged.headers : defaultHeaders;
      
      // NORMALIZACIÓN FORZADA: Siempre normalizar para asegurar que tengan la propiedad 'type'
      // Esto convierte strings a objetos {key, label, type, order} necesarios para los selectores
      if (docHeaders.length > 0) {
        console.log('🔄 Normalizando headers del documento con helper...');
        docHeaders = normalizeHeaders(docHeaders);
      }
      
      setHeaders(docHeaders);
      
      // Asegurar que haya al menos 50 filas de datos
      let tableData = [...merged.data];
      const numColumns = docHeaders.length;
      
      // Si hay menos de 50 filas, agregar filas vacías
      while (tableData.length < 50) {
        tableData.push(new Array(numColumns).fill(''));
      }
      
      // Asegurar que todas las filas tengan el número correcto de columnas
      tableData = tableData.map(row => {
        if (row.length < numColumns) {
          return [...row, ...new Array(numColumns - row.length).fill('')];
        }
        return row;
      });
      
      setData(tableData);
      
      const initialEdits = {};
      const mesAutomatico = month.toLowerCase() + ' 2026';
      tableData.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          let value = cell;
          // CORRECCIÓN: Usar tipo de columna en lugar de índice hardcodeado
          const column = docHeaders[colIndex];
          const columnType = (typeof column === 'object' && column !== null) ? column.type : 'text';
          
          // La columna con tipo 'auto' se asigna automáticamente (ej: Mes)
          if (columnType === 'auto') {
            value = mesAutomatico;
          }
          // NO formatear automáticamente - mantener los valores tal cual están
          // El usuario puede escribir: 3.000, 45.46, 50.000, etc.
          // Los valores se mantendrán exactamente como fueron escritos
          // Asegurar que el valor sea un string
          initialEdits[`${rowIndex}-${colIndex}`] = value !== null && value !== undefined ? String(value) : '';
        });
      });
      setEditedData(initialEdits);
    }
  }, [month, clientId, getMergedData]);

  // Función para formatear números con formato peruano: puntos para miles, coma para decimales
  // Solo muestra decimales si existen: 5000 -> "5.000", 5000.50 -> "5.000,50"
  const formatNumberPeruano = (value) => {
    if (!value || value === '' || value === '0' || value === 0) return '0';
    
    const str = String(value).trim();
    
    // Usar parseMonto para obtener el valor numérico correcto
    const numValue = parseMonto(str);
    
    if (isNaN(numValue)) return '0';
    
    // Verificar si tiene decimales significativos
    const hasDecimals = numValue % 1 !== 0;
    
    // Formatear manualmente para garantizar formato peruano
    // Separar parte entera y decimal
    const [integerPart, decimalPart] = numValue.toFixed(2).split('.');
    
    // Formatear la parte entera con puntos cada 3 dígitos (de derecha a izquierda)
    let formattedInteger = '';
    let count = 0;
    for (let i = integerPart.length - 1; i >= 0; i--) {
      if (count === 3) {
        formattedInteger = '.' + formattedInteger;
        count = 0;
      }
      formattedInteger = integerPart[i] + formattedInteger;
      count++;
    }
    
    // Solo mostrar decimales si existen
    if (hasDecimals) {
      return `${formattedInteger},${decimalPart}`;
    }
    
    return formattedInteger;
  };

  const handleCellChange = (rowIndex, colIndex, value) => {
    const key = `${rowIndex}-${colIndex}`;
    
    // Guardar el valor tal cual lo escribe el usuario (sin formatear automáticamente)
    // El formateo se hará al perder el foco o al guardar
    setEditedData(prev => ({
      ...prev,
      [key]: value
    }));

    // CORRECCIÓN: Si cambia la fecha (tipo 'select-fecha'), actualizar mes automáticamente (tipo 'auto')
    const currentColumn = headers[colIndex];
    const currentType = (typeof currentColumn === 'object' && currentColumn !== null) ? currentColumn.type : 'text';
    
    if (currentType === 'select-fecha' && value) {
      const fecha = new Date(value);
      if (!isNaN(fecha)) {
        const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const mesNombre = meses[fecha.getMonth()] + ' 2026';
        
        // Encontrar el índice de la columna con tipo 'auto' (Mes)
        const mesColIndex = headers.findIndex(h => {
          const type = typeof h === 'object' ? h.type : 'text';
          return type === 'auto';
        });
        
        if (mesColIndex !== -1) {
          setEditedData(prev => ({
            ...prev,
            [`${rowIndex}-${mesColIndex}`]: mesNombre
          }));
        }
      }
    }
  };

  // Función para formatear el valor al perder el foco (solo para Monto y Ganancias)
  // NOTA: Ahora NO se formatea automáticamente para permitir que el usuario escriba
  // los valores exactamente como desea (ej: 3.000, 45.46, 50.000)
  const handleCellBlur = (rowIndex, colIndex, value) => {
    // No hacer ningún formateo automático - mantener el valor tal cual lo escribió el usuario
    // El valor ya fue guardado en handleCellChange
  };

  const handleSave = async () => {
    if (!clientId) return;
    
    setSaving(true);
    
    // Guardar en el contexto (para el documento)
    Object.entries(editedData).forEach(([key, value]) => {
      const [rowIndex, colIndex] = key.split('-').map(Number);
      updateCompletedData(clientId, month, rowIndex, colIndex, value);
    });

    // Actualizar el estado local data para que se vean los cambios en la página
    setData(prevData => {
      const newData = [...prevData];
      Object.entries(editedData).forEach(([key, value]) => {
        const [rowIndex, colIndex] = key.split('-').map(Number);
        if (newData[rowIndex]) {
          newData[rowIndex] = [...newData[rowIndex]];
          newData[rowIndex][colIndex] = value;
        }
      });
      return newData;
    });

    await new Promise(resolve => setTimeout(resolve, 500));
    
    setSaving(false);
    setLastSaved(new Date());
  };

  // Función para añadir una nueva fila
  const handleAddRow = () => {
    setData(prevData => {
      const newRow = new Array(headers.length).fill('');
      return [...prevData, newRow];
    });
  };

  // Función para eliminar la última fila
  const handleRemoveRow = () => {
    setData(prevData => {
      if (prevData.length <= 1) return prevData;
      return prevData.slice(0, -1);
    });
  };

  // NUEVO: Función para agregar cliente desde formulario móvil
  const handleAddClientFromMobile = (clientData) => {
    setData(prevData => {
      // Crear nueva fila con los datos del formulario
      const newRow = [
        clientData.fecha || '',           // Fecha (columna 0)
        month.toLowerCase() + ' 2026',    // Mes (columna 1) - automático
        clientData.dni || '',             // DNI (columna 2)
        clientData.nombre || '',          // Nombre y Apellidos (columna 3)
        clientData.celular || '',         // Celular (columna 4)
        clientData.producto || '',        // Producto (columna 5)
        clientData.monto || '',           // Monto (columna 6)
        clientData.tasa || '',            // Tasa (columna 7)
        clientData.lugar || '',           // Lugar (columna 8)
        clientData.observacion || '',     // Observación (columna 9)
        clientData.ganancias || ''        // Ganancias (columna 10)
      ];
      return [...prevData, newRow];
    });
    
    // Cerrar el formulario
    setShowMobileForm(false);
  };

  // NUEVO: Función para guardar datos finales del mes (genera PDF y lo almacena)
  const handleSaveFinalData = async () => {
    if (!clientId || !data) return;
    
    setSavingFinal(true);
    
    try {
      // Generar el PDF usando la misma lógica que handleDownload
      const doc = new jsPDF('landscape');
      const currentYear = 2026;
      
      // Configurar metadatos
      doc.setProperties({
        title: `ClientCode - ${month} ${currentYear}`,
        subject: 'Documento de Clientes',
        author: user?.name || 'ClientCode',
        keywords: 'clientes, documento, registro',
        creator: 'ClientCode App'
      });

      // Color del encabezado
      const pdfHeaderColor = pdfColor;

      // Obtener datos actualizados
      const tableData = data.map((row, rowIndex) => {
        return row.map((cell, colIndex) => {
          const key = `${rowIndex}-${colIndex}`;
          return editedData[key] !== undefined ? editedData[key] : cell;
        });
      }).filter(row => row[2] && row[2] !== '');

      // PORTADA
      doc.setFontSize(24);
      doc.setTextColor(pdfHeaderColor[0], pdfHeaderColor[1], pdfHeaderColor[2]);
      doc.text('ClientCode', 148, 50, { align: 'center' });
      
      doc.setFontSize(16);
      doc.setTextColor(80, 80, 80);
      doc.text(`Documento de Clientes - ${month} ${currentYear}`, 148, 70, { align: 'center' });
      
      doc.setFontSize(12);
      doc.text(`Generado por: ${user?.name || 'Usuario'}`, 148, 90, { align: 'center' });
      doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 148, 100, { align: 'center' });

      // PÁGINA 2: DATOS
      if (tableData.length > 0) {
        doc.addPage();
        
        // Título
        doc.setFontSize(14);
        doc.setTextColor(pdfHeaderColor[0], pdfHeaderColor[1], pdfHeaderColor[2]);
        doc.text(`Datos de ${month} ${currentYear}`, 148, 15, { align: 'center' });

        // Configurar colores SOLO para la columna de observaciones (índice 9)
        const getObservacionColor = (observacion) => {
          const obs = String(observacion || '').toLowerCase().trim();
          if (obs.includes('cobro')) return [254, 243, 199]; // Amarillo
          if (obs.includes('pendiente') || obs.includes('espera')) return [220, 252, 231]; // Verde
          if (obs.includes('cancelado')) return [254, 226, 226]; // Rojo
          return [255, 255, 255]; // Blanco
        };

        doc.autoTable({
          head: [headers],
          body: tableData,
          startY: 25,
          theme: 'grid',
          styles: { 
            fontSize: 8, 
            cellPadding: 2,
            overflow: 'linebreak',
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0]
          },
          headStyles: { 
            fillColor: pdfHeaderColor,
            textColor: 255,
            fontStyle: 'bold'
          },
          didParseCell: function(data) {
            // Aplicar color SOLO a la columna de observaciones (índice 9)
            if (data.cell.section === 'body' && data.column.index === 9) {
              const observacion = data.cell.raw;
              const color = getObservacionColor(observacion);
              if (color && color[0] !== 255) { // Solo si no es blanco
                data.cell.styles.fillColor = color;
              }
            }
          },
          margin: { top: 25 }
        });

        // Pie de página
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(`Documento confidencial - Generado por ClientCode`, 148, 200, { align: 'center' });
        doc.text(`Página 2 de ${pageCount}`, 280, 200, { align: 'right' });

        // PÁGINA 3: DASHBOARD
        doc.addPage();
        
        // Título del dashboard
        doc.setFontSize(18);
        doc.setTextColor(pdfHeaderColor[0], pdfHeaderColor[1], pdfHeaderColor[2]);
        doc.text('Dashboard - Análisis de Datos', 148, 15, { align: 'center' });

        // Calcular estadísticas
        const totalClientes = tableData.length;
        const montoTotal = tableData.reduce((sum, row) => sum + (parseFloat(row[6]) || 0), 0);
        const totalGanancias = tableData.reduce((sum, row) => sum + (parseFloat(row[10]) || 0), 0);

        // Resumen General
        doc.setFontSize(12);
        doc.setTextColor(80, 80, 80);
        doc.text('Resumen General', 20, 30);

        const resumenData = [
          ['Total de Clientes', totalClientes.toString()],
          ['Monto Total (S/)', `S/ ${formatNumberPeruano(montoTotal)}`],
          ['Total Ganancias (S/)', `S/ ${formatNumberPeruano(totalGanancias)}`]
        ];

        doc.autoTable({
          body: resumenData,
          startY: 35,
          theme: 'grid',
          styles: { fontSize: 10 },
          columnStyles: {
            0: { fillColor: pdfHeaderColor, textColor: 255, fontStyle: 'bold' }
          }
        });

        // PÁGINA 4: PRODUCTOS Y CONTEO
        doc.addPage();
        
        // Título de productos
        doc.setFontSize(18);
        doc.setTextColor(pdfHeaderColor[0], pdfHeaderColor[1], pdfHeaderColor[2]);
        doc.text('Productos y Conteo', 148, 15, { align: 'center' });

        // Calcular conteo de productos
        const productosConteo = productosList.map(prod => {
          const count = tableData.filter(row => row[5] === prod).length;
          return { producto: prod, total: count };
        });

        const productosData = productosConteo.map(p => [p.producto, p.total.toString()]);

        doc.autoTable({
          head: [['Producto', 'Total']],
          body: productosData,
          startY: 25,
          theme: 'grid',
          styles: { fontSize: 10 },
          headStyles: { 
            fillColor: pdfHeaderColor, 
            textColor: 255, 
            fontStyle: 'bold' 
          },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 80, halign: 'center' }
          }
        });
      }

      // Calcular conteo de productos para guardar en metadata
      const productosConteo = productosList.map(prod => {
        const count = tableData.filter(row => row[5] === prod).length;
        return { producto: prod, total: count };
      }).filter(p => p.total > 0);

      // Convertir PDF a base64
      const pdfBase64 = doc.output('datauristring');
      
      // Guardar en localStorage
      const year = 2026;
      const result = savePDFBackup(clientId, month, year, pdfBase64, {
        totalClientes: data.filter(row => row[2] && row[2] !== '').length,
        montoTotal: data.reduce((sum, row) => sum + (parseFloat(row[6]) || 0), 0),
        ganancias: data.reduce((sum, row) => sum + (parseFloat(row[10]) || 0), 0),
        productos: productosConteo,
        tableData: tableData // Guardar datos completos de las filas para mostrar observaciones en el historial
      });

      if (result.success) {
        alert(`✅ Datos de ${month} ${year} guardados correctamente en el historial.`);
        setShowSaveFinalModal(false);
      } else {
        alert('❌ Error al guardar: ' + result.error);
      }
    } catch (error) {
      console.error('Error al guardar datos finales:', error);
      alert('❌ Error al generar el documento: ' + error.message);
    } finally {
      setSavingFinal(false);
    }
  };

  // NUEVO: Función para manejar datos extraídos del escáner OCR (múltiples registros)
  const handleScannedData = async (scannedData) => {
    // Ahora scannedData es un array de registros
    const records = Array.isArray(scannedData) ? scannedData : [scannedData];
    
    if (records.length === 0) {
      alert('⚠️ No se detectaron clientes válidos en la imagen.');
      return;
    }
    
    // Crear múltiples filas, una por cada cliente detectado
    const newRows = records.map(record => [
      record.fecha || new Date().toISOString().split('T')[0], // Fecha (YYYY-MM-DD)
      month.toLowerCase() + ' 2026',                           // ✅ CORREGIDO: Mes con año
      record.dni || '',                                         // DNI
      record.nombre || '',                                      // Nombre y Apellidos
      record.celular || '',                                     // Celular
      record.producto || '',                                    // Producto
      record.monto || '',                                       // Monto
      record.tasa || '',                                        // Tasa
      record.lugar || '',                                       // Lugar
      record.observacion || '',                                 // Observación (del OCR)
      record.ganancias || ''                                    // Ganancias (del OCR)
    ]);

    // ✅ BUSCAR FILAS VACÍAS PRIMERO
    const currentData = data || [];
    const emptyRowIndices = [];
    
    // Identificar filas vacías (donde DNI, Nombre y Celular están vacíos)
    currentData.forEach((row, index) => {
      const dni = editedData[`${index}-2`] !== undefined ? editedData[`${index}-2`] : row[2];
      const nombre = editedData[`${index}-3`] !== undefined ? editedData[`${index}-3`] : row[3];
      const celular = editedData[`${index}-4`] !== undefined ? editedData[`${index}-4`] : row[4];
      
      if ((!dni || dni === '') && (!nombre || nombre === '') && (!celular || celular === '')) {
        emptyRowIndices.push(index);
      }
    });
    
    // Preparar datos para actualizar
    const newEditedData = {};
    const rowsToAdd = [];
    const rowMappings = []; // Mapeo: índice del registro OCR -> índice de la fila en la tabla
    
    newRows.forEach((row, recordIndex) => {
      if (recordIndex < emptyRowIndices.length) {
        // Usar fila vacía existente
        const targetRowIndex = emptyRowIndices[recordIndex];
        rowMappings.push({ recordIndex, targetRowIndex, isNew: false });
        
        row.forEach((cell, colIndex) => {
          const key = `${targetRowIndex}-${colIndex}`;
          newEditedData[key] = cell !== null && cell !== undefined ? String(cell) : '';
        });
      } else {
        // Agregar nueva fila al final
        rowsToAdd.push(row);
        rowMappings.push({ recordIndex, targetRowIndex: currentData.length + rowsToAdd.length - 1, isNew: true });
      }
    });
    
    // Actualizar estados
    setData(prevData => {
      const baseData = [...(prevData || [])];
      
      // Llenar filas vacías existentes
      rowMappings.filter(m => !m.isNew).forEach(mapping => {
        const rowData = newRows[mapping.recordIndex];
        if (baseData[mapping.targetRowIndex]) {
          baseData[mapping.targetRowIndex] = [...rowData];
        }
      });
      
      // Agregar nuevas filas al final
      return [...baseData, ...rowsToAdd];
    });
    
    setEditedData(prev => ({ ...prev, ...newEditedData }));
    
    // ✅ CRÍTICO: Guardar en el contexto para que persistan los datos
    const clientId = user?.id;
    if (clientId) {
      console.log('Guardando datos OCR en contexto:', { clientId, month, rowMappings, newRows });
      for (const mapping of rowMappings) {
        const rowData = newRows[mapping.recordIndex];
        for (let colIndex = 0; colIndex < rowData.length; colIndex++) {
          const value = rowData[colIndex];
          if (value) {
            await updateCompletedData(clientId, month, mapping.targetRowIndex, colIndex, value);
          }
        }
      }
    }
    
    console.log('Datos OCR guardados. Estado actual:', { data: newRows, editedData: newEditedData });
    
    // Mostrar mensaje de éxito con información de qué se hizo
    const filasLlenadas = rowMappings.filter(m => !m.isNew).length;
    const filasNuevas = rowMappings.filter(m => m.isNew).length;
    
    let mensaje = `✅ ${records.length} cliente(s) agregado(s) correctamente desde la imagen:\n\n`;
    
    if (filasLlenadas > 0) {
      mensaje += `📋 ${filasLlenadas} fila(s) vacía(s) llenada(s)\n`;
    }
    if (filasNuevas > 0) {
      mensaje += `➕ ${filasNuevas} fila(s) nueva(s) agregada(s) al final\n`;
    }
    
    mensaje += `\n${records.map((r, i) => `${i + 1}. ${r.nombre || 'Cliente sin nombre'} (DNI: ${r.dni || 'N/A'})`).join('\n')}`;
    mensaje += `\n\nPuedes editar los campos si es necesario antes de guardar.`;
    
    alert(mensaje);
  };

  // Función para obtener el color según la observación
  const getRowColor = (row) => {
    const observacion = String(row[9] || '').toLowerCase().trim();
    
    if (observacion.includes('cobro')) {
      return '#fef3c7'; // Amarillo
    } else if (observacion.includes('pendiente') || observacion.includes('espera')) {
      return '#dcfce7'; // Verde
    } else if (observacion.includes('cancelado')) {
      return '#fee2e2'; // Rojo
    }
    return 'transparent';
  };
  
  // Función para cambiar el color del PDF
  const handleColorChange = (colorName, colorRGB) => {
    setPdfColor(colorRGB);
    localStorage.setItem('pdfHeaderColor', JSON.stringify(colorRGB));
    alert(`Color cambiado a ${colorName}. Los cambios se verán en el próximo PDF.`);
  };

  // Calcular análisis tipo Dashboard
  const dashboard = useMemo(() => {
    // Obtener datos actuales con ediciones
    const currentData = data ? data.map((row, rowIndex) => {
      return row.map((cell, colIndex) => {
        const key = `${rowIndex}-${colIndex}`;
        return editedData[key] !== undefined ? editedData[key] : cell;
      });
    }).filter(row => row[2] && row[2] !== '') : []; // Filtrar filas con DNI (columna 2)

    if (currentData.length === 0) {
      return {
        totalClientes: 0,
        montoTotal: 0,
        promedioTasa: 0,
        totalGanancias: 0,
        porMeses: mesesList.map(m => ({ mes: m, clientes: 0, monto: 0, ganancias: 0 })),
        porProductos: productosList.map(p => ({ producto: p, total: 0 }))
      };
    }

    // Resumen General
    const totalClientes = currentData.length;
    const montoTotal = currentData.reduce((sum, row) => {
      const monto = parseMonto(row[6]);
      return sum + monto;
    }, 0);
    
    // Calcular promedio ponderado de tasas (ponderado por el monto)
    const tasasConMontos = currentData.map(row => {
      const tasa = parseMonto(row[7]);
      const monto = parseMonto(row[6]);
      return { tasa, monto };
    }).filter(item => item.tasa > 0 && item.monto > 0);
    
    const totalMonto = tasasConMontos.reduce((sum, item) => sum + item.monto, 0);
    const sumaPonderada = tasasConMontos.reduce((sum, item) => sum + (item.tasa * item.monto), 0);
    const promedioTasa = totalMonto > 0 ? (sumaPonderada / totalMonto) : 0;
    
    const totalGanancias = currentData.reduce((sum, row) => {
      const ganancia = parseMonto(row[10]);
      return sum + ganancia;
    }, 0);

    // Resumen por Meses
    const porMeses = mesesList.map(mes => {
      const filasMes = currentData.filter(row => {
        const mesRow = String(row[1]).toLowerCase().trim();
        return mesRow === mes;
      });
      
      return {
        mes: mes.charAt(0).toUpperCase() + mes.slice(1),
        clientes: filasMes.length,
        monto: filasMes.reduce((sum, row) => {
          const monto = parseMonto(row[6]);
          return sum + monto;
        }, 0),
        ganancias: filasMes.reduce((sum, row) => {
          const ganancia = parseMonto(row[10]);
          return sum + ganancia;
        }, 0)
      };
    });

    // Productos y Conteo
    const porProductos = productosList.map(prod => {
      const count = currentData.filter(row => 
        String(row[5]).toLowerCase().trim() === prod.toLowerCase()
      ).length;
      return {
        producto: prod,
        total: count
      };
    });

    return {
      totalClientes,
      montoTotal,
      promedioTasa,
      totalGanancias,
      porMeses,
      porProductos
    };
  }, [data, editedData]);

  // Generar y descargar PDF con los datos y análisis
  const handleDownload = () => {
    // Verificar si el usuario puede descargar PDF
    if (!canDownloadPDF()) {
      alert('La descarga de PDF es una función exclusiva para usuarios suscritos al Plan Profesional (S/ 60/mes). Por favor, suscríbase para acceder a esta característica.');
      return;
    }
    
    if (!clientId) {
      alert('Error: No se pudo identificar el cliente');
      return;
    }
    
    // Verificar si hay datos para descargar
    if (!data || data.length === 0) {
      alert('No hay datos para descargar. Primero complete algunos registros.');
      return;
    }
    
    try {
      // Primero guardar los datos actuales
      Object.entries(editedData).forEach(([key, value]) => {
        const [rowIndex, colIndex] = key.split('-').map(Number);
        updateCompletedData(clientId, month, rowIndex, colIndex, value);
      });

      // Crear PDF
      const doc = new jsPDF('l', 'mm', 'a4'); // Landscape
      
      // Título
      doc.setFontSize(20);
      doc.setTextColor(30, 58, 138);
      doc.text(`ClientCode - ${month} 2026`, 148, 15, { align: 'center' });
      
      // Cliente
      doc.setFontSize(12);
      doc.setTextColor(100, 100, 100);
      doc.text(`Cliente: ${user?.name || 'N/A'}`, 14, 25);
      doc.text(`Fecha de descarga: ${new Date().toLocaleDateString()}`, 14, 30);
      
      // Preparar datos de la tabla - solo filas que tengan al menos un dato
      const tableData = [];
      const rowStyles = [];
      
      data.forEach((row, rowIndex) => {
        const rowData = row.map((cell, colIndex) => {
          const key = `${rowIndex}-${colIndex}`;
          const value = editedData[key] !== undefined ? editedData[key] : cell;
          return value !== null && value !== undefined && value !== 'undefined' ? String(value) : '';
        });
        
        // Solo incluir filas que tengan datos
        if (rowData.some(cell => cell !== '')) {
          tableData.push(rowData);
          
          // Calcular color según observación (columna 9)
          const observacion = String(rowData[9] || '').toLowerCase().trim();
          let fillColor = null;
          
          if (observacion.includes('cobro')) {
            fillColor = [254, 243, 199]; // Amarillo
          } else if (observacion.includes('pendiente') || observacion.includes('espera')) {
            fillColor = [220, 252, 231]; // Verde
          } else if (observacion.includes('cancelado')) {
            fillColor = [254, 226, 226]; // Rojo
          }
          
          rowStyles.push(fillColor);
        }
      });
      
      // Si no hay datos filtrados, mostrar mensaje
      if (tableData.length === 0) {
        doc.setFontSize(12);
        doc.setTextColor(255, 0, 0);
        doc.text('No hay registros de clientes para mostrar', 148, 50, { align: 'center' });
        doc.save(`Clientes_${month}_2026.pdf`);
        setLastSaved(new Date());
        return;
      }
      
      // Agregar tabla de clientes
      doc.setFontSize(14);
      doc.setTextColor(30, 58, 138);
      doc.text('Lista de Clientes', 14, 40);
      
      doc.autoTable({
        head: [headers],
        body: tableData,
        startY: 45,
        theme: 'grid',
        styles: { 
          fontSize: 8, 
          cellPadding: 2,
          overflow: 'linebreak',
          fillColor: [255, 255, 255], // Fondo blanco para todas las celdas
          textColor: [0, 0, 0] // Texto negro
        },
        headStyles: { 
          fillColor: pdfColor, // Color para encabezados
          textColor: 255, // Texto blanco
          fontStyle: 'bold'
        },
        // Hook para aplicar colores solo a la columna de observaciones cuando el botón está activado
        didParseCell: function(data) {
          if (showColorsInPreview && data.column.index === 9 && data.cell.section === 'body') {
            const rowIndex = data.row.index;
            const color = rowStyles[rowIndex];
            if (color) {
              data.cell.styles.fillColor = color;
            }
          }
        },
        margin: { top: 45 }
      });
      
      // Agregar Dashboard en nueva página
      doc.addPage();
      
      doc.setFontSize(18);
      doc.setTextColor(30, 58, 138);
      doc.text('Dashboard - Análisis de Datos', 148, 15, { align: 'center' });
      
      // Resumen General
      doc.setFontSize(14);
      doc.setTextColor(30, 58, 138);
      doc.text('Resumen General', 14, 30);
      
      const summaryData = [
        ['Total de Clientes', dashboard?.totalClientes?.toString() || '0'],
        ['Monto Total (S/)', `S/ ${formatNumberPeruano(dashboard?.montoTotal || 0)}`],
        ['Promedio Ponderado (%)', `${formatNumberPeruano(dashboard?.promedioTasa || 0)}%`],
        ['Total Ganancias (S/)', `S/ ${formatNumberPeruano(dashboard?.totalGanancias || 0)}`]
      ];
      
      doc.autoTable({
        body: summaryData,
        startY: 35,
        theme: 'grid',
        styles: { 
          fontSize: 10, 
          cellPadding: 3,
          fillColor: [255, 255, 255]
        },
        columnStyles: {
          0: { fillColor: pdfColor, textColor: 255, fontStyle: 'bold' },
          1: { fillColor: [255, 255, 255] }
        }
      });
      
      // Calcular y agregar resumen por días
      const diasData = calcularResumenPorDias(tableData).map(dia => [
        dia.dia,
        dia.clientes.toString(),
        `S/ ${formatNumberPeruano(dia.monto)}`,
        `S/ ${formatNumberPeruano(dia.ganancias)}`
      ]);
      
      if (diasData.length > 0) {
        const diasY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 100;
        doc.setFontSize(14);
        doc.setTextColor(30, 58, 138);
        doc.text(`Resumen por Días - ${month} 2026`, 14, diasY);
        
        doc.autoTable({
          head: [['Día', 'Clientes', 'Monto Total (S/)', 'Ganancias (S/)']],
          body: diasData,
          startY: diasY + 5,
          theme: 'grid',
          styles: { 
            fontSize: 9, 
            cellPadding: 2,
            fillColor: [255, 255, 255]
          },
          headStyles: { fillColor: pdfColor, textColor: 255 }
        });
      }
      
      // Productos y Conteo
      const productosY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 140;
      doc.setFontSize(14);
      doc.setTextColor(30, 58, 138);
      doc.text('Productos y Conteo', 14, productosY);
      
      const productosData = dashboard?.porProductos?.map(p => [
        p.producto,
        p.total.toString()
      ]) || [];
      
      doc.autoTable({
        head: [['Producto', 'Total']],
        body: productosData,
        startY: productosY + 5,
        theme: 'grid',
        styles: { 
          fontSize: 9, 
          cellPadding: 2,
          fillColor: [255, 255, 255]
        },
        headStyles: { fillColor: pdfColor, textColor: 255 }
      });
      
      // Pie de página con advertencia de seguridad
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('Documento confidencial - Generado por ClientCode', 148, 200, { align: 'center' });
        doc.text(`Página ${i} de ${pageCount}`, 280, 200, { align: 'right' });
      }
      
      // Guardar PDF
      doc.save(`Clientes_${month}_2026.pdf`);
      
      setLastSaved(new Date());
    } catch (error) {
      console.error('Error al generar PDF:', error);
      console.error('Detalles del error:', error.message, error.stack);
      alert('Error al generar el documento PDF: ' + (error.message || 'Error desconocido'));
    }
  };

  // Calcular resumen por días
  const calcularResumenPorDias = (rows) => {
    const resumenPorDia = {};
    
    rows.forEach(row => {
      const fecha = row[0]; // Columna 0 es la fecha
      if (!fecha) return;
      
      // Extraer solo el día de la fecha (formato: 2026-01-15)
      const dia = fecha.split('-')[2] || fecha;
      
      if (!resumenPorDia[dia]) {
        resumenPorDia[dia] = {
          dia: dia,
          clientes: 0,
          monto: 0,
          ganancias: 0
        };
      }
      
      resumenPorDia[dia].clientes += 1;
      
      // Columna 6 es Monto
      const monto = parseMonto(row[6]);
      resumenPorDia[dia].monto += monto;
      
      // Columna 10 es Ganancias
      const ganancia = parseMonto(row[10]);
      resumenPorDia[dia].ganancias += ganancia;
    });
    
    // Convertir a array y ordenar por día
    return Object.values(resumenPorDia).sort((a, b) => parseInt(a.dia) - parseInt(b.dia));
  };

  // Mostrar vista previa del documento Excel
  const handleShowPreview = () => {
    if (!clientId) return;
    
    try {
      // Guardar datos actuales
      Object.entries(editedData).forEach(([key, value]) => {
        const [rowIndex, colIndex] = key.split('-').map(Number);
        updateCompletedData(clientId, month, rowIndex, colIndex, value);
      });

      // Preparar datos para la vista previa
      const previewRows = data.map((row, rowIndex) => {
        return row.map((cell, colIndex) => {
          const key = `${rowIndex}-${colIndex}`;
          const value = editedData[key] !== undefined ? editedData[key] : cell;
          return value !== null && value !== undefined && value !== 'undefined' ? String(value) : '';
        });
      }).filter(row => row.some(cell => cell !== ''));

      // Calcular resumen por días
      const resumenPorDias = calcularResumenPorDias(previewRows);

      setPreviewData({
        headers: headers,
        rows: previewRows,
        dashboard: dashboard,
        resumenPorDias: resumenPorDias
      });
      setShowPreview(true);
      setLastSaved(new Date());
    } catch (error) {
      console.error('Error al mostrar vista previa:', error);
      alert('Error al mostrar la vista previa: ' + (error.message || 'Error desconocido'));
    }
  };

  // Cerrar vista previa
  const handleClosePreview = () => {
    setShowPreview(false);
    setPreviewData(null);
  };

  // Effect para verificar estado de autenticación
  useEffect(() => {
    const checkAuth = () => {
      if (user?.email) {
        const status = getTrialStatus(user.email);
        setTrialStatusInfo(status);
        setIsReadOnly(isReadOnlyMode(user.email));
        setAuthChecked(true);
      }
    };

    const timer = setTimeout(checkAuth, 100);
    return () => clearTimeout(timer);
  }, [user, isReadOnlyMode, getTrialStatus]);

  if (!data) {
    return (
      <div className="editor-empty">
        <h3>No se pudo cargar el documento</h3>
        <p>El documento puede haber sido eliminado o no existe.</p>
      </div>
    );
  }

  const handleVerPlanes = () => {
    if (trialStatusInfo?.trialEndDate && !trialStatusInfo.isSubscribed) {
      alert('Su período de prueba ha finalizado. Por favor, contacte al administrador para suscribirse.');
    } else {
      window.location.href = '/planes';
    }
  };

  // Mostrar spinner mientras se verifica la autenticación
  if (!authChecked) {
    return (
      <div className="document-editor-v2">
        <div className="editor-loading">
          <div className="spinner"></div>
          <p>Verificando acceso...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="document-editor-v2">
      {/* Mostrar mensaje de carga si los datos están corruptos o sincronizando */}
      {(isDataCorrupted || isSyncing) && (
        <div className="sync-loading-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="spinner" style={{
            width: '50px',
            height: '50px',
            border: '5px solid #f3f3f3',
            borderTop: '5px solid #3498db',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: '20px'
          }}></div>
          <h3 style={{ color: '#333', marginBottom: '10px' }}>
            {isDataCorrupted ? '🧹 Limpiando datos corruptos...' : '⏳ Sincronizando datos...'}
          </h3>
          <p style={{ color: '#666', textAlign: 'center' }}>
            {isDataCorrupted 
              ? 'Detectamos datos corruptos en tu navegador. Estamos recuperando la información desde el servidor.' 
              : 'Estamos cargando tu información desde el servidor. Por favor espera...'}
          </p>
        </div>
      )}
      
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* Banner de modo solo lectura - solo mostrar si authChecked es true */}
      {authChecked && isReadOnly && (
        <div className="read-only-banner">
          <span className="read-only-icon">🔒</span>
          <div className="read-only-content">
            <strong>Modo Solo Lectura</strong>
            <span>Su período de prueba ha finalizado. Suscríbase para editar.</span>
          </div>
          <button className="read-only-btn" onClick={handleVerPlanes}>
            Ver Planes
          </button>
        </div>
      )}

      <div className="editor-header-v2">
        <div className="header-content">
          <h2>{month} 2026</h2>
          <p className="client-name">Documento de {user?.name}</p>
        </div>
        
        <div className="header-actions">
          {lastSaved && !isReadOnly && (
            <span className="save-indicator">
              Guardado: {lastSaved.toLocaleTimeString()}
            </span>
          )}
          
          {!isReadOnly && (
            <>
              <button 
                className={`btn-save-v2 ${saving ? 'saving' : ''}`}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Guardando...' : 'Guardar Cambios'}
              </button>
              
              {/* NUEVO: Botón para escanear imagen con OCR */}
              <button 
                className="btn-scan-image"
                onClick={() => setShowImageScanner(true)}
                disabled={saving || savingFinal}
                title="Escanear imagen y extraer datos automáticamente"
              >
                📷 Escanear Imagen
              </button>
              
              {/* NUEVO: Botón para guardar datos finales del mes */}
              <button 
                className="btn-save-final"
                onClick={() => setShowSaveFinalModal(true)}
                disabled={saving || savingFinal}
                title="Guardar documento final en el historial"
              >
                {savingFinal ? '⏳ Guardando...' : '✅ Guardar Datos Finales'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="sheets-container">
        {/* HOJA 1: Clientes */}
        <div className="sheet-section">
          <div className="sheet-header-v2">
            <h3>Hoja 1: Clientes</h3>
            <span className="sheet-badge editable">Editable</span>
          </div>
          
          {/* Leyenda de colores */}
          <div className="color-legend">
            <span className="legend-title">Estados:</span>
            <span className="legend-item yellow">🟡 Cobro</span>
            <span className="legend-item green">🟢 Pendiente/Espera</span>
            <span className="legend-item red">🔴 Cancelado</span>
          </div>

          {/* NUEVO: Botón para agregar cliente (solo visible en móvil) */}
          {!isReadOnly && (
            <div className="mobile-add-client-container">
              <button
                className="btn-add-client-mobile"
                onClick={() => setShowMobileForm(true)}
                disabled={saving}
              >
                ➕ Agregar Nuevo Cliente
              </button>
            </div>
          )}

          {/* NUEVO: Formulario móvil para agregar cliente */}
          {showMobileForm && !isReadOnly && (
            <MobileClientForm
              month={month}
              onSubmit={handleAddClientFromMobile}
              onCancel={() => setShowMobileForm(false)}
              productosList={productosList}
              mesesList={mesesList}
              getOpcionesDias={getOpcionesDias}
            />
          )}

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="row-num">#</th>
                  {headers.map((header, index) => (
                    <th key={index}>{renderHeaderLabel(header, index)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, rowIndex) => {
                  // Calcular color de la fila según observación
                  const currentRow = row.map((cell, colIndex) => {
                    const key = `${rowIndex}-${colIndex}`;
                    return editedData[key] !== undefined ? editedData[key] : cell;
                  });
                  const rowColor = getRowColor(currentRow);
                  
                  return (
                    <tr key={rowIndex} style={{ backgroundColor: rowColor }}>
                      <td className="row-num" data-label="#">{rowIndex + 1}</td>
                      {row.map((cell, colIndex) => {
                        const key = `${rowIndex}-${colIndex}`;
                        const value = editedData[key] !== undefined ? editedData[key] : cell;
                        
                        // PARTE 3: Obtener información de la columna por tipo
                        const column = headers[colIndex];
                        const columnLabel = (typeof column === 'object' && column !== null) ? column.label : column;
                        const columnType = (typeof column === 'object' && column !== null) ? column.type : 'text';
                        
                        const safeValue = value !== null && value !== undefined && value !== 'undefined' ? value : '';
                        
                        // Renderizar según el tipo de campo
                        switch (columnType) {
                          case 'select':
                            return (
                              <td key={colIndex} data-label={columnLabel}>
                                <select
                                  value={safeValue}
                                  onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                  className="data-input"
                                  disabled={isReadOnly}
                                >
                                  <option value="">Seleccione...</option>
                                  {productosList.map(prod => (
                                    <option key={prod} value={prod}>{prod}</option>
                                  ))}
                                </select>
                              </td>
                            );
                          
                          case 'select-fecha':
                            const diasOptions = getOpcionesDias();
                            const mesNumero = (mesesList.indexOf(month.toLowerCase() + ' 2026') + 1).toString().padStart(2, '0');
                            return (
                              <td key={colIndex} data-label={columnLabel}>
                                <select
                                  value={value && value !== 'undefined' ? value : ''}
                                  onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                  className="data-input"
                                  disabled={isReadOnly}
                                >
                                  <option value="">Día</option>
                                  {diasOptions.map(dia => (
                                    <option key={dia} value={`2026-${mesNumero}-${dia}`}>
                                      {dia}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            );
                          
                          case 'auto':
                            const mesAutomatico = month.toLowerCase() + ' 2026';
                            return (
                              <td key={colIndex} data-label={columnLabel}>
                                <input
                                  type="text"
                                  value={mesAutomatico}
                                  readOnly={true}
                                  className="data-input readonly"
                                  title="Mes asignado automáticamente"
                                />
                              </td>
                            );
                          
                          case 'monto':
                            return (
                              <td key={colIndex} data-label={columnLabel}>
                                <div className="input-with-prefix">
                                  <span className="input-prefix">S/</span>
                                  <input
                                    type="text"
                                    value={safeValue}
                                    onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                    onBlur={(e) => handleCellBlur(rowIndex, colIndex, e.target.value)}
                                    className="data-input prefixed"
                                    placeholder="0.00"
                                    disabled={isReadOnly}
                                  />
                                </div>
                              </td>
                            );
                          
                          case 'percentage':
                            return (
                              <td key={colIndex} data-label={columnLabel}>
                                <div className="input-with-suffix">
                                  <input
                                    type="text"
                                    value={safeValue}
                                    onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                    onBlur={(e) => handleCellBlur(rowIndex, colIndex, e.target.value)}
                                    className="data-input"
                                    placeholder="0.00"
                                    disabled={isReadOnly}
                                  />
                                  <span className="input-suffix">%</span>
                                </div>
                              </td>
                            );
                          
                          default:
                            return (
                              <td key={colIndex} data-label={columnLabel}>
                                <input
                                  type="text"
                                  value={safeValue}
                                  onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                  className="data-input"
                                  placeholder=""
                                  disabled={isReadOnly}
                                />
                              </td>
                            );
                        }
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            {/* Botones para añadir/eliminar filas */}
            {!isReadOnly && (
              <div className="table-row-controls">
                <button 
                  className="btn-row-control btn-add-row"
                  onClick={handleAddRow}
                  title="Añadir fila"
                >
                  <span className="control-icon">+</span>
                  <span className="control-tooltip">Añadir fila</span>
                </button>
                <button 
                  className="btn-row-control btn-remove-row"
                  onClick={handleRemoveRow}
                  title="Eliminar fila"
                  disabled={data.length <= 1}
                >
                  <span className="control-icon">−</span>
                  <span className="control-tooltip">Eliminar fila</span>
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      <div className="editor-footer-v2">
        <div className="footer-info">
          <span>Total de filas: {data.length}</span>
          <span>Clientes registrados: {dashboard.totalClientes}</span>
        </div>
        
        {/* Selector de Color para PDF */}
        <div className="color-selector">
          <span className="color-label">Color del PDF:</span>
          <div className="color-options">
            {Object.entries(predefinedColors).map(([name, color]) => (
              <button
                key={name}
                className={`color-btn ${JSON.stringify(pdfColor) === JSON.stringify(color) ? 'active' : ''}`}
                style={{ backgroundColor: `rgb(${color.join(',')})` }}
                onClick={() => handleColorChange(name, color)}
                title={name}
              />
            ))}
          </div>
        </div>
        
        <div className="download-buttons">
          <button className="btn-download-v2 btn-excel" onClick={handleShowPreview}>
            👁️ Vista Previa Documento
          </button>
          <button 
            className={`btn-download-v2 ${!canDownloadPDF() ? 'btn-locked' : ''}`} 
            onClick={handleDownload}
            title={!canDownloadPDF() ? 'Disponible solo para usuarios suscritos al Plan Profesional' : ''}
          >
            📄 Descargar PDF {!canDownloadPDF() && '🔒'}
          </button>
        </div>
      </div>

      {/* Modal de Vista Previa */}
      {showPreview && previewData && (
        <div className="preview-modal-overlay" onClick={handleClosePreview}>
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-header">
              <h3>Vista Previa del Documento - {month} 2026</h3>
              <div className="preview-header-actions">
                <button 
                  className={`btn-colors-toggle ${showColorsInPreview ? 'active' : ''}`}
                  onClick={() => setShowColorsInPreview(!showColorsInPreview)}
                  title={showColorsInPreview ? 'Ocultar colores' : 'Mostrar colores'}
                >
                  {showColorsInPreview ? '🎨 Ocultar Colores' : '🎨 Mostrar Colores'}
                </button>
                <button className="preview-close-btn" onClick={handleClosePreview}>✕</button>
              </div>
            </div>
            <div className="preview-content">
              <div className="preview-section">
                <h4 className="preview-section-title">📋 Datos de Clientes</h4>
                <div className="preview-excel-table">
                  <table>
                    <thead>
                      <tr>
                        {previewData.headers.map((header, idx) => (
                          <th key={idx}>{renderHeaderLabel(header, idx)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.rows.length > 0 ? (
                        previewData.rows.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {row.map((cell, cellIdx) => (
                              <td 
                                key={cellIdx}
                                className={showColorsInPreview && cellIdx === 9 ? getObservacionColorClass(row) : ''}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={previewData.headers.length} className="no-data">
                            No hay datos registrados aún
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              
              {previewData.dashboard && (
                <div className="preview-section">
                  <h4 className="preview-section-title">📊 DASHBOARD DE ANÁLISIS - AÑO 2026</h4>
                  
                  {/* Instrucciones */}
                  <div className="preview-instrucciones">
                    <p><strong>INSTRUCCIONES:</strong></p>
                    <ol>
                      <li>Ve a la hoja 'Clientes'</li>
                      <li>Escribe fechas del año 2026</li>
                      <li>La columna 'Mes' se actualiza automáticamente</li>
                      <li>En Observaciones usa: <span className="color-cobro">Cobro</span>, <span className="color-pendiente">Pendiente</span> o <span className="color-cancelado">Cancelado</span></li>
                      <li>Los colores se aplican automáticamente:</li>
                    </ol>
                    <div className="preview-leyenda-colores">
                      <span className="leyenda-item yellow">🟡 Amarillo: Cobro</span>
                      <span className="leyenda-item green">🟢 Verde: Pendiente / En espera</span>
                      <span className="leyenda-item red">🔴 Rojo: Cancelado</span>
                    </div>
                  </div>

                  <div className="preview-dashboard">
                    {/* Resumen General */}
                    <div className="preview-resumen-general">
                      <h5>RESUMEN GENERAL - AÑO 2026</h5>
                      <div className="preview-stats-grid">
                        <div className="preview-stat-item">
                          <span className="preview-stat-label">Total de Clientes</span>
                          <span className="preview-stat-value">{previewData.dashboard.totalClientes || 0}</span>
                        </div>
                        <div className="preview-stat-item">
                          <span className="preview-stat-label">Monto Total (S/)</span>
                          <span className="preview-stat-value">S/ {formatNumberPeruano(previewData.dashboard.montoTotal) || '0,00'}</span>
                        </div>
                        <div className="preview-stat-item">
                          <span className="preview-stat-label">Promedio Ponderado (%)</span>
                          <span className="preview-stat-value">{previewData.dashboard.promedioTasa ? formatNumberPeruano(previewData.dashboard.promedioTasa) + '%' : '#¡DIV/0!'}</span>
                        </div>
                        <div className="preview-stat-item">
                          <span className="preview-stat-label">Total Ganancias (S/)</span>
                          <span className="preview-stat-value">S/ {formatNumberPeruano(previewData.dashboard.totalGanancias) || '0,00'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Resumen por Días */}
                    <div className="preview-resumen-dias">
                      <h5>RESUMEN POR DÍAS - {month.toUpperCase()} 2026</h5>
                      <div className="preview-dias-table-container">
                        <table className="preview-dias-table">
                          <thead>
                            <tr>
                              <th className="col-dia-header">Día</th>
                              <th className="col-cliente-header">Clientes</th>
                              <th className="col-numero-header">Monto Total</th>
                              <th className="col-numero-header">Ganancia</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.resumenPorDias && previewData.resumenPorDias.length > 0 ? (
                              previewData.resumenPorDias.map((dia, idx) => (
                                <tr key={idx}>
                                  <td className="col-dia">{dia.dia}</td>
                                  <td className="col-cliente">{dia.clientes}</td>
                                  <td className="col-numero">S/ {formatNumberPeruano(dia.monto)}</td>
                                  <td className="col-numero">S/ {formatNumberPeruano(dia.ganancias)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan="4" className="no-data">No hay datos por día</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Productos y Conteo */}
                    <div className="preview-resumen-productos">
                      <h5>PRODUCTOS Y CONTEO</h5>
                      <div className="preview-productos-table-container">
                        <table className="preview-productos-table">
                          <thead>
                            <tr>
                              <th>Producto</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.dashboard.porProductos && previewData.dashboard.porProductos.map((prod, idx) => (
                              <tr key={idx}>
                                <td>{prod.producto}</td>
                                <td>{prod.total || 0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="preview-footer">
              <span>Total de registros: {previewData.rows.length}</span>
              <button className="btn-close-preview" onClick={handleClosePreview}>
                Cerrar Vista Previa
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* NUEVO: Modal para guardar datos finales del mes */}
      <SaveFinalDataModal
        isOpen={showSaveFinalModal}
        onClose={() => setShowSaveFinalModal(false)}
        onConfirm={handleSaveFinalData}
        month={month}
        year={2026}
      />

      {/* NUEVO: Modal para escanear imagen con OCR */}
      {showImageScanner && (
        <ImageScanner
          onDataExtracted={handleScannedData}
          onClose={() => setShowImageScanner(false)}
        />
      )}
    </div>
  );
}

// NUEVO: Componente de formulario móvil para agregar cliente
function MobileClientForm({ month, onSubmit, onCancel, productosList, mesesList, getOpcionesDias }) {
  const [formData, setFormData] = useState({
    fecha: '',
    dni: '',
    nombre: '',
    celular: '',
    producto: '',
    monto: '',
    tasa: '',
    lugar: '',
    observacion: '',
    ganancias: ''
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const diasOptions = getOpcionesDias();
  const mesNumero = (mesesList.indexOf(month.toLowerCase() + ' 2026') + 1).toString().padStart(2, '0');

  return (
    <div className="mobile-client-form-overlay">
      <div className="mobile-client-form">
        <div className="form-header">
          <h3>📝 Nuevo Cliente</h3>
          <button className="btn-close" onClick={onCancel}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Fecha</label>
            <select
              value={formData.fecha}
              onChange={(e) => handleChange('fecha', e.target.value)}
              required
            >
              <option value="">Seleccione día...</option>
              {diasOptions.map(dia => (
                <option key={dia} value={`2026-${mesNumero}-${dia}`}>
                  {dia}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>DNI</label>
            <input
              type="text"
              value={formData.dni}
              onChange={(e) => handleChange('dni', e.target.value)}
              placeholder="Ingrese DNI"
              required
            />
          </div>

          <div className="form-group">
            <label>Nombre y Apellidos</label>
            <input
              type="text"
              value={formData.nombre}
              onChange={(e) => handleChange('nombre', e.target.value)}
              placeholder="Ingrese nombre completo"
              required
            />
          </div>

          <div className="form-group">
            <label>Celular</label>
            <input
              type="text"
              value={formData.celular}
              onChange={(e) => handleChange('celular', e.target.value)}
              placeholder="Ingrese número de celular"
            />
          </div>

          <div className="form-group">
            <label>Producto</label>
            <select
              value={formData.producto}
              onChange={(e) => handleChange('producto', e.target.value)}
              required
            >
              <option value="">Seleccione producto...</option>
              {productosList.map(prod => (
                <option key={prod} value={prod}>{prod}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Monto (S/)</label>
            <input
              type="text"
              value={formData.monto}
              onChange={(e) => handleChange('monto', e.target.value)}
              placeholder="0.00"
              required
            />
          </div>

          <div className="form-group">
            <label>Tasa (%)</label>
            <input
              type="text"
              value={formData.tasa}
              onChange={(e) => handleChange('tasa', e.target.value)}
              placeholder="Ej: 5"
            />
          </div>

          <div className="form-group">
            <label>Lugar</label>
            <input
              type="text"
              value={formData.lugar}
              onChange={(e) => handleChange('lugar', e.target.value)}
              placeholder="Ingrese lugar"
            />
          </div>

          <div className="form-group">
            <label>Observación</label>
            <select
              value={formData.observacion}
              onChange={(e) => handleChange('observacion', e.target.value)}
            >
              <option value="">Seleccione estado...</option>
              <option value="Cobro">🟡 Cobro</option>
              <option value="Pendiente">🟢 Pendiente/Espera</option>
              <option value="Cancelado">🔴 Cancelado</option>
            </select>
          </div>

          <div className="form-group">
            <label>Ganancias (S/)</label>
            <input
              type="text"
              value={formData.ganancias}
              onChange={(e) => handleChange('ganancias', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit" className="btn-submit">
              💾 Guardar Cliente
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Force redeploy Tue Mar  3 14:38:18 HPS 2026
