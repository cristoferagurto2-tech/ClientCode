const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const User = require('../models/User');
const Document = require('../models/Document');
const Client = require('../models/Client');
const DocumentTemplate = require('../models/DocumentTemplate');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Meses del año
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// @route   GET /api/admin/clients
// @desc    Obtener todos los clientes
// @access  Admin Only
router.get('/clients', protect, adminOnly, async (req, res) => {
  try {
    const clients = await User.find({ role: 'client' })
      .select('-password')
      .sort({ registeredAt: -1 });

    // Obtener información adicional de cada cliente
    const clientsWithDetails = await Promise.all(
      clients.map(async (client) => {
        const clientInfo = await Client.findOne({ userId: client._id });
        const documentsCount = await Document.countDocuments({ clientId: client._id });
        const trialStatus = client.getTrialStatus();

        return {
          id: client._id,
          name: client.name,
          email: client.email,
          registeredAt: client.registeredAt,
          lastLogin: client.lastLogin,
          isSubscribed: client.isSubscribed,
          subscribedAt: client.subscribedAt,
          trialStatus,
          documentsCount,
          phone: clientInfo?.phone || '',
          address: clientInfo?.address || ''
        };
      })
    );

    res.json({
      success: true,
      count: clients.length,
      clients: clientsWithDetails
    });
  } catch (error) {
    console.error('Error obteniendo clientes:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo lista de clientes'
    });
  }
});

// @route   GET /api/admin/clients/:clientId
// @desc    Obtener detalles de un cliente específico
// @access  Admin Only
router.get('/clients/:clientId', protect, adminOnly, async (req, res) => {
  try {
    const { clientId } = req.params;

    const client = await User.findById(clientId).select('-password');
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    const clientInfo = await Client.findOne({ userId: client._id });
    const documents = await Document.find({ clientId: client._id });
    const trialStatus = client.getTrialStatus();

    res.json({
      success: true,
      client: {
        id: client._id,
        name: client.name,
        email: client.email,
        role: client.role,
        registeredAt: client.registeredAt,
        lastLogin: client.lastLogin,
        isSubscribed: client.isSubscribed,
        subscribedAt: client.subscribedAt,
        trialStatus,
        phone: clientInfo?.phone || '',
        address: clientInfo?.address || '',
        businessName: clientInfo?.businessName || '',
        notes: clientInfo?.notes || ''
      },
      documents: documents.map(doc => ({
        id: doc._id,
        month: doc.month,
        year: doc.year,
        lastModified: doc.lastModified
      }))
    });
  } catch (error) {
    console.error('Error obteniendo cliente:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo información del cliente'
    });
  }
});

// @route   GET /api/admin/clients/:clientId/documents
// @desc    Obtener todos los documentos de un cliente
// @access  Admin Only
router.get('/clients/:clientId/documents', protect, adminOnly, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Verificar que el cliente existe
    const client = await User.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    const documents = await Document.find({ clientId });

    res.json({
      success: true,
      count: documents.length,
      documents: documents.map(doc => ({
        id: doc._id,
        month: doc.month,
        year: doc.year,
        headers: doc.headers,
        data: doc.getMergedData().data,
        completedData: doc.completedData,
        lastModified: doc.lastModified,
        uploadedAt: doc.uploadedAt
      }))
    });
  } catch (error) {
    console.error('Error obteniendo documentos:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo documentos del cliente'
    });
  }
});

// @route   POST /api/admin/clients/:clientId/documents/:month
// @desc    Subir/actualizar documento para un cliente (admin)
// @access  Admin Only
router.post('/clients/:clientId/documents/:month', protect, adminOnly, async (req, res) => {
  try {
    const { clientId, month } = req.params;
    const { headers, data, completedData, year } = req.body;

    // Verificar que el cliente existe
    const client = await User.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    // Buscar documento existente o crear nuevo
    let document = await Document.findOne({ clientId, month, year: year || 2026 });

    if (document) {
      // Actualizar documento existente
      document.headers = headers || document.headers;
      document.data = data || document.data;
      if (completedData) {
        document.completedData = completedData;
      }
      document.lastModified = new Date();
      await document.save();
    } else {
      // Crear nuevo documento
      document = await Document.create({
        clientId,
        month,
        year: year || 2026,
        headers: headers || [],
        data: data || [],
        completedData: completedData || [],
        uploadedAt: new Date(),
        lastModified: new Date()
      });
    }

    res.json({
      success: true,
      message: `Documento de ${month} guardado correctamente`,
      document: {
        id: document._id,
        month: document.month,
        year: document.year,
        lastModified: document.lastModified
      }
    });
  } catch (error) {
    console.error('Error guardando documento:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando documento del cliente'
    });
  }
});

// @route   DELETE /api/admin/clients/:clientId/documents/:month
// @desc    Eliminar documento de un cliente
// @access  Admin Only
router.delete('/clients/:clientId/documents/:month', protect, adminOnly, async (req, res) => {
  try {
    const { clientId, month } = req.params;
    const { year } = req.query;

    const result = await Document.deleteOne({
      clientId,
      month,
      year: year || 2026
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Documento no encontrado'
      });
    }

    res.json({
      success: true,
      message: `Documento de ${month} eliminado correctamente`
    });
  } catch (error) {
    console.error('Error eliminando documento:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando documento'
    });
  }
});

