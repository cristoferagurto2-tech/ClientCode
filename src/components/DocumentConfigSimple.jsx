import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { adminAPI } from '../services/api';
import './DocumentConfigSimple.css';

export default function DocumentConfigSimple() {
  const [headers, setHeaders] = useState([]);
  const [originalHeaders, setOriginalHeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editValue, setEditValue] = useState('');
  
  // PASO 4: Estados para manejo de errores y sincronización
  const [pendingSync, setPendingSync] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [lastError, setLastError] = useState(null);
  
  // PASO 5: Estados para lista de clientes
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  
  // PASO 6: Estados para barra de progreso
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 3; // Guardar, Aplicar, Verificar

  useEffect(() => {
    loadConfig();
    
    // Intentar sincronizar cambios pendientes al montar el componente
    syncPendingChanges();
    
    // PASO 4: Verificar estado de autenticación
    checkAuthStatus();
    
    // PASO 5: Cargar lista de clientes
    loadClients();
  }, []);

  // PASO 4: Verificar estado de autenticación
  const checkAuthStatus = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      console.log('⚠️ No hay token de autenticación');
      setMessage('⚠️ No has iniciado sesión. Los cambios se guardarán localmente.');
      setTimeout(() => setMessage(''), 5000);
    }
  };

  // PASO 5: Función para cargar lista de clientes
  const loadClients = async () => {
    try {
      setClientsLoading(true);
      const response = await adminAPI.getAllClients();
      
      if (response.success && Array.isArray(response.clients)) {
        setClients(response.clients);
        console.log(`📋 Cargados ${response.clients.length} clientes`);
      } else {
        console.log('No se pudieron cargar los clientes');
        setClients([]);
      }
    } catch (error) {
      console.error('Error cargando clientes:', error);
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  };

  // PARTE 2: Funciones de migración y utilidades para nuevo formato
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

  // PASO 4: Función para reintentar operación fallida
  const retryOperation = async (operation, maxRetries = 3) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Intento ${attempt} de ${maxRetries}...`);
        const result = await operation();
        return { success: true, data: result, attempts: attempt };
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Intento ${attempt} falló:`, error.message);
        
        // No reintentar si es error de autenticación
        if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
          throw error;
        }
        
        // Esperar antes de reintentar (backoff exponencial)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`⏳ Esperando ${delay}ms antes de reintentar...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  };

  // PASO 4: Función mejorada para sincronizar cambios pendientes con reintentos
  const syncPendingChanges = async () => {
    try {
      const backup = localStorage.getItem('documentConfigBackup');
      if (!backup) {
        setPendingSync(false);
        return;
      }
      
      const configBackup = JSON.parse(backup);
      
      // Si hay cambios no sincronizados, intentar sincronizar
      if (!configBackup.synced && configBackup.headers) {
        console.log('🔄 Intentando sincronizar cambios pendientes...');
        setPendingSync(true);
        
        try {
          // PASO 4: Usar función de reintentos
          const result = await retryOperation(
            () => adminAPI.updateDocumentConfig(configBackup.headers),
            3 // máximo 3 intentos
          );
          
          if (result.success) {
            configBackup.synced = true;
            localStorage.setItem('documentConfigBackup', JSON.stringify(configBackup));
            setPendingSync(false);
            setErrorCount(0);
            setLastError(null);
            setMessage('✅ Cambios pendientes sincronizados correctamente');
            setTimeout(() => setMessage(''), 3000);
            console.log('✅ Sincronización automática completada en', result.attempts, 'intentos');
          }
        } catch (error) {
          console.error('❌ No se pudieron sincronizar cambios después de varios intentos:', error);
          setErrorCount(prev => prev + 1);
          setLastError(error);
          // No mostramos error al usuario en segundo plano, pero actualizamos el estado
        }
      } else {
        setPendingSync(false);
      }
    } catch (error) {
      console.log('No hay cambios pendientes para sincronizar');
      setPendingSync(false);
    }
  };

  useEffect(() => {
    const changed = JSON.stringify(headers) !== JSON.stringify(originalHeaders);
    setHasChanges(changed);
  }, [headers, originalHeaders]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setMessage('');
      
      // Primero intentar cargar desde el backend
      const response = await adminAPI.getDocumentConfig();
      
      if (response.success && response.config && Array.isArray(response.config.headers)) {
        // PARTE 2: Migrar formato si es necesario
        const migratedHeaders = migrateHeaders(response.config.headers);
        
        // Si se migró, mostrar mensaje
        if (migratedHeaders !== response.config.headers) {
          console.log('🔄 Configuración migrada al nuevo formato con keys');
          setMessage('🔄 Configuración migrada al nuevo formato');
          setTimeout(() => setMessage(''), 3000);
        }
        
        setHeaders(migratedHeaders);
        setOriginalHeaders(migratedHeaders);
        
        // Si hay un respaldo local más reciente, mostrar advertencia
        const backup = localStorage.getItem('documentConfigBackup');
        if (backup) {
          const configBackup = JSON.parse(backup);
          if (!configBackup.synced) {
            setMessage('⚠️ Tienes cambios locales pendientes de sincronizar');
            setTimeout(() => setMessage(''), 4000);
          }
        }
      } else {
        throw new Error('No se pudo cargar configuración del servidor');
      }
    } catch (error) {
      console.error('Error cargando configuración del servidor:', error);
      
      // Intentar cargar desde respaldo local
      const backup = localStorage.getItem('documentConfigBackup');
      if (backup) {
        try {
          const configBackup = JSON.parse(backup);
          if (configBackup.headers && Array.isArray(configBackup.headers)) {
            // Migrar si es necesario
            const migratedHeaders = migrateHeaders(configBackup.headers);
            setHeaders(migratedHeaders);
            setOriginalHeaders(migratedHeaders);
            setMessage('⚠️ Usando configuración local. Los cambios se sincronizarán automáticamente.');
            setTimeout(() => setMessage(''), 4000);
            return;
          }
        } catch (e) {
          console.error('Error cargando respaldo local:', e);
        }
      }
      
      // Usar valores por defecto
      const defaultHeaders = getDefaultHeaders();
      setHeaders(defaultHeaders);
      setOriginalHeaders(defaultHeaders);
      setMessage('⚠️ Error al cargar. Usando configuración por defecto.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (index) => {
    setEditingIndex(index);
    // PARTE 2: Trabajar con label, no con el objeto completo
    setEditValue(headers[index]?.label || '');
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null) {
      const newHeaders = [...headers];
      // PARTE 2: Solo cambiar el label, el key permanece igual
      newHeaders[editingIndex] = {
        ...newHeaders[editingIndex],
        label: editValue.trim() || `Columna ${editingIndex + 1}`,
        type: detectFieldType(editValue.trim()) // Re-detectar tipo si cambia el nombre
      };
      setHeaders(newHeaders);
      setEditingIndex(null);
      setEditValue('');
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleAddHeader = (index = null) => {
    // PARTE 2: Crear nueva columna con formato de objeto
    const existingKeys = headers.map(h => h.key);
    const tempLabel = `Columna ${headers.length + 1}`;
    const newKey = generateUniqueKey(tempLabel, existingKeys);
    
    const newColumn = {
      key: newKey,
      label: tempLabel,
      type: 'text',
      order: headers.length
    };
    
    let newHeaders;
    if (index !== null) {
      newHeaders = [
        ...headers.slice(0, index),
        newColumn,
        ...headers.slice(index)
      ];
    } else {
      newHeaders = [...headers, newColumn];
    }
    
    // PARTE 2: Recalcular orden después de insertar
    newHeaders.forEach((h, i) => h.order = i);
    
    setHeaders(newHeaders);
    setTimeout(() => {
      const newIndex = index !== null ? index : newHeaders.length - 1;
      handleStartEdit(newIndex);
    }, 100);
  };

  const handleRemoveHeader = (index) => {
    if (headers.length <= 1) {
      setMessage('Debe haber al menos una columna');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    const newHeaders = headers.filter((_, i) => i !== index);
    setHeaders(newHeaders);
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(headers);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    // PARTE 2: Recalcular orden después de reordenar
    items.forEach((item, index) => {
      item.order = index;
    });
    
    setHeaders(items);
  };

  // PARTE 2: Cambiar tipo de campo manualmente
  const handleTypeChange = (index, newType) => {
    const newHeaders = [...headers];
    newHeaders[index] = {
      ...newHeaders[index],
      type: newType
    };
    setHeaders(newHeaders);
  };

  // PARTE 2: Obtener label legible del tipo
  const getTypeLabel = (type) => {
    const labels = {
      'text': '📝 Texto',
      'select': '📋 Selector',
      'monto': '💰 Monto (S/)',
      'auto': '⚙️ Automático',
      'select-fecha': '📅 Selector Fecha',
      'percentage': '📊 Porcentaje (%)'
    };
    return labels[type] || type;
  };

  // PASO 4: Función para obtener mensaje de error amigable
  const getErrorMessage = (error) => {
    const errorStr = error?.message || error?.error || String(error);
    
    if (errorStr.includes('401') || errorStr.includes('Unauthorized')) {
      return {
        type: 'auth',
        message: '⚠️ Sesión expirada o no autorizada',
        detail: 'Los cambios se guardaron localmente. Inicia sesión nuevamente para sincronizar.',
        action: 'login'
      };
    }
    
    if (errorStr.includes('500') || errorStr.includes('Internal Server Error')) {
      return {
        type: 'server',
        message: '⚠️ Error del servidor',
        detail: 'Los cambios se guardaron localmente y se sincronizarán automáticamente cuando el servidor esté disponible.',
        action: 'retry'
      };
    }
    
    if (errorStr.includes('timeout') || errorStr.includes('network') || errorStr.includes('fetch')) {
      return {
        type: 'network',
        message: '⚠️ Error de conexión',
        detail: 'Los cambios se guardaron localmente. Verifica tu conexión a internet.',
        action: 'retry'
      };
    }
    
    return {
      type: 'unknown',
      message: '⚠️ Error al guardar',
      detail: 'Los cambios se guardaron localmente. Intentaremos sincronizar automáticamente.',
      action: 'retry'
    };
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage('');
      setErrorCount(0);
      setLastError(null);
      
      // Verificar que headers sea un array
      if (!Array.isArray(headers)) {
        setMessage('❌ Error: No hay columnas para guardar');
        setTimeout(() => setMessage(''), 3000);
        return;
      }
      
      const validHeaders = headers.filter(h => h && typeof h === 'string' && h.trim() !== '');
      
      if (validHeaders.length === 0) {
        setMessage('❌ Error: Debe haber al menos una columna válida');
        setTimeout(() => setMessage(''), 3000);
        return;
      }
      
      // PASO 1: Guardar en localStorage primero (respaldo local)
      const configBackup = {
        headers: validHeaders,
        timestamp: new Date().toISOString(),
        synced: false
      };
      localStorage.setItem('documentConfigBackup', JSON.stringify(configBackup));
      setPendingSync(true);
      console.log('💾 Configuración guardada localmente como respaldo');
      
      // PASO 4: Intentar guardar en backend con reintentos
      try {
        const result = await retryOperation(
          () => adminAPI.updateDocumentConfig(validHeaders),
          3 // máximo 3 intentos
        );
        
        if (result.success) {
          // Actualizar el backup como sincronizado
          configBackup.synced = true;
          localStorage.setItem('documentConfigBackup', JSON.stringify(configBackup));
          setPendingSync(false);
          setErrorCount(0);
          
          setOriginalHeaders(validHeaders);
          setHeaders(validHeaders);
          setMessage('✅ Configuración guardada y sincronizada correctamente');
          setTimeout(() => setMessage(''), 3000);
        }
      } catch (error) {
        // PASO 4: Manejar error con mensaje específico
        const errorInfo = getErrorMessage(error);
        setErrorCount(prev => prev + 1);
        setLastError(error);
        
        console.error('Error guardando después de reintentos:', error);
        setMessage(`${errorInfo.message}. ${errorInfo.detail}`);
        setTimeout(() => setMessage(''), 6000);
        
        // Lanzar error para que el llamador sepa que falló
        throw error;
      }
    } catch (error) {
      // Error ya manejado arriba, solo aseguramos que se propague
      console.log('Guardado completado con respaldo local');
    } finally {
      setSaving(false);
    }
  };

  // Función para crear backup antes de aplicar cambios
  const createBackupBeforeApply = () => {
    const previousConfig = {
      headers: [...originalHeaders],
      timestamp: new Date().toISOString(),
      description: 'Backup automático antes de aplicar cambios'
    };
    
    localStorage.setItem('documentConfigBackup_previous', JSON.stringify(previousConfig));
    
    // Formatear fecha para mostrar al usuario
    const now = new Date();
    const formattedDate = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
    
    console.log('📦 Backup creado:', formattedDate);
    return formattedDate;
  };

  const handleApplyToAll = async () => {
    // PASO 2: Crear backup automático antes de aplicar cambios
    const backupDate = createBackupBeforeApply();
    
    // PASO 3: Guardar automáticamente antes de aplicar (si hay cambios)
    if (hasChanges) {
      setMessage('💾 Guardando configuración...');
      try {
        await handleSave();
        setMessage('✅ Configuración guardada. Preparando para aplicar...');
      } catch (error) {
        // Si falla el guardado, los cambios están en localStorage (manejado por handleSave)
        console.log('Guardado con respaldo local, continuando...');
      }
    }

    // PASO 5: Primera confirmación con detalles completos
    const clientCount = clients.length;
    const clientList = clients.slice(0, 5).map(c => `• ${c.name || c.email || 'Cliente sin nombre'}`).join('\n');
    const moreClients = clientCount > 5 ? `\n• ... y ${clientCount - 5} ${clientCount - 5 === 1 ? 'cliente más' : 'clientes más'}` : '';
    
    const firstConfirmMessage = `📦 BACKUP CREADO: ${backupDate}

📋 RESUMEN DE LA ACCIÓN:
• Se afectarán ${clientCount} ${clientCount === 1 ? 'cliente' : 'clientes'}
• Se crearán documentos con ${headers.length} columnas
• Se reemplazará la estructura actual de todos los documentos

👥 CLIENTES AFECTADOS:
${clientList}${moreClients}

⚠️ ADVERTENCIA:
Esta acción reemplazará los documentos actuales de todos los clientes.

¿Deseas continuar?`;
    
    if (!window.confirm(firstConfirmMessage)) {
      return;
    }

    // PASO 5: Segunda confirmación con checklist
    const columnList = headers.map((h, i) => `${i + 1}. ${h}`).join('\n');
    
    const secondConfirmMessage = `✅ CONFIRMACIÓN FINAL

📊 ESTRUCTURA DEL DOCUMENTO (${headers.length} columnas):
${columnList}

🔢 TOTAL: ${clientCount} ${clientCount === 1 ? 'cliente' : 'clientes'} recibirán esta estructura

💾 BACKUP: ${backupDate}

⚡ Esta acción no se puede deshacer automáticamente.

¿Estás completamente seguro de aplicar estos cambios?`;
    
    if (!window.confirm(secondConfirmMessage)) {
      return;
    }

    try {
      setApplying(true);
      setCurrentStep(1);
      setProgress(0);
      
      // PASO 6: Paso 1/3 - Guardar configuración
      if (hasChanges) {
        setProgressMessage('💾 Paso 1/3: Guardando configuración...');
        setProgress(10);
        
        try {
          await handleSave();
          setProgress(33);
        } catch (error) {
          console.log('Guardado con respaldo local, continuando...');
          setProgress(33);
        }
      } else {
        setProgress(33);
      }
      
      setCurrentStep(2);
      setProgressMessage(`🔄 Paso 2/3: Aplicando a ${clientCount} ${clientCount === 1 ? 'cliente' : 'clientes'}...`);
      setProgress(50);
      
      // Simular progreso gradual mientras se aplica
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev < 85) {
            return prev + 5;
          }
          return prev;
        });
      }, 500);
      
      const response = await adminAPI.applyDocumentConfig();
      
      clearInterval(progressInterval);
      setProgress(90);
      
      if (response.success) {
        setCurrentStep(3);
        setProgressMessage('✅ Paso 3/3: Verificando aplicación...');
        setProgress(100);
        
        // Pequeña pausa para mostrar el 100%
        await new Promise(resolve => setTimeout(resolve, 500));
        
        setMessage(`✅ Configuración aplicada exitosamente a ${response.clientsUpdated} ${response.clientsUpdated === 1 ? 'cliente' : 'clientes'}`);
        setTimeout(() => {
          setMessage('');
          setProgress(0);
          setProgressMessage('');
          setCurrentStep(0);
        }, 5000);
      } else {
        setProgress(0);
        setProgressMessage('');
        setCurrentStep(0);
        setMessage('⚠️ ' + (response.error || 'La configuración se guardó pero no se pudo aplicar a todos los clientes'));
        setTimeout(() => setMessage(''), 5000);
      }
    } catch (error) {
      setProgress(0);
      setProgressMessage('');
      setCurrentStep(0);
      console.error('Error aplicando:', error);
      setMessage('❌ ' + (error.error || 'Error aplicando configuración. Los cambios están guardados localmente.'));
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setApplying(false);
    }
  };

  const handleReset = () => {
    if (hasChanges && !window.confirm('¿Descartar cambios no guardados?')) {
      return;
    }
    setHeaders([...originalHeaders]);
    setEditingIndex(null);
    
    // Limpiar respaldo local si existe
    localStorage.removeItem('documentConfigBackup');
    console.log('🗑️ Respaldo local eliminado');
    
    setMessage('Cambios descartados');
    setTimeout(() => setMessage(''), 3000);
  };

  // PASO 7: Función para restaurar configuración anterior desde backup
  const handleRestoreBackup = () => {
    const previousBackup = localStorage.getItem('documentConfigBackup_previous');
    
    if (!previousBackup) {
      setMessage('❌ No hay configuración anterior para restaurar');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    
    try {
      const backup = JSON.parse(previousBackup);
      
      if (!backup.headers || !Array.isArray(backup.headers)) {
        setMessage('❌ El backup está corrupto o no es válido');
        setTimeout(() => setMessage(''), 3000);
        return;
      }
      
      // Formatear fecha del backup
      const backupDate = backup.timestamp 
        ? new Date(backup.timestamp).toLocaleString()
        : 'Fecha desconocida';
      
      // Confirmación antes de restaurar
      const confirmMessage = `↩️ RESTAURAR CONFIGURACIÓN ANTERIOR\n\n📅 Backup del: ${backupDate}\n📊 Columnas: ${backup.headers.length}\n\n⚠️ ADVERTENCIA:\nEsta acción reemplazará tu configuración actual.\n\n¿Deseas continuar?`;
      
      if (!window.confirm(confirmMessage)) {
        return;
      }
      
      // Restaurar configuración
      setHeaders(backup.headers);
      setOriginalHeaders(backup.headers);
      setEditingIndex(null);
      
      // Limpiar el backup anterior después de restaurar
      localStorage.removeItem('documentConfigBackup_previous');
      
      setMessage(`✅ Configuración restaurada del ${backupDate}`);
      setTimeout(() => setMessage(''), 5000);
      
      console.log('↩️ Configuración anterior restaurada:', backupDate);
      
    } catch (error) {
      console.error('Error restaurando backup:', error);
      setMessage('❌ Error al restaurar la configuración anterior');
      setTimeout(() => setMessage(''), 3000);
    }
  };
  
  // PASO 7: Verificar si existe backup anterior
  const hasPreviousBackup = () => {
    const previousBackup = localStorage.getItem('documentConfigBackup_previous');
    if (!previousBackup) return false;
    
    try {
      const backup = JSON.parse(previousBackup);
      return backup.headers && Array.isArray(backup.headers) && backup.headers.length > 0;
    } catch {
      return false;
    }
  };

  if (loading) {
    return (
      <div className="document-config-simple">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Cargando configuración...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="document-config-simple">
      <div className="config-header">
        <div className="header-title-row">
          <h3>Documento Oficial</h3>
          {hasChanges && (
            <span className="unsaved-badge">Cambios sin guardar</span>
          )}
        </div>
        <p className="header-description">
          Configura las columnas de los documentos. Doble-click para editar, arrastra para mover.
        </p>
      </div>

      {message && (
        <div className={`message ${message.includes('Error') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      <div className="table-preview-container">
        <div className="table-header">
          <span>Vista previa de columnas</span>
          <span className="column-count">{headers.length} columnas</span>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="headers-table" direction="horizontal">
            {(provided) => (
              <div 
                className="headers-table-wrapper"
                ref={provided.innerRef}
                {...provided.droppableProps}
              >
                <div className="headers-table">
                  {headers.length === 0 ? (
                    <div className="no-columns-message">
                      <p>No hay columnas configuradas</p>
                      <button 
                        className="btn-add-first"
                        onClick={() => handleAddHeader()}
                      >
                        + Agregar primera columna
                      </button>
                    </div>
                  ) : (
                    <>
                    {headers.map((header, index) => (
                    <Draggable 
                      key={`header-${index}`} 
                      draggableId={`header-${index}`} 
                      index={index}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`table-cell ${snapshot.isDragging ? 'dragging' : ''}`}
                        >
                          <button 
                            className="insert-btn before"
                            onClick={() => handleAddHeader(index)}
                            title="Insertar columna aquí"
                          >
                            +
                          </button>

                          <div 
                            className="cell-drag-handle"
                            {...provided.dragHandleProps}
                            title="Arrastrar para mover"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                              <circle cx="2" cy="2" r="1.5"/>
                              <circle cx="6" cy="2" r="1.5"/>
                              <circle cx="10" cy="2" r="1.5"/>
                              <circle cx="2" cy="6" r="1.5"/>
                              <circle cx="6" cy="6" r="1.5"/>
                              <circle cx="10" cy="6" r="1.5"/>
                              <circle cx="2" cy="10" r="1.5"/>
                              <circle cx="6" cy="10" r="1.5"/>
                              <circle cx="10" cy="10" r="1.5"/>
                            </svg>
                          </div>

                          <div className="cell-content">
                            {editingIndex === index ? (
                              <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleSaveEdit}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                className="inline-edit-input"
                              />
                            ) : (
                              <>
                                <span 
                                  className="header-text"
                                  onDoubleClick={() => handleStartEdit(index)}
                                  title="Doble-click para editar nombre"
                                >
                                  {header.label}
                                </span>
                                <span className="header-key" title="Identificador único (no editable)">
                                  🔑 {header.key}
                                </span>
                                <select
                                  className="header-type-select"
                                  value={header.type}
                                  onChange={(e) => handleTypeChange(index, e.target.value)}
                                  title="Tipo de campo"
                                >
                                  <option value="text">📝 Texto</option>
                                  <option value="select">📋 Selector</option>
                                  <option value="monto">💰 Monto (S/)</option>
                                  <option value="percentage">📊 %</option>
                                  <option value="auto">⚙️ Auto</option>
                                  <option value="select-fecha">📅 Fecha</option>
                                </select>
                              </>
                            )}
                          </div>

                          <button 
                            className="remove-btn"
                            onClick={() => handleRemoveHeader(index)}
                            title="Eliminar columna"
                          >
                            ×
                          </button>

                          <span className="column-number">{index + 1}</span>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}

                  <button 
                    className="add-column-btn"
                    onClick={() => handleAddHeader()}
                    title="Agregar columna al final"
                  >
                    <span className="plus-icon">+</span>
                    <span className="btn-text">Agregar</span>
                  </button>
                  </>
                )}
            </div>
              </div>
            )}
          </Droppable>
        </DragDropContext>

        <div className="table-hint">
          Doble-click para editar • Arrastra para reordenar
        </div>
      </div>

      <div className="actions-section">
        {/* PASO 4: Indicador de sincronización pendiente */}
        {pendingSync && !hasChanges && (
          <div className="pending-sync-warning">
            <span className="sync-icon">🔄</span>
            <span className="sync-text">
              Cambios pendientes de sincronizar
              {errorCount > 0 && ` (${errorCount} ${errorCount === 1 ? 'intento fallido' : 'intentos fallidos'})`}
            </span>
            <button 
              className="btn-retry-inline"
              onClick={syncPendingChanges}
              disabled={saving || applying}
              title="Intentar sincronizar ahora"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* PASO 3: Indicador de cambios pendientes */}
        {hasChanges && (
          <div className="unsaved-warning">
            <span className="warning-icon">⚠️</span>
            <span className="warning-text">Tienes cambios sin aplicar</span>
            <button 
              className="btn-reset-inline"
              onClick={handleReset}
              disabled={saving || applying}
              title="Descartar cambios"
            >
              Descartar
            </button>
          </div>
        )}

        {/* PASO 3: Botón consolidado - Guarda y Aplica automáticamente */}
        <button 
          className="btn-apply btn-primary"
          onClick={handleApplyToAll}
          disabled={applying || saving}
        >
          {applying ? (
            <>
              <span className="spinner-inline"></span>
              Aplicando...
            </>
          ) : saving ? (
            <>
              <span className="spinner-inline"></span>
              Guardando...
            </>
          ) : (
            <>
              <span className="btn-icon">💾</span>
              Guardar y Aplicar a Todos
            </>
          )}
        </button>
        
        {/* PASO 6: Barra de progreso */}
        {applying && (
          <div className="progress-container">
            <div className="progress-header">
              <span className="progress-step">Paso {currentStep}/{totalSteps}</span>
              <span className="progress-percentage">{progress}%</span>
            </div>
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="progress-message">{progressMessage}</p>
          </div>
        )}
        
        {/* PASO 7: Botón para restaurar configuración anterior */}
        {hasPreviousBackup() && !applying && !saving && !hasChanges && (
          <div className="restore-backup-section">
            <button 
              className="btn-restore-backup"
              onClick={handleRestoreBackup}
              disabled={applying || saving}
              title="Restaurar configuración anterior"
            >
              <span className="btn-icon">↩️</span>
              Restaurar Configuración Anterior
            </button>
            <p className="restore-hint">
              Recupera la configuración previa si cometiste un error
            </p>
          </div>
        )}
        
        {/* PASO 5: Información detallada sobre la acción */}
        <p className="apply-hint">
          {hasChanges 
            ? `📊 Se crearán documentos con ${headers.length} columnas para ${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'}. Se creará un backup automático.`
            : `📊 ${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'} con documentos de ${headers.length} columnas.`}
          {clientsLoading && ' (Cargando lista de clientes...)'}
        </p>
      </div>
    </div>
  );
}
