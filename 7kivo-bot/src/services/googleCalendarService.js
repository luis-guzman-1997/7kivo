const { google } = require('googleapis');
const { db } = require('../config/firebase');
const { getOrgId } = require('../config/orgConfig');

const getGoogleCalendarConfig = async () => {
  const orgId = getOrgId();
  const snap = await db.collection('organizations').doc(orgId).collection('config').doc('googleCalendar').get();
  return snap.exists ? snap.data() : null;
};

const readRawEnvValue = (key) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.resolve(__dirname, '../../../.env');
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      if (line.startsWith(key + '=')) {
        let value = line.slice(key.length + 1).trim();
        if ((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1);
        }
        return value;
      }
    }
  } catch (_) {}
  return '';
};

const getAuthClient = () => {
  // Leer directo del .env para evitar que dotenv corrompa el JSON inline
  const raw = readRawEnvValue('GOOGLE_SERVICE_ACCOUNT_PATH') || process.env.GOOGLE_SERVICE_ACCOUNT_PATH || '';
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (_) {
    const fs = require('fs');
    credentials = JSON.parse(fs.readFileSync(raw, 'utf8'));
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.events']
  });
};

const createGoogleCalendarEvent = async (appointmentData) => {
  try {
    const gcConfig = await getGoogleCalendarConfig();
    if (!gcConfig?.enabled || !gcConfig?.calendarId) return null;

    const { _apptFecha, _apptHora, _apptDuration, _apptService, phoneNumber } = appointmentData;
    if (!_apptFecha || !_apptHora) return null;

    const timezone = process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/El_Salvador';
    const duration = _apptDuration || 60;

    // Construir start datetime
    const [year, month, day] = _apptFecha.split('-').map(Number);
    const [hour, minute] = _apptHora.split(':').map(Number);
    const startDate = new Date(year, month - 1, day, hour, minute);
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    const pad = (n) => String(n).padStart(2, '0');
    const toLocalISO = (d) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

    // Construir descripción con todos los campos del formulario
    const skipFields = ['_apptFecha', '_apptHora', '_apptDuration', '_apptService', 'status', 'organizationId', 'flowId', 'flowName', 'phoneNumber', 'createdAt', 'updatedAt'];
    const extraLines = Object.entries(appointmentData)
      .filter(([k]) => !skipFields.includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const description = [
      `Servicio: ${_apptService || '—'}`,
      `Teléfono: ${phoneNumber || '—'}`,
      extraLines
    ].filter(Boolean).join('\n');

    const auth = getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const event = await calendar.events.insert({
      calendarId: gcConfig.calendarId,
      requestBody: {
        summary: _apptService || 'Cita agendada',
        description,
        start: { dateTime: toLocalISO(startDate), timeZone: timezone },
        end: { dateTime: toLocalISO(endDate), timeZone: timezone }
      }
    });

    console.log(`[GoogleCalendar] Evento creado: ${event.data.htmlLink}`);
    return event.data.id;
  } catch (err) {
    console.error('[GoogleCalendar] Error al crear evento:', err.message);
    return null;
  }
};

module.exports = { createGoogleCalendarEvent };