// @route   GET /api/admin/dashboard
// @desc    Obtener dashboard global (todos los clientes)
// @access  Admin Only
router.get('/dashboard', protect, adminOnly, async (req, res) => {
  try {
    // Estadísticas generales
    const totalClients = await User.countDocuments({ role: 'client' });
    const subscribedClients = await User.countDocuments({ role: 'client', isSubscribed: true });
    const totalDocuments = await Document.countDocuments();

    // Clientes activos (que han hecho login en los últimos 30 días)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeClients = await User.countDocuments({
      role: 'client',
      lastLogin: { $gte: thirtyDaysAgo }
    });

    // Documentos por mes
    const documentsByMonth = await Document.aggregate([
      {
        $group: {
          _id: '$month',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Clientes nuevos por mes
    const clientsByMonth = await User.aggregate([
      {
        $match: { role: 'client' }
      },
      {
        $group: {
          _id: {
            year: { $year: '$registeredAt' },
            month: { $month: '$registeredAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 6 }
    ]);

    res.json({
      success: true,
      stats: {
        totalClients,
        subscribedClients,
        totalDocuments,
        activeClients,
        conversionRate: totalClients > 0 
          ? ((subscribedClients / totalClients) * 100).toFixed(1) 
          : 0
      },
      documentsByMonth,
      clientsByMonth
    });
  } catch (error) {
    console.error('Error obteniendo dashboard admin:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo dashboard de administración'
    });
  }
});

// @route   PUT /api/admin/clients/:clientId/subscribe
// @desc    Suscribir/desuscribir un cliente manualmente
// @access  Admin Only
router.put('/clients/:clientId/subscribe', protect, adminOnly, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { isSubscribed } = req.body;

    const client = await User.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    client.isSubscribed = isSubscribed;
    if (isSubscribed) {
      client.subscribedAt = new Date();
    } else {
      client.subscribedAt = null;
    }

    await client.save();

    res.json({
      success: true,
      message: isSubscribed 
        ? 'Cliente suscrito correctamente' 
        : 'Suscripción cancelada',
      client: {
        id: client._id,
        name: client.name,
        email: client.email,
        isSubscribed: client.isSubscribed
      }
    });
  } catch (error) {
    console.error('Error actualizando suscripción:', error);
    res.status(500).json({
      success: false,
      error: 'Error actualizando suscripción del cliente'
    });
  }
});

// @route   PUT /api/admin/clients/:clientId/vip
// @desc    Marcar/desmarcar un cliente como VIP
// @access  Admin Only
router.put('/clients/:clientId/vip', protect, adminOnly, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { isVip } = req.body;

    const client = await User.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    client.isVip = isVip;
    await client.save();

    res.json({
      success: true,
      message: isVip 
        ? 'Cliente marcado como VIP correctamente' 
        : 'Cliente desmarcado como VIP',
      client: {
        id: client._id,
        name: client.name,
        email: client.email,
        isVip: client.isVip
      }
    });
  } catch (error) {
    console.error('Error actualizando estado VIP:', error);
    res.status(500).json({
      success: false,
      error: 'Error actualizando estado VIP del cliente'
    });
  }
});

// @route   DELETE /api/admin/clients/:clientId
// @desc    Eliminar un cliente y todos sus datos
// @access  Admin Only
router.delete('/clients/:clientId', protect, adminOnly, async (req, res) => {
  try {
    const { clientId } = req.params;

    const client = await User.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    // Eliminar documentos del cliente
    await Document.deleteMany({ clientId });

    // Eliminar perfil de cliente
    await Client.deleteOne({ userId: clientId });

    // Eliminar usuario
    await User.findByIdAndDelete(clientId);

    res.json({
      success: true,
      message: 'Cliente y todos sus datos eliminados correctamente'
    });
  } catch (error) {
    console.error('Error eliminando cliente:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando cliente'
    });
  }
});

// @route   POST /api/admin/create-admin
// @desc    Crear usuario administrador (solo para setup inicial)
// @access  Public (solo si no hay admins)
router.post('/create-admin', async (req, res) => {
  try {
    const { name, email, password, secretKey } = req.body;

    // Verificar secret key (debe coincidir con variable de entorno)
    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Clave secreta inválida'
      });
    }

    // Verificar si ya existe un admin
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un administrador'
      });
    }

    // Crear admin
    const admin = await User.create({
      name: name || 'Administrador',
      email: email.toLowerCase(),
      password,
      role: 'admin',
      isSubscribed: true
    });

    res.status(201).json({
      success: true,
      message: 'Administrador creado correctamente',
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Error creando admin:', error);
    res.status(500).json({
      success: false,
      error: 'Error creando administrador'
    });
  }
});

// ============================================
// ENDPOINTS PARA GESTIÓN DE PLANTILLAS
// ============================================

// @route   GET /api/admin/templates
// @desc    Obtener todas las plantillas
// @access  Admin Only
router.get('/templates', protect, adminOnly, async (req, res) => {
  try {
    const templates = await DocumentTemplate.find({ isActive: true })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: templates.length,
      templates: templates.map(t => ({
        id: t._id,
        name: t.name,
        description: t.description,
        isOfficial: t.isOfficial,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt
      }))
    });
  } catch (error) {
    console.error('Error obteniendo plantillas:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo plantillas'
    });
  }
});

// @route   GET /api/admin/templates/official
// @desc    Obtener la plantilla oficial
// @access  Admin Only
router.get('/templates/official', protect, adminOnly, async (req, res) => {
  try {
    const template = await DocumentTemplate.getOfficialTemplate();

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'No hay plantilla oficial configurada'
      });
    }

    res.json({
      success: true,
      template: {
        id: template._id,
        name: template.name,
        description: template.description,
        headers: template.headers,
        data: template.data,
        completedData: template.completedData,
        isOfficial: template.isOfficial,
        createdAt: template.createdAt
      }
    });
  } catch (error) {
    console.error('Error obteniendo plantilla oficial:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo plantilla oficial'
    });
  }
});

