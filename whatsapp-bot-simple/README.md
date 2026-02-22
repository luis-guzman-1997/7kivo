# WhatsApp Bot Simple

Bot de WhatsApp desde cero que saluda y está preparado para responder consultas.

## Instalación

1. Instalar dependencias:
```bash
npm install
```

2. Configurar variables de entorno:
```bash
cp env.example .env
```

Editar el archivo `.env` con tus credenciales de Meta WhatsApp.

## Variables de Entorno Necesarias

- `VERIFY_META_TOKEN`: Token para verificación del webhook
- `PHONE_NUMBER_WHATSAPP`: ID del número de teléfono de WhatsApp Business
- `TOKEN_META_WHATSAPP`: Token de acceso de Meta WhatsApp API
- `VERSION_META_WHATSAPP`: Versión de la API (ej: v21.0)
- `PORT`: Puerto del servidor (por defecto 3005)

## Uso

Iniciar el servidor:
```bash
npm start
```

El servidor estará disponible en `http://localhost:3005`

## Endpoints

- `GET /test` - Verificar que el servidor está funcionando
- `GET /auth` - Verificación del webhook de Meta
- `POST /auth` - Recibir mensajes de WhatsApp

## Funcionalidad Actual

- ✅ Saluda automáticamente cuando recibe el primer mensaje
- ✅ Responde a mensajes del usuario
- 🔄 Preparado para agregar lógica de consultas de información

