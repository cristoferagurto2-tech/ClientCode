// Force redeploy - Cloudflare Pages fix
import { createContext, useContext, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { documentsAPI, syncService, adminAPI } from '../services/api';
import { useAuth } from './AuthContext';

const DocumentsContext = createContext();

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// Convertir ArrayBuffer a Base64
const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

// Convertir Base64 a ArrayBuffer
const base64ToArrayBuffer = (base64) => {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

export function DocumentsProvider({ children }) {
  const [clientDocuments, setClientDocuments] = useState({});
  const [completedData, setCompletedData] = useState({});
  const [currentMonth, setCurrentMonth] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [isDataCorrupted, setIsDataCorrupted] = useState(false);
   
  // Obtener funciones de AuthContext para sincronización de IDs
  const { getClientBackendId, syncClientBackendId, clients } = useAuth();

  // Función para detectar si los datos están corruptos
  const checkIfDataIsCorrupted = (docs) => {
    if (!docs || typeof docs !== 'object') return false;
    
    for (const clientId in docs) {
      const clientDocs = docs[clientId];
      if (!clientDocs || typeof clientDocs !== 'object') continue;
      
      for (const month in clientDocs) {
        const doc = clientDocs[month];
        if (!doc || !doc.headers || !Array.isArray(doc.headers)) continue;
        
        // Verificar si todos los headers son null o "Columna"
        const hasNullHeaders = doc.headers.every(h => h === null || h === undefined);
        const hasColumnaHeaders = doc.headers.every(h => 
          (typeof h === 'string' && h.startsWith('Columna')) ||
          (typeof h === 'object' && h !== null && h.label === 'Columna')
        );
        
        if (hasNullHeaders || hasColumnaHeaders) {
          console.warn(`⚠️ Datos corruptos detectados para cliente ${clientId}, mes ${month}`);
          return true;
        }
      }
    }
    return false;
  };

  useEffect(() => {
    const initializeDocuments = async () => {
      // Verificar disponibilidad del backend
      const isAvailable = await syncService.isBackendAvailable();
      setBackendAvailable(isAvailable);
      
      // Cargar desde localStorage primero (para mostrar algo rápido)
      const savedDocs = localStorage.getItem('clientDocuments');
      const savedData = localStorage.getItem('completedData');
      
      if (savedDocs) {
        const parsedDocs = JSON.parse(savedDocs);
        
        // Verificar si los datos están corruptos
        if (checkIfDataIsCorrupted(parsedDocs)) {
          console.warn('🧹 Datos corruptos detectados en localStorage. Limpiando...');
          setIsDataCorrupted(true);
          
          // Limpiar localStorage
          localStorage.removeItem('clientDocuments');
          localStorage.removeItem('completedData');
          
          // No cargar datos corruptos
          setClientDocuments({});
          setCompletedData({});
        } else {
          setClientDocuments(parsedDocs);
        }
      }
      if (savedData && !isDataCorrupted) {
        setCompletedData(JSON.parse(savedData));
      }
    };
    
    initializeDocuments();
  }, []);

  // Efecto para sincronizar automáticamente cuando hay un usuario logueado
  useEffect(() => {
    const autoSyncOnLogin = async () => {
      const token = localStorage.getItem('token');
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      
      if (backendAvailable && token && user?.id) {
        console.log('Sincronizando documentos automáticamente para usuario:', user.id);
        setIsSyncing(true);
        try {
          await syncFromBackend(user.id);
          console.log('✅ Sincronización automática completada');
          
          // Si había datos corruptos, limpiar el flag después de sincronizar exitosamente
          if (isDataCorrupted) {
            console.log('🧹 Limpiando flag de datos corruptos');
            setIsDataCorrupted(false);
          }
        } catch (error) {
          console.error('❌ Error en sincronización automática:', error);
        } finally {
          setIsSyncing(false);
        }
      }
    };
    
    autoSyncOnLogin();
  }, [backendAvailable, isDataCorrupted]);

  useEffect(() => {
    localStorage.setItem('clientDocuments', JSON.stringify(clientDocuments));
  }, [clientDocuments]);

  useEffect(() => {
    localStorage.setItem('completedData', JSON.stringify(completedData));
  }, [completedData]);

  // Subir documento con múltiples hojas
  const uploadDocument = async (clientId, month, file) => {
    return new Promise(async (resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          const base64Data = arrayBufferToBase64(arrayBuffer);
          
          // Leer todas las hojas del workbook
          const data = new Uint8Array(arrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          const allSheets = {};
          workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            allSheets[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          });
          
          // La primera hoja es la editable
          const firstSheetName = workbook.SheetNames[0];
          const firstSheetData = allSheets[firstSheetName];
          
          const headers = firstSheetData[0] || [];
          const sheetData = firstSheetData.slice(1); // Datos SIN el header
          
          // Guardar en localStorage
          setClientDocuments(prev => ({
            ...prev,
            [clientId]: {
              ...prev[clientId],
              [month]: {
                name: file.name,
                originalFile: base64Data,
                originalWorkbook: base64Data,
                sheets: allSheets,
                sheetNames: workbook.SheetNames,
                headers: headers,
                data: sheetData,
                uploadedAt: new Date().toISOString(),
                clientId: clientId
              }
            }
          }));
          
          // Sincronizar con backend automáticamente
          const token = localStorage.getItem('token');
          if (backendAvailable && token) {
            try {
              setIsSyncing(true);
              
              // Obtener el backendId del cliente (MongoDB ObjectId)
              let effectiveClientId = getClientBackendId(clientId);
              
              // Si el cliente no tiene backendId, intentar sincronizarlo
              if (effectiveClientId === clientId) {
                console.log(`Cliente ${clientId} no tiene backendId, intentando sincronizar...`);
                const client = clients.find(c => c.id === clientId);
                if (client) {
                  const syncedClient = await syncClientBackendId(client);
                  effectiveClientId = syncedClient.backendId || clientId;
                }
              }
              
              console.log(`Sincronizando documento de ${month} con backend usando ID: ${effectiveClientId}`);
              
              await adminAPI.uploadDocumentForClient(effectiveClientId, month, {
                headers: headers,
                data: sheetData,
                completedData: [],
                year: 2026
              });
              console.log(`Documento de ${month} sincronizado con backend correctamente`);
              setSyncError(null);
            } catch (syncError) {
              console.error('Error sincronizando con backend:', syncError);
              setSyncError('Error sincronizando con servidor. Inicia sesión como administrador.');
              // No rechazamos la promesa, el documento se guardó localmente
            } finally {
              setIsSyncing(false);
            }
          } else if (backendAvailable && !token) {
            console.warn('No se puede sincronizar: Usuario no autenticado (no hay token)');
            setSyncError('Documento guardado localmente. Inicia sesión como administrador para sincronizar.');
          }
          
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  // Descargar archivo original modificado
  const downloadOriginalFile = (clientId, month) => {
    const doc = clientDocuments[clientId]?.[month];
    if (!doc || !doc.originalFile) return null;

    try {
      // Obtener datos editados
      const key = `${clientId}-${month}`;
      const clientData = completedData[key] || {};
      
      // Convertir Base64 a ArrayBuffer
      const arrayBuffer = base64ToArrayBuffer(doc.originalFile);
      
      // Leer el workbook original
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Aplicar cambios a las celdas preservando estilos originales
      Object.entries(clientData).forEach(([cellKey, value]) => {
        const [rowIndex, colIndex] = cellKey.split('-').map(Number);
        // +2 porque Excel empieza en 1 y la primera fila es el header
        const cellRef = XLSX.utils.encode_cell({r: rowIndex + 1, c: colIndex});
        
        if (worksheet[cellRef]) {
          // Preservar el objeto de celda original pero actualizar el valor
          worksheet[cellRef].v = value;
          // No cambiar el tipo (t) ni los estilos (s) para preservar colores originales
        } else {
          // Si la celda no existe, crearla con tipo string
          worksheet[cellRef] = { v: value, t: 's' };
        }
      });
      
      // Recalcular fórmulas si existen
      XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // Crear blob y descargar preservando estilos originales
      const wbout = XLSX.write(workbook, { 
        bookType: 'xlsx', 
        type: 'array',
        cellStyles: true,
        bookSST: false
      });
      const blob = new Blob([wbout], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      
      return blob;
    } catch (error) {
      console.error('Error al preparar descarga:', error);
      return null;
    }
  };

  // ==================== SYNC FUNCTIONS ====================
  
  // Sincronizar documentos desde el backend
  const syncFromBackend = async (clientId) => {
    if (!backendAvailable || !clientId) return;
    
    setIsSyncing(true);
    setSyncError(null);
    
    try {
      // Sincronizar todos los meses
      for (const month of MESES) {
        try {
          await syncService.syncDocumentFromBackend(clientId, month);
        } catch (error) {
          console.log(`No hay documento para ${month} en el backend`);
        }
      }
      
      // Recargar desde localStorage
      const savedDocs = localStorage.getItem('clientDocuments');
      const savedData = localStorage.getItem('completedData');
      
      if (savedDocs) {
        setClientDocuments(JSON.parse(savedDocs));
      }
      if (savedData) {
        setCompletedData(JSON.parse(savedData));
      }
    } catch (error) {
      console.error('Error sincronizando desde backend:', error);
      setSyncError(error.message);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Sincronizar documentos al backend
  const syncToBackend = async (clientId) => {
    if (!backendAvailable || !clientId) return { success: false, error: 'No disponible' };
    
    setIsSyncing(true);
    setSyncError(null);
    
    try {
      const results = [];
      
      for (const month of MESES) {
        const result = await syncService.syncDocumentToBackend(clientId, month);
        if (result.success) {
          results.push(month);
        }
      }
      
      return { 
        success: true, 
        message: `Sincronizados ${results.length} meses`,
        syncedMonths: results 
      };
    } catch (error) {
      setSyncError(error.message);
      return { success: false, error: error.message };
    } finally {
      setIsSyncing(false);
    }
  };

  // Obtener datos de ambas hojas
  const getMergedData = (clientId, month) => {
    const doc = clientDocuments[clientId]?.[month];
    if (!doc) return null;

    const key = `${clientId}-${month}`;
    const clientData = completedData[key] || {};

    // Fusionar datos editados en la primera hoja (datos sin header)
    const mergedData = doc.data.map((row, rowIndex) => {
      return row.map((cell, colIndex) => {
        const cellKey = `${rowIndex}-${colIndex}`;
        return clientData[cellKey] !== undefined ? clientData[cellKey] : cell;
      });
    });

    return {
      headers: doc.headers,
      data: mergedData,
      sheets: doc.sheets,
      sheetNames: doc.sheetNames
    };
  };

  // Actualizar datos completados y también el documento original (con sincronización a backend)
  const updateCompletedData = async (clientId, month, rowIndex, columnIndex, value) => {
    const key = `${clientId}-${month}`;
    
    // Guardar en completedData (para seguimiento de cambios)
    setCompletedData(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [`${rowIndex}-${columnIndex}`]: value
      }
    }));
    
    // Actualizar también el documento original para que persista al volver
    setClientDocuments(prev => {
      if (!prev[clientId] || !prev[clientId][month]) return prev;
      
      const newDocs = { ...prev };
      const doc = { ...newDocs[clientId][month] };
      
      // Asegurar que la fila existe
      if (!doc.data[rowIndex]) {
        doc.data[rowIndex] = new Array(doc.headers.length).fill('');
      }
      
      // Actualizar el valor en la data original
      doc.data[rowIndex] = [...doc.data[rowIndex]];
      doc.data[rowIndex][columnIndex] = value;
      
      // Actualizar también en sheets
      const firstSheetName = doc.sheetNames[0];
      if (doc.sheets[firstSheetName]) {
        doc.sheets[firstSheetName] = doc.sheets[firstSheetName].map((row, idx) => {
          if (idx === rowIndex + 1) { // +1 porque la primera fila es el header
            const newRow = [...row];
            newRow[columnIndex] = value;
            return newRow;
          }
          return row;
        });
      }
      
      newDocs[clientId] = { ...newDocs[clientId], [month]: doc };
      return newDocs;
    });
    
    // Si hay backend disponible, sincronizar la celda
    if (backendAvailable) {
      try {
        await documentsAPI.updateCell(month, rowIndex, columnIndex, value);
      } catch (error) {
        console.log('Error sincronizando celda con backend:', error);
        // No interrumpimos si falla el backend
      }
    }
  };

  // Subir documento a TODOS los meses de una sola vez
  const uploadDocumentToAllMonths = async (clientId, file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          const base64Data = arrayBufferToBase64(arrayBuffer);
          
          // Leer todas las hojas del workbook una sola vez
          const data = new Uint8Array(arrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          const allSheets = {};
          workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            allSheets[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          });
          
          const firstSheetName = workbook.SheetNames[0];
          const firstSheetData = allSheets[firstSheetName];
          
          // Crear documento base para todos los meses
          const baseDocument = {
            name: file.name,
            originalFile: base64Data,
            originalWorkbook: base64Data,
            sheets: allSheets,
            sheetNames: workbook.SheetNames,
            headers: firstSheetData[0] || [],
            data: firstSheetData.slice(1),
            uploadedAt: new Date().toISOString(),
            clientId: clientId
          };
          
          // Actualizar estado UNA SOLA VEZ con todos los meses
          setClientDocuments(prev => {
            const newDocs = { ...prev };
            if (!newDocs[clientId]) {
              newDocs[clientId] = {};
            }
            
            // Asignar el mismo documento a todos los meses
            MESES.forEach(month => {
              newDocs[clientId] = {
                ...newDocs[clientId],
                [month]: { ...baseDocument }
              };
            });
            
            return newDocs;
          });
          
          // Sincronizar con backend automáticamente
          const token = localStorage.getItem('token');
          if (backendAvailable && token) {
            try {
              setIsSyncing(true);
              console.log('Sincronizando documentos con backend para todos los meses...');
              
              // Obtener el backendId del cliente (MongoDB ObjectId)
              let effectiveClientId = getClientBackendId(clientId);
              
              // Si el cliente no tiene backendId, intentar sincronizarlo
              if (effectiveClientId === clientId) {
                console.log(`Cliente ${clientId} no tiene backendId, intentando sincronizar...`);
                // Buscar el cliente en la lista
                const client = clients.find(c => c.id === clientId);
                if (client) {
                  const syncedClient = await syncClientBackendId(client);
                  effectiveClientId = syncedClient.backendId || clientId;
                }
              }
              
              console.log(`Usando backendId para sincronización: ${effectiveClientId}`);
              
              // Sincronizar todos los meses con el backend usando el backendId
              const syncPromises = MESES.map(month => 
                adminAPI.uploadDocumentForClient(effectiveClientId, month, {
                  headers: baseDocument.headers,
                  data: baseDocument.data,
                  completedData: [],
                  year: 2026
                }).catch(err => {
                  console.error(`Error sincronizando ${month}:`, err);
                  return { success: false, month, error: err.message || 'Error desconocido' };
                })
              );
              
              const results = await Promise.all(syncPromises);
              const successfulSyncs = results.filter(r => r.success !== false).length;
              const failedSyncs = results.filter(r => r.success === false);
              
              console.log(`${successfulSyncs} de 12 meses sincronizados correctamente con backend`);
              
              if (failedSyncs.length > 0) {
                console.warn(`${failedSyncs.length} meses fallaron al sincronizar:`, failedSyncs.map(r => r.month || r.error).join(', '));
                setSyncError(`${failedSyncs.length} meses no se pudieron sincronizar. Verifica que estés logueado como administrador.`);
              } else {
                setSyncError(null);
              }
            } catch (syncError) {
              console.error('Error sincronizando con backend:', syncError);
              setSyncError('Error sincronizando con servidor. Verifica tu conexión y que estés logueado.');
            } finally {
              setIsSyncing(false);
            }
          } else if (backendAvailable && !token) {
            console.warn('No se puede sincronizar: Usuario no autenticado (no hay token)');
            setSyncError('Documentos guardados localmente. Inicia sesión como administrador para sincronizar con el servidor.');
          }
          
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  // Eliminar documento
  const deleteDocument = (clientId, month) => {
    setClientDocuments(prev => {
      const newDocs = { ...prev };
      if (newDocs[clientId]) {
        delete newDocs[clientId][month];
        if (Object.keys(newDocs[clientId]).length === 0) {
          delete newDocs[clientId];
        }
      }
      return newDocs;
    });
    
    const key = `${clientId}-${month}`;
    setCompletedData(prev => {
      const newData = { ...prev };
      delete newData[key];
      return newData;
    });
  };

  const hasDocument = (clientId, month) => {
    return !!clientDocuments[clientId]?.[month];
  };

  const getAvailableMonths = (clientId) => {
    if (!clientId || !clientDocuments[clientId]) return [];
    return MESES.filter(month => hasDocument(clientId, month));
  };

  const getClientDocuments = (clientId) => {
    return clientDocuments[clientId] || {};
  };

  const getClientsWithDocuments = () => {
    return Object.keys(clientDocuments);
  };

  const clientHasAnyDocument = (clientId) => {
    return Object.keys(clientDocuments[clientId] || {}).length > 0;
  };

  return (
    <DocumentsContext.Provider value={{
      MESES,
      clientDocuments,
      completedData,
      currentMonth,
      setCurrentMonth,
      selectedClientId,
      setSelectedClientId,
      backendAvailable,
      isSyncing,
      syncError,
      isDataCorrupted,
      uploadDocument,
      uploadDocumentToAllMonths,
      downloadOriginalFile,
      updateCompletedData,
      getMergedData,
      deleteDocument,
      hasDocument,
      getAvailableMonths,
      getClientDocuments,
      getClientsWithDocuments,
      clientHasAnyDocument,
      syncFromBackend,
      syncToBackend
    }}>
      {children}
    </DocumentsContext.Provider>
  );
}

export function useDocuments() {
  const context = useContext(DocumentsContext);
  if (!context) {
    throw new Error('useDocuments debe usarse dentro de DocumentsProvider');
  }
  return context;
}