// @route   POST /api/admin/templates
// @desc    Crear nueva plantilla
// @access  Admin Only
router.post('/templates', protect, adminOnly, async (req, res) => {
  try {
    const { name, description, headers, data, completedData, isOfficial } = req.body;

    if (!name || !headers || !data) {
      return res.status(400).json({
        success: false,
        error: 'Nombre, headers y datos son obligatorios'
      });
    }

    const template = await DocumentTemplate.create({
      name,
      description: description || '',
      headers,
      data,
      completedData: completedData || [],
      isOfficial: isOfficial || false,
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      message: 'Plantilla creada correctamente',
      template: {
        id: template._id,
        name: template.name,
        description: template.description,
        isOfficial: template.isOfficial,
        createdAt: template.createdAt
      }
    });
  } catch (error) {
    console.error('Error creando plantilla:', error);
    res.status(500).json({
      success: false,
      error: 'Error creando plantilla'
    });
  }
});

// @route   PUT /api/admin/templates/:id
// @desc    Actualizar plantilla
// @access  Admin Only
router.put('/templates/:id', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, headers, data, completedData } = req.body;

    const template = await DocumentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Plantilla no encontrada'
      });
    }

    // Actualizar campos
    if (name) template.name = name;
    if (description !== undefined) template.description = description;
    if (headers) template.headers = headers;
    if (data) template.data = data;
    if (completedData) template.completedData = completedData;

    await template.save();

    res.json({
      success: true,
      message: 'Plantilla actualizada correctamente',
      template: {
        id: template._id,
        name: template.name,
        description: template.description,
        isOfficial: template.isOfficial,
        updatedAt: template.updatedAt
      }
    });
  } catch (error) {
    console.error('Error actualizando plantilla:', error);
    res.status(500).json({
      success: false,
      error: 'Error actualizando plantilla'
    });
  }
});

// @route   PUT /api/admin/templates/:id/official
// @desc    Establecer plantilla como oficial
// @access  Admin Only
router.put('/templates/:id/official', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const template = await DocumentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Plantilla no encontrada'
      });
    }

    // Marcar como oficial (el middleware pre-save desactivará las demás)
    template.isOfficial = true;
    await template.save();

    res.json({
      success: true,
      message: 'Plantilla establecida como oficial',
      template: {
        id: template._id,
        name: template.name,
        isOfficial: template.isOfficial
      }
    });
  } catch (error) {
    console.error('Error estableciendo plantilla oficial:', error);
    res.status(500).json({
      success: false,
      error: 'Error estableciendo plantilla oficial'
    });
  }
});

// @route   DELETE /api/admin/templates/:id
// @desc    Eliminar plantilla (desactivar)
// @access  Admin Only
router.delete('/templates/:id', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const template = await DocumentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Plantilla no encontrada'
      });
    }

    // Desactivar en lugar de eliminar físicamente
    template.isActive = false;
    if (template.isOfficial) {
      template.isOfficial = false;
    }
    await template.save();

    res.json({
      success: true,
      message: 'Plantilla eliminada correctamente'
    });
  } catch (error) {
    console.error('Error eliminando plantilla:', error);
    res.status(500).json({
      success: false,
      error: 'Error eliminando plantilla'
    });
  }
});

// @route   POST /api/admin/apply-template/:clientId
// @desc    Aplicar plantilla oficial a un cliente específico
// @access  Admin Only
router.post('/apply-template/:clientId', protect, adminOnly, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year } = req.body;

    // Verificar que el cliente existe
    const client = await User.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    // Obtener plantilla oficial
    const template = await DocumentTemplate.getOfficialTemplate();
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'No hay plantilla oficial configurada'
      });
    }

    const targetYear = year || 2026;

    // Eliminar documentos existentes del cliente para ese año
    await Document.deleteMany({ clientId, year: targetYear });

    // Crear nuevos documentos desde la plantilla
    const documentsToCreate = MONTHS.map(month => ({
      clientId,
      month,
      year: targetYear,
      headers: template.headers,
      data: template.data,
      completedData: template.completedData || [],
      originalFile: template.originalFile
    }));

    await Document.insertMany(documentsToCreate);

    res.json({
      success: true,
      message: `Plantilla oficial aplicada correctamente a ${client.name} para el año ${targetYear}`,
      documentsCreated: MONTHS.length
    });
  } catch (error) {
    console.error('Error aplicando plantilla:', error);
    res.status(500).json({
      success: false,
      error: 'Error aplicando plantilla al cliente'
    });
  }
});

// Configuración de multer para archivos Excel
const excelStorage = multer.memoryStorage();
const uploadExcel = multer({
  storage: excelStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB límite
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream'
    ];
    const allowedExtensions = ['.xlsx', '.xls'];
    const fileExtension = file.originalname.toLowerCase();
    
    const hasValidExtension = allowedExtensions.some(ext => fileExtension.endsWith(ext));
    
    if (allowedTypes.includes(file.mimetype) || hasValidExtension) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo archivos Excel (.xlsx, .xls)'), false);
    }
  }
});

