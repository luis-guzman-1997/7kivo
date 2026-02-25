# Script exclusivo: Clínica Dr. David La Guardia

Organización ID: `dr-david-laguardia`

## ¿Qué hace este script?

Inicializa el bot de WhatsApp con flujos pensados para una clínica médica:

1. **Contáctanos** – Los pacientes envían consultas o mensajes (se guardan en `consultas`)
2. **Agendar Cita** – Reserva de citas médicas (nombre, motivo, fecha, hora) → colección `citas`
3. **Menú** – Horarios, Ubicación, Sobre Nosotros

## Datos del negocio que se preservan

El script **no sobrescribe** la información que ya configuraste en el registro del negocio:

- Nombre de la organización  
- Descripción  
- Industria  
- WhatsApp personal  
- Logo  

Si aún no existe esa configuración, usa los valores por defecto definidos en el script.

## Cómo ejecutar

```bash
cd 7kivo-bot
ORG_ID=dr-david-laguardia node scripts/seed-clinica-dr-david-laguardia.js
```

Asegúrate de tener configuradas las credenciales de Firebase en tu `.env` (`GOOGLE_APPLICATION_CREDENTIALS` o `FIREBASE_SERVICE_ACCOUNT`).

## Cómo ajustar el script

Edita el archivo `seed-clinica-dr-david-laguardia.js` y localiza la sección **CONFIGURACIÓN DUMMY**:

- **orgName**, **description**, **industry** – Valores por defecto si no hay config previa
- **contact** – Dirección, teléfono, email (placeholders para que completes en el admin)
- **schedule** – Días y horarios de atención
- **general** – Enfoque, modalidad, servicios

También puedes modificar los textos de los flujos dentro del script, o editarlos después desde el panel de administración (Flow Builder).

## Después de ejecutar

1. Entra al panel admin con la cuenta de `dr-david-laguardia`
2. En **Mi Empresa** completa: dirección, teléfono, email, horarios
3. Configura WhatsApp en **Bot Config**
4. Para correr el bot: `ORG_ID=dr-david-laguardia npm start`