// @route   POST /api/admin/templates/upload
// @desc    Subir archivo Excel como plantilla oficial
// @access  Admin Only
router.post('/templates/upload', protect, adminOnly, uploadExcel.single('templateFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No se recibió ningún archivo'
      });
    }

    console.log('📄 Archivo recibido:', req.file.originalname);

    // Leer el archivo Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    
    // Obtener la primera hoja
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    console.log('📊 Procesando hoja:', firstSheetName);

    // Convertir a array de arrays (incluye headers)
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (!rawData || rawData.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El archivo Excel está vacío'
      });
    }

    // Extraer headers (primera fila)
    const headers = rawData[0] || [];
    
    if (headers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No se encontraron headers en el archivo Excel'
      });
    }

    // Limpiar headers (quitar espacios en blanco)
    const cleanHeaders = headers.map(h => String(h || '').trim());

    // Crear estructura de datos vacía manteniendo el formato
    // 50 filas vacías por defecto
    const numCols = cleanHeaders.length;
    const emptyData = Array(50).fill(null).map(() => Array(numCols).fill(''));

    // Convertir archivo a Base64 para almacenar
    const fileBase64 = req.file.buffer.toString('base64');

    // Crear nombre de plantilla basado en el archivo
    const templateName = req.body.name || `Plantilla: ${req.file.originalname.replace(/\.[^/.]+$/, '')}`;
    const templateDescription = req.body.description || `Subida desde archivo: ${req.file.originalname}`;

    console.log('💾 Creando plantilla:', templateName);
    console.log('📋 Headers encontrados:', cleanHeaders.length);

    // Crear la plantilla
    const template = await DocumentTemplate.create({
      name: templateName,
      description: templateDescription,
      headers: cleanHeaders,
      data: emptyData,
      completedData: [],
      originalFile: fileBase64,
      isOfficial: true, // Automáticamente oficial
      createdBy: req.user._id
    });

    console.log('✅ Plantilla creada exitosamente:', template.name);

    res.status(201).json({
      success: true,
      message: 'Archivo Excel subido y establecido como plantilla oficial',
      template: {
        id: template._id,
        name: template.name,
        description: template.description,
        headers: template.headers,
        isOfficial: template.isOfficial,
        createdAt: template.createdAt,
        fileName: req.file.originalname,
        fileSize: req.file.size
      }
    });

  } catch (error) {
    console.error('Error subiendo archivo Excel:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error procesando el archivo Excel'
    });
  }
});

// @route   POST /api/admin/apply-template-all
// @desc    Aplicar plantilla oficial a TODOS los clientes existentes
// @access  Admin Only
router.post('/apply-template-all', protect, adminOnly, async (req, res) => {
  try {
    const { year } = req.body;

    // Obtener plantilla oficial
    const template = await DocumentTemplate.getOfficialTemplate();
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'No hay plantilla oficial configurada'
      });
    }

    const targetYear = year || 2026;

    // Obtener todos los clientes
    const clients = await User.find({ role: 'client' });
    let totalDocumentsCreated = 0;

    // Aplicar plantilla a cada cliente
    for (const client of clients) {
      // Eliminar documentos existentes del cliente para ese año
      await Document.deleteMany({ clientId: client._id, year: targetYear });

      // Crear nuevos documentos desde la plantilla
      const documentsToCreate = MONTHS.map(month => ({
        clientId: client._id,
        month,
        year: targetYear,
        headers: template.headers,
        data: template.data,
        completedData: template.completedData || [],
        originalFile: template.originalFile
      }));

      await Document.insertMany(documentsToCreate);
      totalDocumentsCreated += MONTHS.length;
    }

    res.json({
      success: true,
      message: `Plantilla oficial aplicada a ${clients.length} clientes`,
      clientsUpdated: clients.length,
      documentsCreated: totalDocumentsCreated,
      year: targetYear
    });
  } catch (error) {
    console.error('Error aplicando plantilla a todos los clientes:', error);
    res.status(500).json({
      success: false,
      error: 'Error aplicando plantilla a todos los clientes'
    });
  }
});

// ============================================
// ENDPOINTS SIMPLIFICADOS - DOCUMENTO OFICIAL
// ============================================

const DocumentConfig = require('../models/DocumentConfig');

// @route   GET /api/admin/document-config
// @desc    Obtener configuración actual del documento oficial
// @access  Admin Only
router.get('/document-config', protect, adminOnly, async (req, res) => {
  try {
    const config = await DocumentConfig.getConfig();
    res.json({
      success: true,
      config: {
        headers: config.headers,
        updatedAt: config.updatedAt
      }
    });
  } catch (error) {
    console.error('Error obteniendo configuración:', error);
    res.status(500).json({
      success: false,
      error: 'Error obteniendo configuración del documento'
    });
  }
});

// @route   PUT /api/admin/document-config
// @desc    Actualizar configuración del documento oficial
// @access  Admin Only
router.put('/document-config', protect, adminOnly, async (req, res) => {
  try {
    const { headers } = req.body;
    
    if (!headers || !Array.isArray(headers) || headers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Headers debe ser un array no vacío'
      });
    }
    
    // Validar estructura de cada header
    const validTypes = ['text', 'select', 'monto', 'auto', 'select-fecha', 'percentage'];
    const keys = [];
    
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      
      // Validar que tenga key y label
      if (!h.key || !h.label) {
        return res.status(400).json({
          success: false,
          error: `Header ${i} debe tener 'key' y 'label'`
        });
      }
      
      // Validar formato de key
      if (!/^[a-z0-9_]+$/.test(h.key)) {
        return res.status(400).json({
          success: false,
          error: `Header ${i}: key '${h.key}' solo puede contener letras minúsculas, números y guiones bajos`
        });
      }
      
      // Validar que no haya keys duplicados
      if (keys.includes(h.key)) {
        return res.status(400).json({
          success: false,
          error: `Header ${i}: key '${h.key}' está duplicado`
        });
      }
      keys.push(h.key);
      
      // Validar tipo
      if (h.type && !validTypes.includes(h.type)) {
        return res.status(400).json({
          success: false,
          error: `Header ${i}: tipo '${h.type}' no es válido`
        });
      }
      
      // Asignar orden si no tiene
      if (h.order === undefined) {
        h.order = i;
      }
    }
    
    let config = await DocumentConfig.findOne();
    if (!config) {
      config = new DocumentConfig({
        headers,
        updatedBy: req.user._id
      });
    } else {
      config.headers = headers;
      config.updatedBy = req.user._id;
    }
    
    await config.save();
    
    res.json({
      success: true,
      message: 'Configuración guardada correctamente',
      config: {
        headers: config.headers,
        updatedAt: config.updatedAt
      }
    });
  } catch (error) {
    console.error('Error guardando configuración:', error);
    res.status(500).json({
      success: false,
      error: 'Error guardando configuración'
    });
  }
});

// @route   POST /api/admin/apply-document-config
// @desc    Aplicar configuración actual a TODOS los clientes (PRESERVANDO DATOS)
// @access  Admin Only
router.post('/apply-document-config', protect, adminOnly, async (req, res) => {
  try {
    const config = await DocumentConfig.getConfig();
    const { year } = req.body;
    const targetYear = year || 2026;
    
    // Obtener todos los clientes
    const clients = await User.find({ role: 'client' });
    let totalDocumentsCreated = 0;
    let totalDocumentsUpdated = 0;
    let totalDocumentsPreserved = 0;
    
    for (const client of clients) {
      // Procesar cada mes
      for (const month of MONTHS) {
        // Buscar documento existente
        let document = await Document.findOne({
          clientId: client._id,
          month,
          year: targetYear
        });
        
        if (document) {
          // Documento existe - ACTUALIZAR PRESERVANDO DATOS
          let oldHeaders = document.headers;
          const newHeaders = config.headers;
          
          // Migrar headers del documento si están en formato viejo (strings)
          if (oldHeaders.length > 0 && typeof oldHeaders[0] === 'string') {
            oldHeaders = DocumentConfig.migrateHeaders(oldHeaders);
          }
          
          // Actualizar headers - CONVERTIR OBJETOS A STRINGS (labels)
          document.headers = newHeaders.map(h => typeof h === 'object' ? h.label : h);
          
          // Adaptar los datos existentes a los nuevos headers usando KEYS
          if (document.data && document.data.length > 0) {
            document.data = document.data.map((row, rowIndex) => {
              // Crear nueva fila con los nuevos headers
              const newRow = new Array(newHeaders.length).fill('');
              
              // Copiar datos de columnas que tienen el mismo KEY
              oldHeaders.forEach((oldHeader, oldIndex) => {
                if (row[oldIndex] !== undefined && row[oldIndex] !== '') {
                  // Buscar en nuevos headers por KEY (no por nombre)
                  const newIndex = newHeaders.findIndex(h => h.key === oldHeader.key);
                  if (newIndex !== -1) {
                    newRow[newIndex] = row[oldIndex];
                  }
                }
              });
              
              return newRow;
            });
          }
          
          // Actualizar completedData si existe
          if (document.completedData && document.completedData.length > 0) {
            const newCompletedData = [];
            
            document.completedData.forEach(completed => {
              if (completed.colIndex < oldHeaders.length) {
                const oldHeader = oldHeaders[completed.colIndex];
                // Buscar por KEY en lugar de por nombre
                const newHeader = newHeaders.find(h => h.key === oldHeader.key);
                
                if (newHeader) {
                  const newColIndex = newHeaders.indexOf(newHeader);
                  newCompletedData.push({
                    rowIndex: completed.rowIndex,
                    colIndex: newColIndex
                  });
                }
              }
            });
            
            document.completedData = newCompletedData;
          }
          
          document.lastModified = new Date();
          await document.save();
          totalDocumentsUpdated++;
          
          // Si había más datos de los que caben en las nuevas columnas, contar como preservado parcial
          if (oldHeaders.length > newHeaders.length) {
            totalDocumentsPreserved++;
          }
        } else {
          // Documento no existe - CREAR NUEVO
          const numCols = config.headers.length;
          const emptyData = Array(50).fill(null).map(() => Array(numCols).fill(''));
          
          await Document.create({
            clientId: client._id,
            month,
            year: targetYear,
            headers: config.headers.map(h => h.label),  // CONVERTIR OBJETOS A STRINGS
            data: emptyData,
            completedData: [],
            originalFile: null,
            uploadedAt: new Date(),
            lastModified: new Date()
          });
          
          totalDocumentsCreated++;
        }
      }
    }
    
    res.json({
      success: true,
      message: `Configuración aplicada a ${clients.length} clientes`,
      clientsUpdated: clients.length,
      documentsCreated: totalDocumentsCreated,
      documentsUpdated: totalDocumentsUpdated,
      documentsPreserved: totalDocumentsPreserved,
      year: targetYear,
      headers: config.headers
    });
  } catch (error) {
    console.error('Error aplicando configuración:', error);
    res.status(500).json({
      success: false,
      error: 'Error aplicando configuración a los clientes'
    });
  }
});

// ENDPOINT: Eliminar documentos con headers corruptos
router.delete('/cleanup-corrupt-documents', async (req, res) => {
  try {
    const Document = require('../models/Document');
    
    // Buscar todos los documentos
    const allDocuments = await Document.find({});
    const corruptDocuments = [];
    
    for (const doc of allDocuments) {
      let hasCorruptHeaders = false;
      
      // Verificar si tiene headers corruptos
      if (doc.headers && Array.isArray(doc.headers)) {
        for (const header of doc.headers) {
          // Verificar si es objeto con claves numéricas (formato corrupto)
          if (typeof header === 'object' && header !== null) {
            const keys = Object.keys(header);
            const numericKeys = keys.filter(k => !isNaN(parseInt(k)) && k === String(parseInt(k)));
            if (numericKeys.length > 0) {
              hasCorruptHeaders = true;
              break;
            }
          }
        }
      }
      
      if (hasCorruptHeaders) {
        corruptDocuments.push(doc._id);
      }
    }
    
    // Borrar documentos corruptos
    let deletedCount = 0;
    if (corruptDocuments.length > 0) {
      const result = await Document.deleteMany({ _id: { $in: corruptDocuments } });
      deletedCount = result.deletedCount;
    }
    
    res.json({
      success: true,
      message: `Se eliminaron ${deletedCount} documentos corruptos`,
      totalDocumentsChecked: allDocuments.length,
      corruptDocumentsFound: corruptDocuments.length,
      deletedCount: deletedCount,
      corruptIds: corruptDocuments
    });
    
  } catch (error) {
    console.error('Error limpiando documentos corruptos:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar documentos corruptos',
      details: error.message
    });
  }
});

// ENDPOINT: Migrar headers corruptos a formato limpio (strings)
// Reconstruye los nombres de columnas desde objetos {0:'F', 1:'e', ...} a "Fecha"
router.post('/migrate-headers', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const Document = require('../models/Document');
    const DocumentConfig = require('../models/DocumentConfig');
    
    // PASO 1: Obtener headers oficiales para fallback
    const config = await DocumentConfig.getConfig();
    const officialHeaders = config.headers.map(h => h.label);
    
    // PASO 2: Buscar todos los documentos
    const allDocuments = await Document.find({}).session(session);
    
    const migrationResults = [];
    let migratedCount = 0;
    let errorCount = 0;
    
    for (const doc of allDocuments) {
      try {
        if (!doc.headers || !Array.isArray(doc.headers)) {
          continue;
        }
        
        let needsMigration = false;
        const newHeaders = [];
        
        // PASO 3: Procesar cada header
        for (let i = 0; i < doc.headers.length; i++) {
          const header = doc.headers[i];
          
          // Si ya es string limpio (no parece objeto JSON corrupto), mantenerlo
          // Los corruptos empiezan con "{" y tienen \u0027 (comillas escapadas) o claves numéricas
          const isCorruptString = typeof header === 'string' && (
            header.trim().startsWith('{') && 
            (header.includes('\\u0027') || header.match(/['"]\d+['"]\s*:/))
          );
          
          if (typeof header === 'string' && !isCorruptString) {
            newHeaders.push(header);
            continue;
          }
          
          // Si es objeto o string corrupto, intentar reconstruir
          if (typeof header === 'object' && header !== null) {
            needsMigration = true;
            
            // Extraer claves numéricas
            const keys = Object.keys(header);
            const numericKeys = keys.filter(k => {
              const num = parseInt(k);
              return !isNaN(num) && String(num) === k;
            });
            
            if (numericKeys.length > 0) {
              // Ordenar y reconstruir
              const sortedKeys = numericKeys.sort((a, b) => parseInt(a) - parseInt(b));
              const reconstructed = sortedKeys.map(k => header[k]).join('');
              
              if (reconstructed && reconstructed.trim().length > 0) {
                newHeaders.push(reconstructed);
              } else {
                // Fallback: usar header oficial o "Columna"
                newHeaders.push(officialHeaders[i] || `Columna ${i + 1}`);
              }
            } else {
              // No tiene claves numéricas, usar fallback
              newHeaders.push(officialHeaders[i] || `Columna ${i + 1}`);
            }
          } else if (isCorruptString) {
            // String con formato JSON corrupto (ej: "{\n  \u00270\u0027: \u0027F\u0027...")
            needsMigration = true;
            
            try {
              // Reemplazar \u0027 por comillas simples reales
              let jsonStr = header.replace(/\\u0027/g, "'");
              // También reemplazar comillas dobles escapadas si las hay
              jsonStr = jsonStr.replace(/\\"/g, '"');
              
              const obj = JSON.parse(jsonStr);
              
              // Extraer claves numéricas
              const keys = Object.keys(obj);
              const numericKeys = keys.filter(k => {
                const num = parseInt(k);
                return !isNaN(num) && String(num) === k;
              });
              
              if (numericKeys.length > 0) {
                // Ordenar y reconstruir
                const sortedKeys = numericKeys.sort((a, b) => parseInt(a) - parseInt(b));
                const reconstructed = sortedKeys.map(k => obj[k]).join('');
                
                if (reconstructed && reconstructed.trim().length > 0) {
                  newHeaders.push(reconstructed);
                } else {
                  // Fallback: usar header oficial
                  newHeaders.push(officialHeaders[i] || `Columna ${i + 1}`);
                }
              } else {
                // No tiene claves numéricas, usar fallback
                newHeaders.push(officialHeaders[i] || `Columna ${i + 1}`);
              }
            } catch (parseError) {
              console.warn(`⚠️  No se pudo parsear header como JSON en documento ${doc._id}:`, header.substring(0, 50));
              // Fallback: usar header oficial
              newHeaders.push(officialHeaders[i] || `Columna ${i + 1}`);
            }
          } else {
            // Cualquier otro caso, mantener como está
            newHeaders.push(String(header || `Columna ${i + 1}`));
          }
        }
        
        // PASO 4: Solo actualizar si hubo cambios
        if (needsMigration) {
          // Verificar que la cantidad de headers no cambió
          if (newHeaders.length !== doc.headers.length) {
            console.warn(`⚠️  Documento ${doc._id}: cantidad de headers cambió (${doc.headers.length} -> ${newHeaders.length})`);
          }
          
          // Actualizar el documento
          await Document.findByIdAndUpdate(
            doc._id,
            { headers: newHeaders },
            { session }
          );
          
          migratedCount++;
          migrationResults.push({
            documentId: doc._id.toString(),
            clientId: doc.clientId?.toString(),
            month: doc.month,
            year: doc.year,
            oldHeaders: doc.headers.map(h => typeof h === 'object' ? 'OBJECT_CORRUPT' : h),
            newHeaders: newHeaders,
            status: 'migrated'
          });
        }
        
      } catch (docError) {
        errorCount++;
        migrationResults.push({
          documentId: doc._id.toString(),
          clientId: doc.clientId?.toString(),
          month: doc.month,
          year: doc.year,
          error: docError.message,
          status: 'error'
        });
        console.error(`❌ Error migrando documento ${doc._id}:`, docError.message);
      }
    }
    
    // PASO 5: Commit de la transacción
    await session.commitTransaction();
    
    res.json({
      success: true,
      message: `Migración completada: ${migratedCount} documentos migrados, ${errorCount} errores`,
      totalDocumentsChecked: allDocuments.length,
      migratedCount: migratedCount,
      errorCount: errorCount,
      details: migrationResults.slice(0, 10), // Primeros 10 resultados
      officialHeaders: officialHeaders,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Migración completada: ${migratedCount} documentos migrados`);
    
  } catch (error) {
    // Rollback en caso de error
    await session.abortTransaction();
    console.error('❌ Error en migración:', error);
    
    res.status(500).json({
      success: false,
      error: 'Error durante la migración',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    session.endSession();
  }
});

// ENDPOINT DE DIAGNÓSTICO: Ver estructura real de headers corruptos
router.get('/diagnose-headers', async (req, res) => {
  try {
    const Document = require('../models/Document');
    const documents = await Document.find({}).limit(5);
    
    const diagnosis = [];
    
    for (const doc of documents) {
      const docInfo = {
        documentId: doc._id.toString(),
        clientId: doc.clientId?.toString(),
        month: doc.month,
        year: doc.year,
        hasHeaders: !!doc.headers,
        headersCount: doc.headers?.length || 0,
        headersTypes: doc.headers?.map((h, i) => ({
          index: i,
          type: typeof h,
          isNull: h === null,
          isArray: Array.isArray(h),
          keys: typeof h === 'object' && h !== null ? Object.keys(h) : null,
          sample: typeof h === 'object' && h !== null ? 
            JSON.stringify(h).substring(0, 100) : String(h).substring(0, 50)
        })) || []
      };
      
      diagnosis.push(docInfo);
    }
    
    res.json({
      success: true,
      totalDocuments: documents.length,
      diagnosis: diagnosis
    });
    
  } catch (error) {
    console.error('Error en diagnóstico:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ENDPOINT: Corregir headers "Columna X" usando headers oficiales de DocumentConfig
router.post('/fix-headers-from-config', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const Document = require('../models/Document');
    const DocumentConfig = require('../models/DocumentConfig');
    
    // PASO 1: Obtener headers oficiales
    const config = await DocumentConfig.getConfig();
    const officialHeaders = config.headers.map(h => h.label);
    
    console.log('📋 Headers oficiales:', officialHeaders);
    
    // PASO 2: Buscar documentos con headers "Columna X"
    const allDocuments = await Document.find({}).session(session);
    const documentsToFix = [];
    
    for (const doc of allDocuments) {
      if (!doc.headers || !Array.isArray(doc.headers)) continue;
      
      // Verificar si tiene al menos un header "Columna X"
      const hasColumnaX = doc.headers.some(h => 
        typeof h === 'string' && h.match(/^Columna\s+\d+$/)
      );
      
      if (hasColumnaX) {
        documentsToFix.push(doc);
      }
    }
    
    console.log(`🔍 Encontrados ${documentsToFix.length} documentos para corregir`);
    
    // PASO 3: Corregir cada documento
    const results = [];
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const doc of documentsToFix) {
      try {
        // Crear nuevos headers basados en los oficiales
        // Mantenemos la misma cantidad de columnas
        const newHeaders = [];
        
        for (let i = 0; i < doc.headers.length; i++) {
          if (i < officialHeaders.length) {
            // Usar header oficial
            newHeaders.push(officialHeaders[i]);
          } else {
            // Si hay más columnas que headers oficiales, mantener el original
            // o usar "Columna X" si es el único que tenía
            const original = doc.headers[i];
            if (typeof original === 'string' && !original.match(/^Columna\s+\d+$/)) {
              newHeaders.push(original);
            } else {
              newHeaders.push(`Columna ${i + 1}`);
            }
          }
        }
        
        // Actualizar documento
        await Document.findByIdAndUpdate(
          doc._id,
          { headers: newHeaders },
          { session }
        );
        
        fixedCount++;
        results.push({
          documentId: doc._id.toString(),
          clientId: doc.clientId?.toString(),
          month: doc.month,
          year: doc.year,
          oldHeaders: doc.headers,
          newHeaders: newHeaders,
          status: 'fixed'
        });
        
        console.log(`✅ Documento ${doc._id} corregido`);
        
      } catch (docError) {
        errorCount++;
        results.push({
          documentId: doc._id.toString(),
          error: docError.message,
          status: 'error'
        });
        console.error(`❌ Error en documento ${doc._id}:`, docError.message);
      }
    }
    
    // PASO 4: Commit de la transacción
    await session.commitTransaction();
    
    res.json({
      success: true,
      message: `Corrección completada: ${fixedCount} documentos arreglados, ${errorCount} errores`,
      totalDocumentsChecked: allDocuments.length,
      documentsWithColumnaX: documentsToFix.length,
      fixedCount: fixedCount,
      errorCount: errorCount,
      officialHeaders: officialHeaders,
      sampleResults: results.slice(0, 5),
      timestamp: new Date().toISOString()
    });
    
    console.log(`🎉 Corrección completada: ${fixedCount} documentos arreglados`);
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Error en corrección:', error);
    
    res.status(500).json({
      success: false,
      error: 'Error durante la corrección',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    session.endSession();
  }
});

// ENDPOINT: Migrar headers NULL a headers oficiales
router.post('/fix-null-headers', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const Document = require('../models/Document');
    const DocumentConfig = require('../models/DocumentConfig');
    
    // PASO 1: Obtener headers oficiales con fallback
    let officialHeaders = [];
    try {
      const config = await DocumentConfig.getConfig();
      console.log('📋 Config obtenida:', JSON.stringify(config, null, 2));
      
      if (config && config.headers && Array.isArray(config.headers)) {
        officialHeaders = config.headers.map(h => h.label || h.toString()).filter(h => h);
        console.log('📋 Headers oficiales extraídos:', officialHeaders);
      }
    } catch (configError) {
      console.error('⚠️ Error obteniendo DocumentConfig:', configError.message);
    }
    
    // Fallback: usar headers por defecto si no se pudieron obtener
    if (officialHeaders.length === 0) {
      console.log('⚠️ Usando headers por defecto');
      officialHeaders = [
        'Fecha', 'Mes', 'DNI', 'Nombre y Apellidos', 'Celular',
        'Producto', 'Monto', 'Tasa', 'Lugar', 'Observación', 'Ganancias'
      ];
    }
    
    // PASO 2: Buscar documentos con headers NULL
    const allDocuments = await Document.find({}).session(session);
    console.log(`🔍 Total documentos en BD: ${allDocuments.length}`);
    
    const documentsToFix = [];
    
    for (const doc of allDocuments) {
      if (!doc.headers || !Array.isArray(doc.headers)) {
        console.log(`⚠️ Documento ${doc._id} sin headers o no es array`);
        continue;
      }
      
      // Verificar si TODOS los headers son NULL
      const allNull = doc.headers.every(h => h === null || h === undefined);
      
      if (allNull) {
        console.log(`🔍 Documento ${doc._id} tiene headers NULL (${doc.headers.length} columnas)`);
        documentsToFix.push(doc);
      }
    }
    
    console.log(`🔍 Encontrados ${documentsToFix.length} documentos con headers NULL`);
    
    // PASO 3: Corregir cada documento
    const results = [];
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const doc of documentsToFix) {
      try {
        // Usar headers oficiales (asegurar que tenemos suficientes)
        const newHeaders = [];
        for (let i = 0; i < doc.headers.length; i++) {
          if (i < officialHeaders.length) {
            newHeaders.push(officialHeaders[i]);
          } else {
            newHeaders.push(`Columna ${i + 1}`);
          }
        }
        
        console.log(`📝 Documento ${doc._id} - nuevos headers:`, newHeaders);
        
        // Actualizar documento usando updateOne para asegurar el cambio
        const updateResult = await Document.updateOne(
          { _id: doc._id },
          { $set: { headers: newHeaders } },
          { session }
        );
        
        console.log(`📝 Update result para ${doc._id}:`, updateResult);
        
        fixedCount++;
        results.push({
          documentId: doc._id.toString(),
          clientId: doc.clientId?.toString(),
          month: doc.month,
          year: doc.year,
          headersCount: doc.headers.length,
          newHeaders: newHeaders,
          status: 'fixed'
        });
        
        console.log(`✅ Documento ${doc._id} corregido`);
        
      } catch (docError) {
        errorCount++;
        results.push({
          documentId: doc._id.toString(),
          error: docError.message,
          status: 'error'
        });
        console.error(`❌ Error en documento ${doc._id}:`, docError.message);
      }
    }
    
    // PASO 4: Commit de la transacción
    await session.commitTransaction();
    console.log('✅ Transacción committeada');
    
    res.json({
      success: true,
      message: `Migración completada: ${fixedCount} documentos arreglados, ${errorCount} errores`,
      totalDocumentsChecked: allDocuments.length,
      documentsWithNullHeaders: documentsToFix.length,
      fixedCount: fixedCount,
      errorCount: errorCount,
      officialHeaders: officialHeaders,
      sampleResults: results.slice(0, 5),
      timestamp: new Date().toISOString()
    });
    
    console.log(`🎉 Migración completada: ${fixedCount} documentos arreglados`);
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Error en migración:', error);
    
    res.status(500).json({
      success: false,
      error: 'Error durante la migración',
      details: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  } finally {
    session.endSession();
  }
});

module.exports = router;
