const { getSession, getSessionAsync, setSession, clearSession } = require("../config/sessionData");
const { sendTextMessage: _rawSendText, sendInteractiveButtons, sendInteractiveList, sendImageMessage, sendCtaUrlMessage } = require("../models/messageModel");
const {
  getMessage,
  getOrderByCode,
  updateOrder,
  getContactInfo,
  getScheduleInfo,
  getGeneralInfo,
  getGeneralConfig,
  getFlows,
  getFlow,
  getMenuConfig,
  getKeywords,
  getCollectionItems,
  getCollectionItem,
  getCollectionDef,
  saveFlowSubmission,
  getAppointmentsByDate,
  getUpcomingAppointmentsByPhone,
  cancelAppointment,
  saveGcEventId,
  lookupCollectionByField,
  getCampaignKeywordTriggers,
  getCampaignById,
  createPromoOrder,
  getOrgStatus,
  hasActiveCaseForPhone
} = require("../services/botMessagesService");
const { saveMessage, getConversationMode } = require("../services/conversationService");
const { registerCampaignOptOut } = require("../services/campaignService");
const { createGoogleCalendarEvent, deleteGoogleCalendarEvent } = require("../services/googleCalendarService");
const { sendPushToDeliveries } = require("../services/pushService");

const disabledNotified = {};

// Deduplication: WhatsApp retries failed webhooks (5xx) with the same message ID.
// We track processed IDs to silently ignore retries and prevent duplicate saves.
const processedMessageIds = new Set();
setInterval(() => processedMessageIds.clear(), 60 * 60 * 1000); // clear every hour

const sendTextMessage = async (text, phoneNumber) => {
  const result = await _rawSendText(text, phoneNumber);
  saveMessage(phoneNumber, text, "bot").catch(err =>
    console.error("Error saving bot message:", err.message)
  );
  return result;
};

// ==================== WEBHOOK HANDLERS ====================

const apiVerification = async (req, res) => {
  try {
    const {
      'hub.mode': mode,
      'hub.verify_token': token,
      'hub.challenge': challenge
    } = req.query;

    if (mode && token && mode === 'subscribe' && token === process.env.VERIFY_META_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Forbidden');
    }
  } catch (error) {
    return res.status(500).send(error);
  }
};

const requestMessageFromWhatsapp = async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const messageObj = change?.value?.messages?.[0];

    // Deduplicate: if we've already processed this WhatsApp message ID, ignore the retry
    const waMessageId = messageObj?.id;
    if (waMessageId) {
      if (processedMessageIds.has(waMessageId)) {
        return res.sendStatus(200);
      }
      processedMessageIds.add(waMessageId);
    }

    let phoneNumber = messageObj?.from ||
                     change?.value?.contacts?.[0]?.wa_id ||
                     change?.value?.metadata?.display_phone_number;

    const phoneId = change?.value?.metadata?.phone_number_id;
    if (!phoneId || phoneId !== process.env.PHONE_NUMBER_WHATSAPP) {
      return res.sendStatus(200);
    }

    if (change?.value?.statuses) {
      return res.sendStatus(200);
    }

    if (!phoneNumber || !messageObj) {
      return res.sendStatus(200);
    }

    const orgStatus = await getOrgStatus();
    if (orgStatus.active === false || orgStatus.botEnabled === false) {
      try {
        await _rawSendText(
          "Hola, gracias por escribirnos. En este momento no podemos atenderte a través de este canal. Por favor intenta más tarde o contáctanos por otro medio. Disculpa las molestias.",
          phoneNumber
        );
      } catch (e) { /* best effort */ }
      return res.sendStatus(200);
    }
    if (orgStatus.botBlocked === true) {
      try {
        await _rawSendText(
          "Hola, gracias por escribirnos. En este momento nuestro servicio de chat no está disponible. Por favor contáctanos por otro medio.",
          phoneNumber
        );
      } catch (e) { /* best effort */ }
      return res.sendStatus(200);
    }
    if (orgStatus.botPaused === true) {
      try {
        await _rawSendText(
          "Hola, gracias por escribirnos. Estamos realizando ajustes en nuestro servicio. Por favor intenta nuevamente en unos minutos.",
          phoneNumber
        );
      } catch (e) { /* best effort */ }
      return res.sendStatus(200);
    }

    const contactName = change?.value?.contacts?.[0]?.profile?.name || null;

    const interactiveResponse = messageObj?.interactive;
    if (interactiveResponse) {
      const buttonId = interactiveResponse?.button_reply?.id || interactiveResponse?.list_reply?.id;
      const buttonTitle = interactiveResponse?.button_reply?.title || interactiveResponse?.list_reply?.title || buttonId;
      if (buttonId && phoneNumber) {
        saveMessage(phoneNumber, buttonTitle, "user", { contactName }).catch(err =>
          console.error("Error saving interactive user message:", err.message)
        );

        const mode = await getConversationMode(phoneNumber);
        if (mode === "admin" && !buttonId.startsWith('campaign_order_')) {
          return res.sendStatus(200);
        }

        await handleInteractiveResponse(phoneNumber, buttonId);
        return res.sendStatus(200);
      }
    }

    const userMessage = messageObj?.text?.body?.trim() || "";

    // Handle all non-text multimedia messages
    if (!userMessage) {
      const msgType = messageObj?.type;

      const MEDIA_LABELS = {
        image:    { label: "📷 Foto",       save: true },
        audio:    { label: "🎵 Audio",       save: true },
        voice:    { label: "🎵 Nota de voz", save: true },
        video:    { label: "🎥 Video",       save: true },
        document: { label: "📄 Documento",   save: true },
        sticker:  { label: "🗒️ Sticker",     save: true },
        location: { label: "📍 Ubicación",   save: true },
        contacts: { label: "👤 Contacto",    save: true },
        reaction: { label: null,             save: false }, // silently ignore reactions
      };

      const mediaInfo = MEDIA_LABELS[msgType];

      // Silently skip reactions and unknown types
      if (!mediaInfo || !mediaInfo.label) {
        return res.sendStatus(200);
      }

      const mode = await getConversationMode(phoneNumber);

      if (mode === "admin") {
        if (msgType === "image") {
          // Images in admin mode: download from Meta → Firebase Storage → save with imageUrl
          const imageCaption = messageObj?.image?.caption || "";
          const mediaId = messageObj?.image?.id || "";
          const displayText = imageCaption ? `📷 ${imageCaption}` : "📷 Foto";
          (async () => {
            try {
              const { downloadAndUploadMedia } = require("../services/mediaService");
              const imageUrl = await downloadAndUploadMedia(mediaId, phoneNumber);
              await saveMessage(phoneNumber, displayText, "user", {
                contactName, type: "image", imageUrl,
              });
            } catch (err) {
              console.error("Error processing user image:", err.message);
              saveMessage(phoneNumber, displayText, "user", { contactName, type: "image" })
                .catch(e => console.error("Error saving image placeholder:", e.message));
            }
          })();
        } else if (msgType === "audio" || msgType === "voice") {
          // Audio/voice in admin mode: always download for display.
          // deliveryAudioEnabled only controls duration rejection.
          (async () => {
            try {
              const orgConfig = await getGeneralConfig().catch(() => ({}));
              const maxSeconds = orgConfig?.deliveryAudioMaxSeconds || 30;
              const rejectOverLimit = orgConfig?.deliveryAudioEnabled === true;

              const msgData = messageObj?.[msgType] || {};
              const duration = msgData.duration ?? null; // seconds, provided by WhatsApp
              const mediaId = msgData.id || "";

              if (rejectOverLimit && duration !== null && duration > maxSeconds) {
                // Reject: notify client
                await sendTextMessage(
                  `❌ Tu audio supera el límite de ${maxSeconds} segundos. Por favor envía uno más corto.`,
                  phoneNumber
                );
                return;
              }

              // Download and save with audioUrl
              const { downloadAndUploadMedia } = require("../services/mediaService");
              const audioUrl = await downloadAndUploadMedia(mediaId, phoneNumber);
              await saveMessage(phoneNumber, mediaInfo.label, "user", {
                contactName, type: "audio", audioUrl, duration,
              });
            } catch (err) {
              console.error("Error processing user audio:", err.message);
              saveMessage(phoneNumber, `🎵 Audio [ERR: ${err.message}]`, "user", { contactName, type: "audio" })
                .catch(e => console.error("Error saving audio placeholder:", e.message));
            }
          })();
        } else if (msgType === "location") {
          // Location in admin mode: save with coordinates for map display
          const loc = messageObj?.location || {};
          const parts = [];
          if (loc.name) parts.push(loc.name);
          if (loc.address) parts.push(loc.address);
          const locText = parts.length > 0 ? parts.join(", ") : "📍 Ubicación";
          saveMessage(phoneNumber, locText, "user", {
            contactName,
            type: "location",
            locationData: { text: locText, lat: loc.latitude, lng: loc.longitude, ...(loc.name ? { name: loc.name } : {}), ...(loc.address ? { address: loc.address } : {}) }
          }).catch(err => console.error("Error saving location message:", err.message));
        } else {
          // Other media in admin mode: save label so admin sees it in chat
          saveMessage(phoneNumber, mediaInfo.label, "user", { contactName })
            .catch(err => console.error("Error saving media message:", err.message));
        }
      } else {
        // Bot mode: check if user is in a flow_image or flow_location step
        let currentSession = getSession(phoneNumber);
        if (!currentSession) currentSession = await getSessionAsync(phoneNumber);
        if (currentSession?.flowId && currentSession?.flowStepIndex !== undefined) {
          const flow = await getFlow(currentSession.flowId);
          const currentStep = flow?.steps?.[currentSession.flowStepIndex];

          // Handle location_input step with WhatsApp location message
          if (currentStep?.type === "location_input" && msgType === "location") {
            const loc = messageObj?.location || {};
            const fieldKey = currentStep.fieldKey || "direccion";
            const parts = [];
            if (loc.name) parts.push(loc.name);
            if (loc.address) parts.push(loc.address);
            const locationText = parts.length > 0
              ? parts.join(", ")
              : `${loc.latitude}, ${loc.longitude}`;
            const locationValue = {
              text: locationText,
              lat: loc.latitude,
              lng: loc.longitude,
              ...(loc.name ? { name: loc.name } : {}),
              ...(loc.address ? { address: loc.address } : {})
            };
            const flowData = { ...currentSession.flowData, [fieldKey]: locationValue };
            const nextIndex = currentSession.flowStepIndex + 1;
            setSession(phoneNumber, { flowData, flowStepIndex: nextIndex, flowStartTime: Date.now() });
            saveMessage(phoneNumber, locationText, "user", {
              contactName, type: "location",
              locationData: locationValue
            }).catch(() => {});
            await executeFlowStep(phoneNumber, flow, nextIndex);
            return res.sendStatus(200);
          }

          // Handle image_input step
          if (currentStep?.type === "image_input" && (msgType === "image" || msgType === "document")) {
            const mediaId = messageObj?.[msgType]?.id;
            if (mediaId) {
              try {
                const { downloadAndUploadMedia } = require("../services/mediaService");
                const fileUrl = await downloadAndUploadMedia(mediaId, phoneNumber);
                const fieldKey = currentStep.fieldKey || "archivoUrl";
                const flowData = { ...currentSession.flowData, [fieldKey]: fileUrl };
                const nextIndex = currentSession.flowStepIndex + 1;
                setSession(phoneNumber, { flowData, flowStepIndex: nextIndex, flowStartTime: Date.now() });
                await executeFlowStep(phoneNumber, flow, nextIndex);
                return res.sendStatus(200);
              } catch (e) {
                console.error("Error processing flow image:", e.message);
              }
            } else if (currentStep.optional) {
              const nextIndex = currentSession.flowStepIndex + 1;
              setSession(phoneNumber, { flowStepIndex: nextIndex, flowStartTime: Date.now() });
              await executeFlowStep(phoneNumber, flow, nextIndex);
              return res.sendStatus(200);
            }
          }
        }
        // Auto-reply that multimedia is not supported
        try {
          await sendTextMessage(
            "Lo sentimos, no podemos procesar archivos multimedia por este canal. Por favor describe tu consulta en texto. 📝",
            phoneNumber
          );
        } catch (e) { /* best effort */ }
      }

      return res.sendStatus(200);
    }

    saveMessage(phoneNumber, userMessage, "user", { contactName }).catch(err =>
      console.error("Error saving user message:", err.message)
    );

    // Order code: always takes priority over any session state
    if (userMessage) {
      const earlyOrderMatch = userMessage.match(/\bPED-\d{8}-[A-Z0-9]{4}\b/i);
      console.log('[PED-CHECK] msg:', JSON.stringify(userMessage.substring(0, 60)), '| match:', earlyOrderMatch?.[0] || 'none');
      if (earlyOrderMatch) {
        setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
        await handleOrderCode(phoneNumber, earlyOrderMatch[0].toUpperCase());
        return res.sendStatus(200);
      }
    }

    // Check conversation mode - if admin is handling, don't process
    const mode = await getConversationMode(phoneNumber);
    if (mode === "admin") {
      return res.sendStatus(200);
    }

    // Try local cache first, then Firestore (handles server restart)
    let session = getSession(phoneNumber);
    if (!session) {
      session = await getSessionAsync(phoneNumber);
    }
    if (!session) {
      setSession(phoneNumber, { step: "initial" });
      session = getSession(phoneNumber);
    }

    // Check flow timeout
    const config = await getGeneralConfig();
    const flowTimeout = config?.registrationTimeout || 180000;
    if (session.step && session.step.startsWith("flow_") && session.flowStartTime) {
      if (Date.now() - session.flowStartTime > flowTimeout) {
        const timeoutMsg = await getMessage("flow_timeout", "El tiempo del proceso expiró. Escribe *menu* para volver.");
        await sendTextMessage(timeoutMsg, phoneNumber);
        setSession(phoneNumber, { step: "main_menu" });
        return res.sendStatus(200);
      }
    }

    // Check if flow was modified by admin while user was mid-session
    if (session.step && session.step.startsWith("flow_") && session.flowId && session.flowStartTime) {
      const activeFlow = await getFlow(session.flowId);
      if (activeFlow) {
        const flowUpdatedMs = activeFlow.updatedAt?.toMillis
          ? activeFlow.updatedAt.toMillis()
          : (typeof activeFlow.updatedAt === 'number' ? activeFlow.updatedAt : 0);
        if (flowUpdatedMs > session.flowStartTime) {
          await sendTextMessage(
            "⚠️ El formulario fue actualizado. Por favor selecciona una opción del menú para iniciar de nuevo.",
            phoneNumber
          );
          setSession(phoneNumber, { step: "main_menu" });
          return res.sendStatus(200);
        }
      }
    }

    if (session.step === "initial" || !session.hasGreeted) {
      if (phoneNumber) {
        await sendGreeting(phoneNumber, contactName);
        setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
      }
    } else {
      if (phoneNumber) {
        await handleUserMessage(phoneNumber, userMessage, session);
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error al procesar mensaje:", error.message || error);
    // Always return 200 to prevent WhatsApp from retrying the webhook,
    // which would cause duplicate message saves in Firestore.
    return res.sendStatus(200);
  }
};

// ==================== DYNAMIC MENU ====================

const buildMenuItems = async (phoneNumber) => {
  const menuConfig = await getMenuConfig();
  const flows = await getFlows();

  if (menuConfig && menuConfig.items && menuConfig.items.length > 0) {
    const rows = [];
    const sortedItems = [...menuConfig.items]
      .filter(i => i.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    for (const item of sortedItems) {
      if (item.type === "builtin") {
        rows.push({
          id: `builtin_${item.action}`,
          title: (item.label || item.action).substring(0, 24),
          description: (item.description || "").substring(0, 72)
        });
      } else if (item.type === "flow") {
        const flow = flows.find(f => f.id === item.flowId);
        const allowedPhones = Array.isArray(flow?.testPhones) ? flow.testPhones : [];
        const phoneAllowed = allowedPhones.length === 0 || allowedPhones.includes(String(phoneNumber));
        if (flow && flow.active !== false && phoneAllowed) {
          rows.push({
            id: `flow_${flow.id}`,
            title: (item.label || flow.menuLabel || flow.name).substring(0, 24),
            description: (item.description || flow.menuDescription || "").substring(0, 72)
          });
        }
      } else if (item.type === "message" && item.messageContent && item.label) {
        rows.push({
          id: `message_${item.id}`,
          title: (item.label).substring(0, 24),
          description: item.messageContent.substring(0, 72)
        });
      }
    }
    rows.push({ id: "exit_chat", title: "Salir", description: "Finalizar conversación" });
    return rows;
  }

  // Fallback: auto-generate from builtins + active flows
  const rows = [
    { id: "builtin_schedule", title: "Horarios", description: "Horarios de atención" },
    { id: "builtin_contact", title: "Contáctanos", description: "Información de contacto" },
    { id: "builtin_services", title: "Servicios", description: "Conoce nuestros servicios" },
    { id: "builtin_general", title: "Información General", description: "Sobre nosotros" }
  ];

  for (const flow of flows) {
    rows.push({
      id: `flow_${flow.id}`,
      title: (flow.menuLabel || flow.name).substring(0, 24),
      description: (flow.menuDescription || "").substring(0, 72)
    });
  }

  rows.push({ id: "exit_chat", title: "Salir", description: "Finalizar conversación" });
  return rows;
};

const sendGreeting = async (phoneNumber, contactName = null) => {
  const menuConfig = await getMenuConfig();
  const session = getSession(phoneNumber);
  const name = contactName || session?.contactName || "";
  const nameDisplay = name ? ` ${name}` : "";

  if (contactName) {
    setSession(phoneNumber, { contactName });
  }

  const greetingTemplate = menuConfig?.greeting ||
    await getMessage("greeting", "¡Hola{name}!\n\nBienvenido. Selecciona una opción:");
  const greeting = greetingTemplate.replace("{name}", nameDisplay);

  const menuButtonText = menuConfig?.menuButtonText ||
    await getMessage("menu_button_text", "Ver opciones");

  const menuRows = await buildMenuItems(phoneNumber);

  if (menuRows.length === 0) {
    await sendTextMessage(greeting, phoneNumber);
    return;
  }

  const sections = [{ title: "Opciones", rows: menuRows }];
  await sendInteractiveList(greeting, menuButtonText, sections, phoneNumber);
};

const sendMenu = async (phoneNumber) => {
  const menuConfig = await getMenuConfig();

  const menuButtonText = menuConfig?.menuButtonText ||
    await getMessage("menu_button_text", "Ver opciones");

  const menuRows = await buildMenuItems(phoneNumber);

  if (menuRows.length === 0) {
    await sendTextMessage("No hay opciones disponibles.", phoneNumber);
    return;
  }

  const sections = [{ title: "Opciones", rows: menuRows }];
  await sendInteractiveList("¿En qué más puedo ayudarte?", menuButtonText, sections, phoneNumber);
};

// ==================== INTERACTIVE RESPONSE HANDLER ====================

const handleInteractiveResponse = async (phoneNumber, buttonId) => {
  // Botón de pedido de campaña delivery
  if (buttonId.startsWith('campaign_order_')) {
    // Bloquear si ya tiene una solicitud o promo activa
    const alreadyActive = await hasActiveCaseForPhone(phoneNumber);
    if (alreadyActive) {
      await sendTextMessage('Ya tienes una solicitud en proceso 🙏\n\nEspera a que sea atendida o cancelada antes de hacer otro pedido.', phoneNumber);
      return;
    }

    const campaignId = buttonId.replace('campaign_order_', '');
    const campaign = await getCampaignById(campaignId);
    if (campaign) {
      const { orderId, outOfStock } = await createPromoOrder(phoneNumber, campaign);
      if (outOfStock) {
        await sendTextMessage('Lo sentimos 😔\n\nLas existencias de esta promo se han agotado. ¡Gracias por tu interés! 💚', phoneNumber);
        clearSession(phoneNumber);
        return;
      }
      const promoClientName = contactName || getSession(phoneNumber)?.contactName || phoneNumber;
      sendPushToDeliveries({
        title: '🛵 Nuevo pedido promo',
        body: `${campaign.name} — ${promoClientName}`,
        url: '/admin/inbox'
      }).catch(() => {});
      await sendTextMessage('¡Pedido recibido! 🛵 En breve un repartidor te contactará.', phoneNumber);
      clearSession(phoneNumber);
    } else {
      await sendTextMessage('No pudimos procesar tu pedido. Intenta de nuevo.', phoneNumber);
    }
    return;
  }

  const session = getSession(phoneNumber);

  // Handle service info selection
  if (session && session.step === "svc_info_select" && buttonId.startsWith("svc_info_")) {
    const schedule = await getScheduleInfo();
    const idx = parseInt(buttonId.substring(9), 10);
    const svc = schedule?.services?.[idx];
    if (!svc) {
      await sendTextMessage("Servicio no encontrado.", phoneNumber);
      await showServices(phoneNumber);
      return;
    }
    let info = `*${svc.title || svc.name}*`;
    if (svc.subtitle) info += `\n_${svc.subtitle}_`;
    if (svc.description) info += `\n\n${svc.description}`;
    if (svc.duration) info += `\n\n⏱️ Duración: ${svc.duration} min`;

    const canBook = schedule?.offersAppointments === true && schedule?.businessType !== "products" && schedule?.services?.length > 0;
    const buttons = [];
    if (canBook) buttons.push({ id: "start_appt_flow", title: "Agendar cita" });
    buttons.push({ id: "builtin_services", title: "Ver más servicios" });
    if (buttons.length < 3) buttons.push({ id: "back_main", title: "Menú Principal" });

    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
    await sendInteractiveButtons(info.substring(0, 1024), buttons, phoneNumber);
    return;
  }

  // Handle select_services step
  if (session && session.step === "flow_select_services" && buttonId.startsWith("svsvc_")) {
    const idx = parseInt(buttonId.substring(6), 10);
    const schedule = await getScheduleInfo();
    const svc = schedule?.services?.[idx];
    if (!svc) {
      await sendTextMessage("Servicio no válido. Por favor selecciona una opción.", phoneNumber);
      return;
    }
    const flow = await getFlow(session.flowId);
    if (!flow) return;
    const step = flow.steps[session.flowStepIndex];
    const svcName = svc.title || svc.name;
    const flowData = {
      ...session.flowData,
      [step.fieldKey]: svcName,
      [`${step.fieldKey}Id`]: String(idx),
      _apptDuration: svc.duration,
      _apptService: svcName
    };
    const nextIndex = session.flowStepIndex + 1;
    setSession(phoneNumber, {
      step: "flow_pending",
      flowData,
      flowStepIndex: nextIndex,
      flowStartTime: Date.now()
    });
    await executeFlowStep(phoneNumber, flow, nextIndex);
    return;
  }

  // Handle appointment_slot steps (within a flow)
  if (session && session.step === "appt_select_service" && buttonId.startsWith("appt_svc_")) {
    const schedule = await getScheduleInfo();
    const idx = parseInt(buttonId.substring(9), 10);
    const svc = schedule?.services?.[idx];
    if (!svc) {
      await sendTextMessage("Servicio no válido. Por favor selecciona una opción.", phoneNumber);
      return;
    }
    const flow = await getFlow(session.flowId);
    if (!flow) return;
    const prevFlowData = session.flowData || {};
    setSession(phoneNumber, {
      flowData: { ...prevFlowData, _apptDuration: svc.duration, _apptService: svc.title || svc.name }
    });
    await sendAppointmentDays(phoneNumber, flow, flow.steps[session.flowStepIndex], session.flowStepIndex);
    return;
  }

  if (session && session.step === "appt_select_day" && buttonId.startsWith("appt_day_")) {
    await handleApptDaySelected(phoneNumber, buttonId.substring(9), session);
    return;
  }
  if (session && session.step === "appt_select_time" && buttonId.startsWith("appt_slot_")) {
    await handleApptSlotSelected(phoneNumber, buttonId.substring(10), session);
    return;
  }

  // Handle flow select step responses
  if (session && session.step === "flow_select") {
    await handleFlowSelectResponse(phoneNumber, buttonId, session);
    return;
  }

  // Handle browse_collection selection
  if (session && session.step === "flow_browse") {
    if (buttonId === "list_pg_next" || buttonId === "list_pg_prev") {
      const flow = await getFlow(session.flowId);
      if (!flow) return;
      const step = flow.steps[session.flowStepIndex];
      const newPage = buttonId === "list_pg_next"
        ? (session.browseListPage || 0) + 1
        : (session.browseListPage || 0) - 1;
      await sendBrowseCollection(phoneNumber, flow, step, session.flowStepIndex, newPage);
      return;
    }
    await handleBrowseSelection(phoneNumber, buttonId, session);
    return;
  }

  // Handle browse detail actions (ver otro / continuar)
  if (session && session.step === "flow_browse_detail") {
    if (buttonId === "browse_back") {
      const flow = await getFlow(session.flowId);
      if (flow) {
        await executeFlowStep(phoneNumber, flow, session.flowStepIndex);
      }
      return;
    }
    if (buttonId === "browse_continue" || buttonId === "back_main") {
      if (buttonId === "back_main") {
        await sendMenu(phoneNumber);
        setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
        return;
      }
      const flow = await getFlow(session.flowId);
      if (flow) {
        const nextIndex = session.flowStepIndex + 1;
        setSession(phoneNumber, { step: "flow_pending", flowStepIndex: nextIndex });
        await executeFlowStep(phoneNumber, flow, nextIndex);
      }
      return;
    }
  }

  // Cancel appointment: selecting which appointment
  if (session?.step === "cancel_appt_select" && buttonId.startsWith("cancel_pick_")) {
    const idx = parseInt(buttonId.substring(12));
    const appts = session.pendingCancelOptions;
    const a = appts?.[idx];
    if (!a) { await sendMenu(phoneNumber); return; }
    setSession(phoneNumber, { step: "cancel_appt_confirm", pendingCancelId: a.id, pendingCancelCollection: a.collectionName });
    const buttons = [{ id: "cancel_appt_yes", title: "Sí, cancelar" }, { id: "cancel_appt_no", title: "No, mantener" }];
    await sendInteractiveButtons(
      `¿Confirmas cancelar?\n*${a._apptService || "Cita"}*\n📅 ${a._apptFecha} ${a._apptHora}`,
      buttons, phoneNumber
    );
    return;
  }

  // Cancel appointment: confirm/reject
  if (session?.step === "cancel_appt_confirm") {
    if (buttonId === "cancel_appt_yes") {
      const gcEventId = await cancelAppointment(session.pendingCancelCollection, session.pendingCancelId);
      if (gcEventId) deleteGoogleCalendarEvent(gcEventId);
      await sendTextMessage("✅ Tu cita ha sido cancelada.", phoneNumber);
    } else {
      await sendTextMessage("De acuerdo, tu cita se mantiene. 👍", phoneNumber);
    }
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
    await sendMenu(phoneNumber);
    return;
  }

  // Exit chat
  if (buttonId === "exit_chat") {
    await sendTextMessage("¡Hasta luego! Escribe cuando necesites ayuda.", phoneNumber);
    clearSession(phoneNumber);
    return;
  }

  // Builtin actions
  if (buttonId.startsWith("builtin_")) {
    const action = buttonId.substring(8);
    const builtinActions = {
      schedule: () => showSchedule(phoneNumber),
      contact: () => showContact(phoneNumber),
      general: () => showGeneralInfo(phoneNumber),
      services: () => showServices(phoneNumber),
      cancel_appointment: () => handleCancelAppointment(phoneNumber),
      my_appointments: () => handleMyAppointments(phoneNumber)
    };

    if (builtinActions[action]) {
      await builtinActions[action]();
      return;
    }
  }

  // Start appointment flow shortcut (from service info card)
  if (buttonId === "start_appt_flow") {
    const flows = await getFlows();
    const apptFlow = flows.find(f => f.steps && f.steps.some(s => s.type === "appointment_slot"));
    if (apptFlow) {
      await startFlow(phoneNumber, apptFlow.id);
    } else {
      await sendTextMessage("Las citas no están disponibles.", phoneNumber);
    }
    return;
  }

  // Flow actions
  if (buttonId.startsWith("flow_")) {
    const flowId = buttonId.substring(5);
    await startFlow(phoneNumber, flowId);
    return;
  }

  // Message-type menu item: send static message and show menu again
  if (buttonId.startsWith("message_")) {
    const itemId = buttonId.substring(8);
    const menuConfig = await getMenuConfig();
    const item = menuConfig?.items?.find(i => i.id === itemId && i.type === "message");
    if (item && item.messageContent) {
      await sendTextMessage(item.messageContent, phoneNumber);
    }
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
    await sendMenu(phoneNumber);
    return;
  }

  // Back to menu
  if (buttonId === "back_main") {
    await sendMenu(phoneNumber);
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
    return;
  }

  // Legacy compat
  const legacyActions = {
    schedule: () => showSchedule(phoneNumber),
    contact: () => showContact(phoneNumber),
    register: () => startLegacyOrFlowRegistration(phoneNumber),
    general: () => showGeneralInfo(phoneNumber),
    back_main: () => sendMenu(phoneNumber)
  };

  if (legacyActions[buttonId]) {
    await legacyActions[buttonId]();
    return;
  }

  // Unrecognized or stale button (e.g. old message clicked later) — show menu gracefully
  await sendMenu(phoneNumber);
  setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
};

const startLegacyOrFlowRegistration = async (phoneNumber) => {
  const flows = await getFlows();
  const registrationFlow = flows.find(f => f.type === "registration");
  if (registrationFlow) {
    await startFlow(phoneNumber, registrationFlow.id);
  } else {
    const msg = await getMessage("no_registration", "El registro no está disponible en este momento.");
    await sendTextMessage(msg, phoneNumber);
  }
};

// ==================== DYNAMIC FLOW ENGINE ====================

const startFlow = async (phoneNumber, flowId) => {
  // Bloquear si el cliente ya tiene una solicitud/caso activo sin resolver
  const hasActive = await hasActiveCaseForPhone(phoneNumber);
  if (hasActive) {
    await sendTextMessage(
      '⏳ Ya tienes una solicitud en curso. Por favor espera a que sea atendida antes de iniciar una nueva.',
      phoneNumber
    );
    return;
  }

  const flow = await getFlow(flowId);
  if (!flow || !flow.steps || flow.steps.length === 0) {
    await sendTextMessage("Este servicio no está disponible actualmente.", phoneNumber);
    return;
  }

  // Validar acceso por número (modo prueba)
  const allowedPhones = Array.isArray(flow.testPhones) ? flow.testPhones : [];
  if (allowedPhones.length > 0 && !allowedPhones.includes(String(phoneNumber))) {
    await sendTextMessage("Este servicio no está disponible actualmente.", phoneNumber);
    return;
  }

  // Validar horario de atención del flujo
  if (flow.scheduleEnabled) {
    // Usar hora local de la org (America/El_Salvador) — el servidor corre en UTC
    const orgTz = 'America/El_Salvador';
    const localDate = new Date(new Date().toLocaleString('en-US', { timeZone: orgTz }));
    const pad = n => String(n).padStart(2, '0');
    const currentTime = `${pad(localDate.getHours())}:${pad(localDate.getMinutes())}`;
    const currentDay = localDate.getDay(); // 0=Dom … 6=Sáb

    // Soporte para scheduleSlots (nuevo) y fallback legacy
    const slots = Array.isArray(flow.scheduleSlots) && flow.scheduleSlots.length > 0
      ? flow.scheduleSlots
      : [{ days: flow.scheduleDays ?? [1,2,3,4,5], start: flow.scheduleStart ?? '07:00', end: flow.scheduleEnd ?? '17:00' }];

    // Está dentro del horario si alguna franja lo cubre
    const withinSchedule = slots.some(slot =>
      slot.days.includes(currentDay) &&
      currentTime >= slot.start &&
      currentTime < slot.end
    );

    if (!withinSchedule) {
      const offMsg = (flow.scheduleOffMessage || '').trim()
        || `Nuestro horario de atención para este servicio no está disponible en este momento. ¡Escríbenos en nuestro horario de atención! 😊`;
      await sendTextMessage(offMsg, phoneNumber);
      return;
    }
  }

  if (flow.cancelHintEnabled !== false) {
    const cancelHint = flow.cancelHint?.trim()
      || await getMessage("flow_cancel_hint", "Puedes escribir *cancelar* o *salir* en cualquier momento para detener el proceso.\n");
    if (flow.cancelHintImage) {
      await sendImageMessage(flow.cancelHintImage, cancelHint, phoneNumber);
    } else {
      await sendTextMessage(cancelHint, phoneNumber);
    }
  }

  setSession(phoneNumber, {
    step: "flow_pending",
    flowId: flow.id,
    flowStepIndex: 0,
    flowData: {},
    flowStartTime: Date.now()
  });

  await executeFlowStep(phoneNumber, flow, 0);
};

const executeFlowStep = async (phoneNumber, flow, stepIndex) => {
  if (stepIndex >= flow.steps.length) {
    await completeFlow(phoneNumber, flow);
    return;
  }

  const step = flow.steps[stepIndex];

  // Skip web steps always (only filled via web form)
  if (step.source === 'web' && !step.allowWebConfirm) {
    await executeFlowStep(phoneNumber, flow, stepIndex + 1);
    return;
  }
  // Skip order steps only if already pre-filled (web order flow); if direct WhatsApp, ask normally
  if (step.source === 'order' && !step.allowWebConfirm) {
    const sessionData = getSession(phoneNumber);
    if (sessionData?.flowData?.[step.fieldKey]) {
      await executeFlowStep(phoneNumber, flow, stepIndex + 1);
      return;
    }
  }

  // Pre-mensaje antes de la pregunta
  if (step.preMessageType && step.preMessageType !== 'none') {
    if (step.preMessageType === 'image' && step.preMessageImage) {
      await sendImageMessage(step.preMessageImage, step.preMessage || '', phoneNumber);
    } else if (step.preMessageType === 'link' && step.preMessageLinkUrl) {
      await sendCtaUrlMessage(step.preMessage || '', step.preMessageLinkUrl, step.preMessageLinkLabel || 'Ver más', phoneNumber);
    } else if (step.preMessage) {
      await sendTextMessage(step.preMessage, phoneNumber);
    }
  }

  switch (step.type) {
    case "text_input": {
      const cur = getSession(phoneNumber);
      const preFilledValue = cur?.flowData?.[step.fieldKey];
      if (step.allowWebConfirm && preFilledValue) {
        const confirmPrompt = (step.prompt ? step.prompt + '\n\n' : '') +
          `📋 *Texto sugerido:*\n${preFilledValue}\n\nResponde *ok* para confirmar, o escribe algo diferente.`;
        await sendTextMessage(confirmPrompt, phoneNumber);
      } else {
        await sendTextMessage(step.prompt, phoneNumber);
      }
      setSession(phoneNumber, {
        step: "flow_text",
        flowId: flow.id,
        flowStepIndex: stepIndex,
        flowStartTime: Date.now()
      });
      break;
    }

    case "number_input":
      await sendTextMessage(step.prompt, phoneNumber);
      setSession(phoneNumber, {
        step: "flow_number",
        flowId: flow.id,
        flowStepIndex: stepIndex,
        flowStartTime: Date.now()
      });
      break;

    case "select_list":
      await sendSelectList(phoneNumber, flow, step, stepIndex);
      break;

    case "select_buttons":
      await sendSelectButtons(phoneNumber, flow, step, stepIndex);
      break;

    case "select_services":
      await sendSelectServices(phoneNumber, flow, step, stepIndex);
      break;

    case "browse_collection":
      await sendBrowseCollection(phoneNumber, flow, step, stepIndex);
      break;

    case "appointment_slot":
      await sendAppointmentDays(phoneNumber, flow, step, stepIndex);
      break;

    case "message":
      await sendTextMessage(step.prompt, phoneNumber);
      setSession(phoneNumber, {
        flowStepIndex: stepIndex + 1,
        flowStartTime: Date.now()
      });
      await executeFlowStep(phoneNumber, flow, stepIndex + 1);
      break;

    case "image_input":
      await sendTextMessage(step.prompt || "📷 Por favor envía una imagen o foto.", phoneNumber);
      if (step.optional) {
        await sendTextMessage("_(Puedes escribir *omitir* si no deseas adjuntar)_", phoneNumber);
      }
      setSession(phoneNumber, {
        step: "flow_image",
        flowId: flow.id,
        flowStepIndex: stepIndex,
        flowStartTime: Date.now()
      });
      break;

    case "auth_lookup":
      await sendTextMessage(step.prompt || "Por favor escribe tu código:", phoneNumber);
      setSession(phoneNumber, {
        step: "flow_auth",
        flowId: flow.id,
        flowStepIndex: stepIndex,
        authRetries: 0,
        flowStartTime: Date.now()
      });
      break;

    case "location_input": {
      const locPrompt = step.prompt || "📍 Por favor comparte tu ubicación o escribe tu dirección.";
      await sendTextMessage(locPrompt, phoneNumber);
      await sendTextMessage("Puedes usar el botón 📎 → *Ubicación* de WhatsApp, o escribir tu dirección como texto.", phoneNumber);
      if (step.optional) {
        await sendTextMessage("_(Puedes escribir *omitir* si no deseas indicar dirección)_", phoneNumber);
      }
      setSession(phoneNumber, {
        step: "flow_location",
        flowId: flow.id,
        flowStepIndex: stepIndex,
        flowStartTime: Date.now()
      });
      break;
    }

    case "phone_lookup": {
      if (step.prompt) await sendTextMessage(step.prompt, phoneNumber);
      const record = await lookupCollectionByField(step.lookupCollection, step.lookupField, phoneNumber);
      if (!record) {
        const notFound = step.notFoundMessage || "Lo sentimos, tu número no está registrado en nuestro sistema.";
        await sendTextMessage(notFound, phoneNumber);
        clearSession(phoneNumber);
        return;
      }
      // Guardar todos los campos del registro en flowData para uso en pasos siguientes
      const cur = getSession(phoneNumber);
      const recordData = {};
      for (const [key, val] of Object.entries(record)) {
        if (key !== "id" && typeof key === "string") recordData[key] = val;
      }
      setSession(phoneNumber, { flowData: { ...(cur?.flowData || {}), ...recordData } });

      if (step.foundTemplate) {
        let response = step.foundTemplate;
        for (const [key, val] of Object.entries(record)) {
          if (key && typeof key === "string") {
            response = response.replace(new RegExp(`\\{${key}\\}`, "g"), String(val ?? ""));
          }
        }
        await sendTextMessage(response, phoneNumber);
      }
      setSession(phoneNumber, { flowStepIndex: stepIndex + 1, flowStartTime: Date.now() });
      await executeFlowStep(phoneNumber, flow, stepIndex + 1);
      break;
    }

    default:
      await sendTextMessage(step.prompt || "Continuando...", phoneNumber);
      setSession(phoneNumber, { flowStepIndex: stepIndex + 1 });
      await executeFlowStep(phoneNumber, flow, stepIndex + 1);
  }
};

const getItemDisplayName = (item, step, collectionDef) => {
  if (step && step.optionsTitleField && item[step.optionsTitleField]) {
    return String(item[step.optionsTitleField]);
  }
  if (collectionDef && collectionDef.displayField && item[collectionDef.displayField]) {
    return String(item[collectionDef.displayField]);
  }
  return String(item.name || item.nombre || item.label || item.id || "");
};

const getItemDescription = (item, step) => {
  if (step && step.optionsDescField && item[step.optionsDescField] !== undefined) {
    return String(item[step.optionsDescField]);
  }
  return "";
};

// ── List pagination helper ─────────────────────────────────────────────────
// WhatsApp allows max 10 rows per list. When there are more, we paginate using
// 8 real items per page and 2 navigation rows ("⬅ Anteriores" / "➡ Ver más").
const WA_LIST_PAGE_SIZE = 8;

const buildListPage = (allRows, page) => {
  if (allRows.length <= 10) return allRows;
  const totalPages = Math.ceil(allRows.length / WA_LIST_PAGE_SIZE);
  const start = page * WA_LIST_PAGE_SIZE;
  const pageRows = allRows.slice(start, start + WA_LIST_PAGE_SIZE);
  if (page < totalPages - 1) {
    pageRows.push({ id: "list_pg_next", title: `➡ Ver más (${page + 2}/${totalPages})`, description: "" });
  }
  if (page > 0) {
    pageRows.push({ id: "list_pg_prev", title: `⬅ Anteriores (${page}/${totalPages})`, description: "" });
  }
  return pageRows;
};
// ──────────────────────────────────────────────────────────────────────────

const sendSelectList = async (phoneNumber, flow, step, stepIndex, page = 0) => {
  let allRows = [];

  if (step.optionsSource && step.optionsSource !== "custom") {
    const [items, colDef] = await Promise.all([
      getCollectionItems(step.optionsSource),
      getCollectionDef(step.optionsSource)
    ]);
    allRows = items.map(item => ({
      id: `fsel_${item.id}`,
      title: getItemDisplayName(item, step, colDef).substring(0, 24),
      description: getItemDescription(item, step).substring(0, 72)
    }));
  } else if (step.customOptions && step.customOptions.length > 0) {
    allRows = step.customOptions.map(opt => ({
      id: `fsel_${opt.value}`,
      title: (opt.label || opt.value).substring(0, 24),
      description: (opt.description || "").substring(0, 72)
    }));
  }

  if (allRows.length === 0) {
    await sendTextMessage("No hay opciones disponibles.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu" });
    return;
  }

  const rows = buildListPage(allRows, page);
  const sections = [{ title: step.fieldLabel || "Opciones", rows }];
  const buttonText = step.buttonText || "Ver opciones";

  setSession(phoneNumber, {
    step: "flow_select",
    flowId: flow.id,
    flowStepIndex: stepIndex,
    listPage: page,
    flowStartTime: Date.now()
  });

  await sendInteractiveList(step.prompt, buttonText, sections, phoneNumber);
};

const sendSelectButtons = async (phoneNumber, flow, step, stepIndex) => {
  let buttons = [];

  if (step.optionsSource && step.optionsSource !== "custom") {
    const [items, colDef] = await Promise.all([
      getCollectionItems(step.optionsSource),
      getCollectionDef(step.optionsSource)
    ]);
    buttons = items.slice(0, 3).map(item => ({
      id: `fsel_${item.id}`,
      title: getItemDisplayName(item, step, colDef).substring(0, 20)
    }));
  } else if (step.customOptions && step.customOptions.length > 0) {
    buttons = step.customOptions.slice(0, 3).map(opt => ({
      id: `fsel_${opt.value}`,
      title: (opt.label || opt.value).substring(0, 20)
    }));
  }

  if (buttons.length === 0) {
    await sendTextMessage("No hay opciones disponibles.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu" });
    return;
  }

  setSession(phoneNumber, {
    step: "flow_select",
    flowId: flow.id,
    flowStepIndex: stepIndex,
    flowStartTime: Date.now()
  });

  await sendInteractiveButtons(step.prompt, buttons, phoneNumber);
};

const handleFlowSelectResponse = async (phoneNumber, buttonId, session) => {
  // Handle list pagination
  if (buttonId === "list_pg_next" || buttonId === "list_pg_prev") {
    const flow = await getFlow(session.flowId);
    if (!flow) return;
    const step = flow.steps[session.flowStepIndex];
    const newPage = buttonId === "list_pg_next"
      ? (session.listPage || 0) + 1
      : (session.listPage || 0) - 1;
    await sendSelectList(phoneNumber, flow, step, session.flowStepIndex, newPage);
    return;
  }

  const flow = await getFlow(session.flowId);
  if (!flow) {
    await sendTextMessage("Error en el proceso. Escribe *menu* para volver.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu" });
    return;
  }

  const step = flow.steps[session.flowStepIndex];
  const selectedValue = buttonId.startsWith("fsel_") ? buttonId.substring(5) : buttonId;

  // Resolve the display name using step's titleField or collection's displayField
  let displayName = selectedValue;
  if (step.optionsSource && step.optionsSource !== "custom") {
    const [items, colDef] = await Promise.all([
      getCollectionItems(step.optionsSource),
      getCollectionDef(step.optionsSource)
    ]);
    const found = items.find(i => i.id === selectedValue);
    if (found) displayName = getItemDisplayName(found, step, colDef);
  } else if (step.customOptions) {
    const found = step.customOptions.find(o => o.value === selectedValue);
    if (found) {
      displayName = found.label || selectedValue;
      if (found.duration) {
        session.flowData = session.flowData || {};
        session.flowData._apptDuration = found.duration;
        session.flowData._apptService = found.label || found.value;
      }
    }
  }

  const flowData = { ...session.flowData };
  flowData[step.fieldKey] = displayName;
  flowData[`${step.fieldKey}Id`] = selectedValue;

  const nextIndex = session.flowStepIndex + 1;
  setSession(phoneNumber, {
    step: "flow_pending",
    flowData,
    flowStepIndex: nextIndex,
    flowStartTime: Date.now()
  });

  await executeFlowStep(phoneNumber, flow, nextIndex);
};

// ==================== BROWSE COLLECTION ====================

const sendBrowseCollection = async (phoneNumber, flow, step, stepIndex, page = 0) => {
  const collectionSlug = step.sourceCollection;
  if (!collectionSlug) {
    await sendTextMessage("Error: colección no configurada.", phoneNumber);
    return;
  }

  const items = await getCollectionItems(collectionSlug);
  if (items.length === 0) {
    await sendTextMessage("No hay elementos disponibles.", phoneNumber);
    const nextIndex = stepIndex + 1;
    setSession(phoneNumber, { step: "flow_pending", flowStepIndex: nextIndex });
    await executeFlowStep(phoneNumber, flow, nextIndex);
    return;
  }

  const displayField = step.displayField || "name";
  const allRows = items.map(item => ({
    id: `brw_${item.id}`,
    title: (item[displayField] || item.name || item.id).substring(0, 24),
    description: ""
  }));

  const rows = buildListPage(allRows, page);
  const prompt = step.prompt || "Selecciona un elemento:";
  const sections = [{ title: "Opciones", rows }];

  setSession(phoneNumber, {
    step: "flow_browse",
    flowId: flow.id,
    flowStepIndex: stepIndex,
    browseCollection: collectionSlug,
    browseDetailFields: step.detailFields || [],
    browseDisplayField: displayField,
    browseListPage: page,
    flowStartTime: Date.now()
  });

  await sendInteractiveList(prompt, step.buttonText || "Ver opciones", sections, phoneNumber);
};

const handleBrowseSelection = async (phoneNumber, buttonId, session) => {
  const itemId = buttonId.startsWith("brw_") ? buttonId.substring(4) : buttonId;
  const collectionSlug = session.browseCollection;

  const item = await getCollectionItem(collectionSlug, itemId);
  if (!item) {
    await sendTextMessage("Elemento no encontrado.", phoneNumber);
    return;
  }

  const colDef = await getCollectionDef(collectionSlug);
  const detailFieldKeys = session.browseDetailFields || [];
  const allFields = colDef?.fields || [];

  let info = "";
  if (detailFieldKeys.length > 0 && allFields.length > 0) {
    for (const key of detailFieldKeys) {
      const fieldDef = allFields.find(f => f.key === key);
      const label = fieldDef?.label || key;
      let val = item[key];
      if (val === undefined || val === null) continue;
      if (Array.isArray(val)) {
        info += `*${label}:*\n`;
        val.forEach(v => { info += `• ${v}\n`; });
        info += "\n";
      } else {
        info += `*${label}:* ${val}\n`;
      }
    }
  } else {
    const displayField = session.browseDisplayField || "name";
    info = `*${item[displayField] || item.name || itemId}*\n\n`;
    for (const [key, val] of Object.entries(item)) {
      if (["id", "active", "order", "createdAt", "updatedAt", "organizationId"].includes(key)) continue;
      if (val === undefined || val === null) continue;
      if (Array.isArray(val)) {
        info += `*${key}:*\n`;
        val.forEach(v => { info += `• ${v}\n`; });
      } else {
        info += `*${key}:* ${val}\n`;
      }
    }
  }

  if (!info.trim()) info = "Sin detalles disponibles.";

  setSession(phoneNumber, {
    step: "flow_browse_detail",
    flowId: session.flowId,
    flowStepIndex: session.flowStepIndex,
    browseCollection: collectionSlug,
    browseDetailFields: session.browseDetailFields,
    browseDisplayField: session.browseDisplayField,
    flowStartTime: Date.now()
  });

  const flow = await getFlow(session.flowId);
  const hasMoreSteps = flow && (session.flowStepIndex + 1) < flow.steps.length;

  const buttons = [{ id: "browse_back", title: "Ver otro" }];
  if (hasMoreSteps) {
    buttons.push({ id: "browse_continue", title: "Continuar" });
  } else {
    buttons.push({ id: "back_main", title: "Menú Principal" });
  }

  await sendInteractiveButtons(info.trim(), buttons, phoneNumber);
};

const handleFlowTextInput = async (phoneNumber, message, session) => {
  const flow = await getFlow(session.flowId);
  if (!flow) {
    await sendTextMessage("Error en el proceso. Escribe *menu* para volver.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu" });
    return;
  }

  const step = flow.steps[session.flowStepIndex];
  const validation = step.validation || {};

  // If step has allowWebConfirm and user confirms, keep the pre-filled value
  if (step.allowWebConfirm) {
    const preFilledValue = session.flowData?.[step.fieldKey];
    const confirmWords = ['ok', 'confirmar', 'si', 'sí', '1', 'listo', 'confirmo'];
    if (preFilledValue && confirmWords.includes(message.trim().toLowerCase())) {
      const nextIndex = session.flowStepIndex + 1;
      setSession(phoneNumber, { step: 'flow_pending', flowStepIndex: nextIndex, flowStartTime: Date.now() });
      await executeFlowStep(phoneNumber, flow, nextIndex);
      return;
    }
  }

  if (step.required && (!message || message.trim().length === 0)) {
    await sendTextMessage(step.errorMessage || "Este campo es requerido. Intenta de nuevo.", phoneNumber);
    return;
  }

  if (validation.minLength && message.trim().length < validation.minLength) {
    await sendTextMessage(step.errorMessage || `Mínimo ${validation.minLength} caracteres.`, phoneNumber);
    return;
  }

  if (validation.maxLength && message.trim().length > validation.maxLength) {
    await sendTextMessage(step.errorMessage || `Máximo ${validation.maxLength} caracteres.`, phoneNumber);
    return;
  }

  const flowData = { ...session.flowData };
  flowData[step.fieldKey] = message.trim();

  const nextIndex = session.flowStepIndex + 1;
  setSession(phoneNumber, {
    step: "flow_pending",
    flowData,
    flowStepIndex: nextIndex,
    flowStartTime: Date.now()
  });

  await executeFlowStep(phoneNumber, flow, nextIndex);
};

const handleFlowNumberInput = async (phoneNumber, message, session) => {
  const flow = await getFlow(session.flowId);
  if (!flow) {
    await sendTextMessage("Error en el proceso. Escribe *menu* para volver.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu" });
    return;
  }

  const step = flow.steps[session.flowStepIndex];
  const validation = step.validation || {};
  const num = parseInt(message);

  if (isNaN(num)) {
    await sendTextMessage(step.errorMessage || "Escribe un número válido.", phoneNumber);
    return;
  }

  if (validation.min !== undefined && num < validation.min) {
    await sendTextMessage(step.errorMessage || `El valor mínimo es ${validation.min}.`, phoneNumber);
    return;
  }

  if (validation.max !== undefined && num > validation.max) {
    await sendTextMessage(step.errorMessage || `El valor máximo es ${validation.max}.`, phoneNumber);
    return;
  }

  const flowData = { ...session.flowData };
  flowData[step.fieldKey] = num;

  const nextIndex = session.flowStepIndex + 1;
  setSession(phoneNumber, {
    step: "flow_pending",
    flowData,
    flowStepIndex: nextIndex,
    flowStartTime: Date.now()
  });

  await executeFlowStep(phoneNumber, flow, nextIndex);
};

const completeFlow = async (phoneNumber, flow) => {
  const session = getSession(phoneNumber);
  const flowData = session?.flowData || {};

  if (flow.saveToCollection) {
    try {
      const submissionData = {
        ...flowData,
        phoneNumber,
        flowId: flow.id,
        flowName: flow.name
      };
      if (flowData._apptFecha) submissionData.status = "confirmed";
      const docId = await saveFlowSubmission(flow.saveToCollection, submissionData);
      if (flowData._apptFecha) {
        const gcEventId = await createGoogleCalendarEvent({ ...submissionData, phoneNumber });
        if (gcEventId && docId) {
          await saveGcEventId(flow.saveToCollection, docId, gcEventId);
        }
      }
      if (flow.notifyDelivery) {
        const clientName = flowData.fullName || flowData.name || flowData.nombre || phoneNumber;
        sendPushToDeliveries({
          title: "Nueva solicitud",
          body: `${flow.name} — ${clientName}`,
          url: "/admin/inbox"
        }).catch(() => {});
      }
    } catch (error) {
      console.error("Error saving flow submission:", error);
    }
  }

  let completionMsg = flow.completionMessage || "Proceso completado. ¡Gracias!";
  completionMsg = completionMsg.replace("{phoneNumber}", phoneNumber);

  for (const [key, value] of Object.entries(flowData)) {
    if (key.startsWith("_")) continue;
    const regex = new RegExp(`\\{${key}\\}`, "g");
    const displayValue = typeof value === "string"
      ? value.toUpperCase()
      : (value && typeof value === "object" && value.text)
        ? value.text.toUpperCase()
        : String(value);
    completionMsg = completionMsg.replace(regex, displayValue);
  }

  await clearSession(phoneNumber);
  await sendTextMessage(completionMsg, phoneNumber);
};

// ==================== BUILTIN HANDLERS ====================

const showSchedule = async (phoneNumber) => {
  const schedule = await getScheduleInfo();

  let info;
  if (schedule && schedule.days && Array.isArray(schedule.days)) {
    const activeDays = schedule.days.filter(d => d.active);
    if (activeDays.length > 0) {
      info = "📅 *Horarios de Atención*\n\n";
      activeDays.forEach(day => {
        const shifts = (day.shifts || []).map(s => `${s.from} - ${s.to}`).join(" | ");
        info += `*${day.name}:* ${shifts}\n`;
      });
    } else {
      info = await getMessage("schedule_info", "Horarios no disponibles. Contacta con la administración.");
    }
  } else {
    info = await getMessage("schedule_info", "Horarios no disponibles. Contacta con la administración.");
  }

  const buttons = [
    { id: "builtin_contact", title: "Ver Contacto" },
    { id: "back_main", title: "Menú Principal" }
  ];

  await sendInteractiveButtons(info, buttons, phoneNumber);
};

const showContact = async (phoneNumber) => {
  const contact = await getContactInfo();

  let info;
  if (contact) {
    const show = contact.showFields || {};
    const lines = [];

    if (contact.address && show.address !== false)
      lines.push(`📍 *Dirección:* ${contact.address}`);

    const cityCountry = [
      contact.city && show.city !== false ? contact.city : null,
      contact.country && show.country !== false ? contact.country : null
    ].filter(Boolean).join(", ");
    if (cityCountry) lines.push(`🏙️ ${cityCountry}`);

    if (contact.phone && show.phone !== false)
      lines.push(`📱 *Teléfono:* ${contact.phone}`);

    if (contact.email && show.email !== false)
      lines.push(`✉️ *Email:* ${contact.email}`);

    if (lines.length > 0) {
      info = "*Contáctanos*\n\n" + lines.join("\n");
    } else {
      info = await getMessage("contact_info", "Información de contacto no disponible.");
    }
  } else {
    info = await getMessage("contact_info", "Información de contacto no disponible.");
  }

  const buttons = [
    { id: "builtin_schedule", title: "Ver Horarios" },
    { id: "back_main", title: "Menú Principal" }
  ];

  await sendInteractiveButtons(info, buttons, phoneNumber);
};

const showGeneralInfo = async (phoneNumber) => {
  const general = await getGeneralInfo();

  let info;
  if (general && (general.name || general.description)) {
    info = "*Información General*\n\n";
    if (general.name) info += `*${general.name}*\n\n`;
    if (general.description) info += `${general.description}`;
  } else {
    info = await getMessage("general_info", "Información no disponible.");
  }

  const buttons = [
    { id: "builtin_schedule", title: "Ver Horarios" },
    { id: "back_main", title: "Menú Principal" }
  ];

  await sendInteractiveButtons(info, buttons, phoneNumber);
};

const showServices = async (phoneNumber) => {
  const schedule = await getScheduleInfo();
  const services = schedule?.services || [];

  if (services.length === 0) {
    const general = await getGeneralInfo();
    let info = "*Nuestros Servicios*\n\n";
    if (general?.description) info += general.description;
    else info = await getMessage("services_info", "Información de servicios no disponible.");
    await sendInteractiveButtons(info, [{ id: "back_main", title: "Menú Principal" }], phoneNumber);
    return;
  }

  const rows = services.map((svc, i) => ({
    id: `svc_info_${i}`,
    title: (svc.title || svc.name || "").substring(0, 20),
    description: (svc.subtitle || "").substring(0, 72)
  }));

  setSession(phoneNumber, { step: "svc_info_select" });
  await sendInteractiveList(
    "*Nuestros Servicios*\n\nSelecciona un servicio para conocer más:",
    "Ver servicios",
    [{ title: "Servicios", rows }],
    phoneNumber
  );
};

// ==================== APPOINTMENT SLOT (flow step type) ====================

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const generateTimeSlots = (shifts, slotMinutes) => {
  const slots = [];
  for (const shift of shifts) {
    const [fromH, fromM] = shift.from.split(":").map(Number);
    const [toH, toM] = shift.to.split(":").map(Number);
    let current = fromH * 60 + fromM;
    const end = toH * 60 + toM;
    while (current + slotMinutes <= end) {
      const hh = String(Math.floor(current / 60)).padStart(2, "0");
      const mm = String(current % 60).padStart(2, "0");
      slots.push(`${hh}:${mm}`);
      current += slotMinutes;
    }
  }
  return slots;
};

const toMinutes = (timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

const slotsOverlap = (startA, durationA, startB, durationB) => {
  const a0 = toMinutes(startA), a1 = a0 + durationA;
  const b0 = toMinutes(startB), b1 = b0 + durationB;
  return a0 < b1 && b0 < a1;
};

const getFreeSlots = (allSlots, duration, booked, capacity = 1) => {
  return allSlots.filter(slot => {
    const count = booked.filter(b => {
      const bDuration = b._apptDuration || b.duracion || duration;
      return slotsOverlap(slot, duration, b._apptHora || b.hora, bDuration);
    }).length;
    return count < capacity;
  });
};

const sendSelectServices = async (phoneNumber, flow, step, stepIndex) => {
  const schedule = await getScheduleInfo();
  const services = (schedule?.services || []).filter(s => s.name || s.title);
  if (!services.length) {
    await sendTextMessage("Los servicios no están disponibles en este momento.", phoneNumber);
    const nextIndex = stepIndex + 1;
    setSession(phoneNumber, { step: "flow_pending", flowStepIndex: nextIndex, flowStartTime: Date.now() });
    await executeFlowStep(phoneNumber, flow, nextIndex);
    return;
  }
  const rows = services.map((svc, i) => ({
    id: `svsvc_${i}`,
    title: (svc.title || svc.name || "").substring(0, 24),
    description: (svc.subtitle ? svc.subtitle.substring(0, 72) : `${svc.duration} min`)
  }));
  setSession(phoneNumber, {
    step: "flow_select_services",
    flowId: flow.id,
    flowStepIndex: stepIndex,
    flowStartTime: Date.now()
  });
  const sections = [{ title: step.fieldLabel || "Servicios", rows }];
  await sendInteractiveList(
    step.prompt || "¿Qué servicio necesitas?",
    step.buttonText || "Ver servicios",
    sections,
    phoneNumber
  );
};

const sendServiceSelection = async (phoneNumber, flow, stepIndex, services) => {
  const rows = services.map((svc, i) => ({
    id: `appt_svc_${i}`,
    title: (svc.title || svc.name || "").substring(0, 20),
    description: svc.subtitle ? svc.subtitle.substring(0, 72) : `${svc.duration} min`
  }));
  setSession(phoneNumber, {
    step: "appt_select_service",
    flowId: flow.id,
    flowStepIndex: stepIndex,
    flowStartTime: Date.now()
  });
  const sections = [{ title: "Servicios disponibles", rows }];
  await sendInteractiveList("¿Qué servicio necesitas agendar?", "Ver servicios", sections, phoneNumber);
};

const sendAppointmentDays = async (phoneNumber, flow, step, stepIndex) => {
  const schedule = await getScheduleInfo();
  const session = getSession(phoneNumber);

  // Appointments require offersAppointments=true AND at least one service configured
  if (!schedule?.offersAppointments || !schedule?.services?.length) {
    const nextIndex = stepIndex + 1;
    setSession(phoneNumber, { flowStepIndex: nextIndex });
    await executeFlowStep(phoneNumber, flow, nextIndex);
    return;
  }

  // If no service has been selected yet → ask first
  if (!session?.flowData?._apptDuration) {
    await sendServiceSelection(phoneNumber, flow, stepIndex, schedule.services);
    return;
  }

  const apptDuration = session?.flowData?._apptDuration;

  if (!schedule || !schedule.days || !apptDuration) {
    await sendTextMessage("Las citas no están disponibles en este momento.", phoneNumber);
    const nextIndex = stepIndex + 1;
    setSession(phoneNumber, { flowStepIndex: nextIndex });
    await executeFlowStep(phoneNumber, flow, nextIndex);
    return;
  }

  const blockedDates = schedule.blockedDates || [];
  const saveToCollection = flow.saveToCollection || "";
  const today = new Date();
  const availableDays = [];

  for (let i = 1; i <= 30 && availableDays.length < 10; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dayName = DAY_NAMES[date.getDay()];
    const dayConfig = schedule.days.find(d => d.name === dayName);
    if (!dayConfig || !dayConfig.active) continue;

    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (blockedDates.includes(dateStr)) continue;

    const allSlots = generateTimeSlots(dayConfig.shifts, apptDuration);
    const booked = await getAppointmentsByDate(dateStr, saveToCollection);
    const svc = schedule.services.find(s => (s.title || s.name) === session?.flowData?._apptService);
    const capacity = svc?.capacity || 1;
    const freeSlots = getFreeSlots(allSlots, apptDuration, booked, capacity);
    if (freeSlots.length === 0) continue;

    const label = `${dayName} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
    availableDays.push({ dateStr, label, freeCount: freeSlots.length });
  }

  if (availableDays.length === 0) {
    await sendTextMessage("No hay días disponibles para citas próximamente.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
    return;
  }

  const rows = availableDays.map(d => ({
    id: `appt_day_${d.dateStr}`,
    title: d.label.substring(0, 24),
    description: `${d.freeCount} horario${d.freeCount > 1 ? "s" : ""} disponible${d.freeCount > 1 ? "s" : ""}`
  }));

  setSession(phoneNumber, {
    step: "appt_select_day",
    flowId: flow.id,
    flowStepIndex: stepIndex,
    flowStartTime: Date.now()
  });

  const prompt = step.prompt || "📅 Selecciona el día para tu cita:";
  const sections = [{ title: "Días disponibles", rows }];
  await sendInteractiveList(prompt, step.buttonText || "Ver días", sections, phoneNumber);
};

const handleApptDaySelected = async (phoneNumber, dateStr, session) => {
  const schedule = await getScheduleInfo();
  if (!schedule) return;

  const flow = await getFlow(session.flowId);
  if (!flow) return;

  const apptDuration = session.flowData?._apptDuration || 30;
  const date = new Date(dateStr + "T12:00:00");
  const dayName = DAY_NAMES[date.getDay()];
  const dayConfig = schedule.days.find(d => d.name === dayName);
  if (!dayConfig) return;

  const saveToCollection = flow.saveToCollection || "";
  const allSlots = generateTimeSlots(dayConfig.shifts, apptDuration);
  const booked = await getAppointmentsByDate(dateStr, saveToCollection);
  const svc = schedule?.services?.find(s => s.title === session.flowData?._apptService);
  const capacity = svc?.capacity || 1;
  const freeSlots = getFreeSlots(allSlots, apptDuration, booked, capacity);

  if (freeSlots.length === 0) {
    await sendTextMessage("Este día ya no tiene horarios disponibles. Selecciona otro.", phoneNumber);
    await sendAppointmentDays(phoneNumber, flow, flow.steps[session.flowStepIndex], session.flowStepIndex);
    return;
  }

  const label = `${dayName} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
  const displaySlots = freeSlots.slice(0, 10);

  const rows = displaySlots.map(slot => ({
    id: `appt_slot_${slot}`,
    title: slot,
    description: `${apptDuration} min`
  }));

  setSession(phoneNumber, {
    step: "appt_select_time",
    flowId: flow.id,
    flowStepIndex: session.flowStepIndex,
    apptDate: dateStr,
    apptDateLabel: label,
    flowStartTime: Date.now()
  });

  const extra = freeSlots.length > 10 ? `\n_(Mostrando los primeros 10 de ${freeSlots.length} horarios)_` : "";
  const sections = [{ title: "Horarios", rows }];
  await sendInteractiveList(
    `🕐 *Horarios para ${label}*\n\nSelecciona la hora (${apptDuration} min):${extra}`,
    "Ver horarios",
    sections,
    phoneNumber
  );
};

const handleApptSlotSelected = async (phoneNumber, timeSlot, session) => {
  const flow = await getFlow(session.flowId);
  if (!flow) return;

  const schedule = await getScheduleInfo();
  const step = flow.steps[session.flowStepIndex];
  const dateFieldKey = step.fieldKey || "fecha";
  const timeFieldKey = step.timeFieldKey || "hora";
  const apptDuration = session.flowData?._apptDuration || 30;

  const flowData = { ...session.flowData };
  flowData[dateFieldKey] = session.apptDateLabel || session.apptDate;
  flowData[timeFieldKey] = timeSlot;

  const saveToCollection = flow.saveToCollection || "";
  const existing = await getAppointmentsByDate(session.apptDate, saveToCollection);
  const svcForConflict = schedule?.services?.find(s => (s.title || s.name) === session.flowData?._apptService);
  const capacityForConflict = svcForConflict?.capacity || 1;
  const conflictCount = existing.filter(b => {
    const bDuration = b._apptDuration || b.duracion || apptDuration;
    return slotsOverlap(timeSlot, apptDuration, b._apptHora || b.hora, bDuration);
  }).length;
  const hasConflict = conflictCount >= capacityForConflict;

  if (hasConflict) {
    await sendTextMessage("⚠️ Ese horario acaba de ser reservado. Selecciona otro.", phoneNumber);
    await handleApptDaySelected(phoneNumber, session.apptDate, session);
    return;
  }

  flowData._apptFecha = session.apptDate;
  flowData._apptHora = timeSlot;
  flowData._apptDuration = apptDuration;

  const nextIndex = session.flowStepIndex + 1;
  setSession(phoneNumber, {
    step: "flow_pending",
    flowData,
    flowStepIndex: nextIndex,
    flowStartTime: Date.now()
  });

  await executeFlowStep(phoneNumber, flow, nextIndex);
};

// ==================== TEXT MESSAGE HANDLER ====================

// ==================== MY APPOINTMENTS ====================

const handleMyAppointments = async (phoneNumber) => {
  const appts = await getUpcomingAppointmentsByPhone(phoneNumber);
  if (!appts || appts.length === 0) {
    await sendTextMessage("No tienes citas próximas registradas.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
    await sendMenu(phoneNumber);
    return;
  }
  const lines = appts.map((a, i) => {
    const svc = a._apptService ? `*${a._apptService}*` : "*Cita*";
    return `${i + 1}. ${svc}\n   📅 ${a._apptFecha} a las ${a._apptHora}`;
  });
  await sendTextMessage(`📋 *Tus citas próximas:*\n\n${lines.join("\n\n")}`, phoneNumber);
  setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
  await sendMenu(phoneNumber);
};

// ==================== CANCEL APPOINTMENT ====================

const handleCancelAppointment = async (phoneNumber) => {
  const appts = await getUpcomingAppointmentsByPhone(phoneNumber);
  if (!appts || appts.length === 0) {
    await sendTextMessage("No tienes citas próximas para cancelar.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
    await sendMenu(phoneNumber);
    return;
  }
  if (appts.length === 1) {
    const a = appts[0];
    const svc = a._apptService || "Cita";
    setSession(phoneNumber, {
      step: "cancel_appt_confirm",
      pendingCancelId: a.id,
      pendingCancelCollection: a.collectionName,
      hasGreeted: true
    });
    const buttons = [
      { id: "cancel_appt_yes", title: "Sí, cancelar" },
      { id: "cancel_appt_no",  title: "No, mantener" }
    ];
    await sendInteractiveButtons(
      `¿Deseas cancelar tu cita?\n\n*${svc}*\n📅 ${a._apptFecha} a las ${a._apptHora}`,
      buttons, phoneNumber
    );
  } else {
    const rows = appts.map((a, i) => ({
      id: `cancel_pick_${i}`,
      title: (a._apptService || "Cita").substring(0, 24),
      description: `${a._apptFecha} ${a._apptHora}`
    }));
    setSession(phoneNumber, {
      step: "cancel_appt_select",
      pendingCancelOptions: appts,
      hasGreeted: true
    });
    await sendInteractiveList("¿Cuál cita deseas cancelar?", "Ver citas", [{ title: "Tus citas", rows }], phoneNumber);
  }
};

const handleFlowAuthInput = async (phoneNumber, message, session) => {
  const flow = await getFlow(session.flowId);
  if (!flow) {
    await sendTextMessage("Error en el proceso. Escribe *menu* para volver.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu" });
    return;
  }

  const step = flow.steps[session.flowStepIndex];
  const userInput = message.trim();

  if (!userInput) {
    await sendTextMessage(step.notFoundMessage || "Por favor ingresa un valor válido.", phoneNumber);
    return;
  }

  const record = await lookupCollectionByField(step.lookupCollection, step.authField, userInput);

  if (record) {
    let response = step.resultTemplate || "Registro encontrado.";
    for (const [key, val] of Object.entries(record)) {
      if (key && typeof key === 'string') {
        response = response.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val ?? ''));
      }
    }
    await sendTextMessage(response, phoneNumber);
    const nextIndex = session.flowStepIndex + 1;
    setSession(phoneNumber, { step: "flow_pending", flowStepIndex: nextIndex, flowStartTime: Date.now() });
    await executeFlowStep(phoneNumber, flow, nextIndex);
  } else {
    const retries = (session.authRetries || 0) + 1;
    const maxRetries = step.maxRetries || 3;
    if (retries >= maxRetries) {
      await sendTextMessage("No pudimos encontrar tu registro. Por favor contacta con nuestro equipo de soporte.", phoneNumber);
      clearSession(phoneNumber);
    } else {
      await sendTextMessage(step.notFoundMessage || "No encontramos ese código. Intenta de nuevo.", phoneNumber);
      setSession(phoneNumber, { authRetries: retries, flowStartTime: Date.now() });
    }
  }
};

const handleOrderCode = async (phoneNumber, code) => {
  const order = await getOrderByCode(code);
  if (!order) {
    await sendTextMessage(`No encontramos ningún pedido con el código *${code}*. Verifica e intenta nuevamente.`, phoneNumber);
    return;
  }
  if (order.status === 'confirmed' || order.status === 'cancelled') {
    await sendTextMessage(`El pedido *${code}* ya fue registrado. Escribe *hola* para ver el menú.`, phoneNumber);
    return;
  }

  await updateOrder(order.id, { clientPhone: phoneNumber, status: 'confirmed' });

  const flow = await getFlow(order.flowId);
  if (!flow) {
    await sendTextMessage(`✅ Pedido *${code}* recibido. Te contactaremos pronto.`, phoneNumber);
    return;
  }

  // Pre-fill flowData from order + web form data
  const orderFieldValues = {
    orderCode:  code,
    orderItems: order.itemsText  || '',
    orderTotal: order.totalText  || '',
    orderDate:  order.orderDate  || '',
  };
  const webData = order.webData || {};
  const flowData = {};

  for (const step of (flow.steps || [])) {
    if (!step.fieldKey) continue;
    if (step.source === 'order' && step.orderField) {
      flowData[step.fieldKey] = orderFieldValues[step.orderField] || '';
    } else if (step.source === 'web') {
      flowData[step.fieldKey] = webData[step.fieldKey] || '';
    }
  }

  // Find first bot step
  const firstBotIndex = (flow.steps || []).findIndex(s => !s.source || s.source === 'bot');

  if (firstBotIndex === -1) {
    setSession(phoneNumber, { step: 'flow_pending', flowId: flow.id, flowStepIndex: flow.steps.length, flowData, flowStartTime: Date.now() });
    await completeFlow(phoneNumber, flow);
    return;
  }

  setSession(phoneNumber, { step: 'flow_pending', flowId: flow.id, flowStepIndex: firstBotIndex, flowData, flowStartTime: Date.now() });
  await executeFlowStep(phoneNumber, flow, firstBotIndex);
};

const handleUserMessage = async (phoneNumber, message, session) => {
  const lowerMessage = message.toLowerCase();

  // Cancel / exit keywords
  const cancelWords = ["cancelar", "salir", "volver", "cancel", "exit", "parar", "detener", "no quiero", "no gracias"];
  const isCancelRequest = cancelWords.some(w => lowerMessage.includes(w));

  if (isCancelRequest) {
    if (session.step && session.step.startsWith("flow_")) {
      const msg = await getMessage("flow_cancelled", "Proceso cancelado. ¡Hasta luego! 👋");
      await sendTextMessage(msg, phoneNumber);
      clearSession(phoneNumber);
    } else {
      await sendTextMessage("¡Hasta luego! 👋 Escribe cuando necesites ayuda.", phoneNumber);
      clearSession(phoneNumber);
    }
    return;
  }

  // Note: PED- order codes are already handled before reaching this function

  // Handle active flow text/number input
  if (session.step === "flow_text") {
    await handleFlowTextInput(phoneNumber, message, session);
    return;
  }

  if (session.step === "flow_number") {
    await handleFlowNumberInput(phoneNumber, message, session);
    return;
  }

  // Waiting for image input but user typed text
  if (session.step === "flow_image") {
    if (["omitir", "skip", "no"].includes(lowerMessage)) {
      const flow = await getFlow(session.flowId);
      const currentStep = flow?.steps?.[session.flowStepIndex];
      if (currentStep?.optional) {
        const nextIndex = session.flowStepIndex + 1;
        setSession(phoneNumber, { flowStepIndex: nextIndex });
        await executeFlowStep(phoneNumber, flow, nextIndex);
        return;
      }
    }
    await sendTextMessage("Por favor envía una imagen o foto 📷", phoneNumber);
    return;
  }

  if (session.step === "flow_auth") {
    await handleFlowAuthInput(phoneNumber, message, session);
    return;
  }

  // Handle location_input step when user writes address as text
  if (session.step === "flow_location") {
    const flow = await getFlow(session.flowId);
    const step = flow?.steps?.[session.flowStepIndex];
    if (step) {
      if (step.optional && ["omitir", "skip", "no"].includes(lowerMessage)) {
        const nextIndex = session.flowStepIndex + 1;
        setSession(phoneNumber, { flowStepIndex: nextIndex, flowStartTime: Date.now() });
        await executeFlowStep(phoneNumber, flow, nextIndex);
        return;
      }
      if (!message || message.trim().length < 5) {
        await sendTextMessage("Por favor escribe una dirección válida o comparte tu ubicación con el botón 📎 → *Ubicación*.", phoneNumber);
        return;
      }
      const fieldKey = step.fieldKey || "direccion";
      const flowData = { ...session.flowData, [fieldKey]: { text: message.trim() } };
      const nextIndex = session.flowStepIndex + 1;
      setSession(phoneNumber, { flowData, flowStepIndex: nextIndex, flowStartTime: Date.now() });
      await executeFlowStep(phoneNumber, flow, nextIndex);
      return;
    }
  }

  // Waiting for select/browse/appointment but user typed text
  if (session.step === "flow_select" || session.step === "flow_browse" || session.step === "flow_browse_detail"
      || session.step === "svc_info_select"
      || session.step === "appt_select_service"
      || session.step === "appt_select_day" || session.step === "appt_select_time") {
    await sendTextMessage("Por favor selecciona una opción del menú.", phoneNumber);
    return;
  }

  // Configurable keyword responses (config/keywords in Firebase)
  const keywords = await getKeywords();
  const activeKeywords = keywords.filter(k => k.active !== false && k.keyword && k.response);
  for (const kw of activeKeywords) {
    const kwLower = kw.keyword.toLowerCase().trim();
    const matched = kw.matchType === "exact"
      ? lowerMessage === kwLower
      : lowerMessage.includes(kwLower);
    if (matched) {
      await sendTextMessage(kw.response, phoneNumber);
      setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
      return;
    }
  }

  // Campaign keyword triggers (delivery orgs — exact match, case-insensitive)
  const campaignTriggers = await getCampaignKeywordTriggers();
  const activeCampaignTriggers = campaignTriggers.filter(t => t.active !== false && t.keyword && t.flowId);
  for (const trigger of activeCampaignTriggers) {
    if (lowerMessage === trigger.keyword.toLowerCase().trim()) {
      await startFlow(phoneNumber, trigger.flowId);
      return;
    }
  }

  // Opt-out de campaña: respuesta "NO" (solo fuera de flujo activo)
  if (lowerMessage === 'no' && (!session.step || session.step === 'main_menu')) {
    const { getOrgId } = require('../config/orgConfig');
    const count = await registerCampaignOptOut(getOrgId(), phoneNumber);
    if (count > 0) {
      await sendTextMessage('De acuerdo, no te enviaremos más mensajes de este tipo. 👍', phoneNumber);
      return;
    }
  }

  // Custom keyword responses from message-type menu items (e.g. "pago", "precio", etc.)
  const menuConfig = await getMenuConfig();
  const messageItems = (menuConfig?.items || []).filter(
    i => i.type === "message" && i.active !== false && i.label && i.messageContent
  );
  for (const item of messageItems) {
    if (lowerMessage.includes(item.label.toLowerCase())) {
      await sendTextMessage(item.messageContent, phoneNumber);
      setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
      return;
    }
  }

  // General keywords
  if (lowerMessage.includes("hola") || lowerMessage.includes("hi")) {
    await sendGreeting(phoneNumber);
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
  } else if (lowerMessage.includes("menu") || lowerMessage.includes("menú")) {
    await sendMenu(phoneNumber);
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
  } else if (lowerMessage.includes("horario") || lowerMessage.includes("hora")) {
    await showSchedule(phoneNumber);
  } else if (lowerMessage.includes("contacto") || lowerMessage.includes("direccion") || lowerMessage.includes("telefono")) {
    await showContact(phoneNumber);
  } else if (lowerMessage.includes("info") || lowerMessage.includes("informacion")) {
    await showGeneralInfo(phoneNumber);
  } else if (lowerMessage.includes("registr") || lowerMessage.includes("inscrib")) {
    await startLegacyOrFlowRegistration(phoneNumber);
  } else if (lowerMessage.includes("cita") || lowerMessage.includes("reserv") || lowerMessage.includes("agendar")) {
    const scheduleCheck = await getScheduleInfo();
    const apptReady = scheduleCheck?.offersAppointments === true && scheduleCheck?.services?.length > 0;
    if (!apptReady) {
      await sendTextMessage("Las citas no están disponibles en este momento.", phoneNumber);
    } else {
      const flows = await getFlows();
      const apptFlow = flows.find(f => f.steps && f.steps.some(s => s.type === "appointment_slot"));
      if (apptFlow) {
        await startFlow(phoneNumber, apptFlow.id);
      } else {
        await sendTextMessage("Las citas no están disponibles.", phoneNumber);
      }
    }
  } else {
    // Fallback: show menu
    const fallbackText = menuConfig?.fallbackMessage ||
      await getMessage("fallback", "No estoy seguro de qué necesitas. Selecciona una opción:");

    const menuRows = await buildMenuItems(phoneNumber);
    if (menuRows.length > 0) {
      const sections = [{ title: "Opciones", rows: menuRows }];
      await sendInteractiveList(fallbackText, "Ver opciones", sections, phoneNumber);
    } else {
      await sendTextMessage(fallbackText, phoneNumber);
    }
  }
};

// ==================== MULTI-TENANT HANDLERS ====================

const { runWithOrgId } = require("../config/requestContext");
const { getWhatsAppConfig } = require("../services/botMessagesService");

const apiVerificationMulti = async (req, res) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return res.status(400).send("orgId requerido");

    const {
      'hub.mode': mode,
      'hub.verify_token': token,
      'hub.challenge': challenge
    } = req.query;

    if (!mode || !token || mode !== 'subscribe') {
      return res.status(403).send('Forbidden');
    }

    // Verificar contra token global del .env o token específico del org en Firebase
    const globalToken = process.env.VERIFY_META_TOKEN;
    if (globalToken && token === globalToken) {
      return res.status(200).send(challenge);
    }

    // Fallback: verificar contra verifyToken guardado en Firebase del org
    const waConfig = await runWithOrgId(orgId, () => getWhatsAppConfig());
    if (waConfig?.verifyToken && token === waConfig.verifyToken) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

const requestMessageMulti = async (req, res) => {
  const orgId = req.params.orgId;
  if (!orgId) return res.sendStatus(400);

  try {
    await runWithOrgId(orgId, async () => {
      const change = req.body?.entry?.[0]?.changes?.[0];
      const messageObj = change?.value?.messages?.[0];

      // Deduplicate
      const waMessageId = messageObj?.id;
      if (waMessageId) {
        const dedupKey = `${orgId}:${waMessageId}`;
        if (processedMessageIds.has(dedupKey)) {
          return res.sendStatus(200);
        }
        processedMessageIds.add(dedupKey);
      }

      if (change?.value?.statuses) {
        return res.sendStatus(200);
      }

      let phoneNumber = messageObj?.from ||
                       change?.value?.contacts?.[0]?.wa_id ||
                       change?.value?.metadata?.display_phone_number;

      // Validar que el phoneNumberId del payload coincide con el del org en Firebase
      const phoneId = change?.value?.metadata?.phone_number_id;
      if (phoneId) {
        const waConfig = await getWhatsAppConfig();
        if (waConfig?.phoneNumberId && phoneId !== waConfig.phoneNumberId) {
          return res.sendStatus(200);
        }
      }

      if (!phoneNumber || !messageObj) {
        return res.sendStatus(200);
      }

      const orgStatus = await getOrgStatus();
      if (orgStatus.active === false || orgStatus.botEnabled === false) {
        try {
          await _rawSendText(
            "Hola, gracias por escribirnos. En este momento no podemos atenderte a través de este canal. Por favor intenta más tarde o contáctanos por otro medio. Disculpa las molestias.",
            phoneNumber
          );
        } catch (e) { /* best effort */ }
        return res.sendStatus(200);
      }
      if (orgStatus.botBlocked === true) {
        try {
          await _rawSendText(
            "Hola, gracias por escribirnos. En este momento nuestro servicio de chat no está disponible. Por favor contáctanos por otro medio.",
            phoneNumber
          );
        } catch (e) { /* best effort */ }
        return res.sendStatus(200);
      }
      if (orgStatus.botPaused === true) {
        try {
          await _rawSendText(
            "Hola, gracias por escribirnos. Estamos realizando ajustes en nuestro servicio. Por favor intenta nuevamente en unos minutos.",
            phoneNumber
          );
        } catch (e) { /* best effort */ }
        return res.sendStatus(200);
      }

      const contactName = change?.value?.contacts?.[0]?.profile?.name || null;

      const interactiveResponse = messageObj?.interactive;
      if (interactiveResponse) {
        const buttonId = interactiveResponse?.button_reply?.id || interactiveResponse?.list_reply?.id;
        const buttonTitle = interactiveResponse?.button_reply?.title || interactiveResponse?.list_reply?.title || buttonId;
        if (buttonId && phoneNumber) {
          saveMessage(phoneNumber, buttonTitle, "user", { contactName }).catch(err =>
            console.error("Error saving interactive user message:", err.message)
          );
          const mode = await getConversationMode(phoneNumber);
          if (mode === "admin" && !buttonId.startsWith('campaign_order_')) return res.sendStatus(200);
          await handleInteractiveResponse(phoneNumber, buttonId);
          return res.sendStatus(200);
        }
      }

      const userMessage = messageObj?.text?.body?.trim() || "";

      if (!userMessage) {
        const msgType = messageObj?.type;
        const MEDIA_LABELS = {
          image:    { label: "📷 Foto",       save: true },
          audio:    { label: "🎵 Audio",       save: true },
          voice:    { label: "🎵 Nota de voz", save: true },
          video:    { label: "🎥 Video",       save: true },
          document: { label: "📄 Documento",   save: true },
          sticker:  { label: "🗒️ Sticker",     save: true },
          location: { label: "📍 Ubicación",   save: true },
          contacts: { label: "👤 Contacto",    save: true },
          reaction: { label: null,             save: false },
        };
        const mediaInfo = MEDIA_LABELS[msgType];
        if (!mediaInfo || !mediaInfo.label) return res.sendStatus(200);

        const mode = await getConversationMode(phoneNumber);
        if (mode === "admin") {
          if (msgType === "image") {
            const imageCaption = messageObj?.image?.caption || "";
            const mediaId = messageObj?.image?.id || "";
            const displayText = imageCaption ? `📷 ${imageCaption}` : "📷 Foto";
            (async () => {
              try {
                const { downloadAndUploadMedia } = require("../services/mediaService");
                const imageUrl = await downloadAndUploadMedia(mediaId, phoneNumber);
                await saveMessage(phoneNumber, displayText, "user", { contactName, type: "image", imageUrl });
              } catch (err) {
                saveMessage(phoneNumber, displayText, "user", { contactName, type: "image" })
                  .catch(e => console.error("Error saving image placeholder:", e.message));
              }
            })();
          } else if (msgType === "audio" || msgType === "voice") {
            (async () => {
              try {
                const orgConfig = await getGeneralConfig().catch(() => ({}));
                const maxSeconds = orgConfig?.deliveryAudioMaxSeconds || 30;
                const rejectOverLimit = orgConfig?.deliveryAudioEnabled === true;
                const msgData = messageObj?.[msgType] || {};
                const duration = msgData.duration ?? null;
                const mediaId = msgData.id || "";
                if (rejectOverLimit && duration !== null && duration > maxSeconds) {
                  await sendTextMessage(
                    `❌ Tu audio supera el límite de ${maxSeconds} segundos. Por favor envía uno más corto.`,
                    phoneNumber
                  );
                  return;
                }
                const { downloadAndUploadMedia } = require("../services/mediaService");
                const audioUrl = await downloadAndUploadMedia(mediaId, phoneNumber);
                await saveMessage(phoneNumber, mediaInfo.label, "user", {
                  contactName, type: "audio", audioUrl, duration,
                });
              } catch (err) {
                console.error("Error processing user audio (2):", err.message);
                saveMessage(phoneNumber, `🎵 Audio [ERR: ${err.message}]`, "user", { contactName, type: "audio" })
                  .catch(e => console.error("Error saving audio placeholder:", e.message));
              }
            })();
          } else if (msgType === "location") {
            const loc = messageObj?.location || {};
            const parts = [];
            if (loc.name) parts.push(loc.name);
            if (loc.address) parts.push(loc.address);
            const locText = parts.length > 0 ? parts.join(", ") : "📍 Ubicación";
            saveMessage(phoneNumber, locText, "user", {
              contactName,
              type: "location",
              locationData: { text: locText, lat: loc.latitude, lng: loc.longitude, ...(loc.name ? { name: loc.name } : {}), ...(loc.address ? { address: loc.address } : {}) }
            }).catch(err => console.error("Error saving location message:", err.message));
          } else {
            saveMessage(phoneNumber, mediaInfo.label, "user", { contactName })
              .catch(err => console.error("Error saving media message:", err.message));
          }
        } else {
          let currentSession = getSession(phoneNumber);
          if (!currentSession) currentSession = await getSessionAsync(phoneNumber);
          if (currentSession?.flowId && currentSession?.flowStepIndex !== undefined) {
            const flow = await getFlow(currentSession.flowId);
            const currentStep = flow?.steps?.[currentSession.flowStepIndex];

            // location_input: handle WhatsApp location message
            if (currentStep?.type === "location_input" && msgType === "location") {
              const loc = messageObj?.location || {};
              const fieldKey = currentStep.fieldKey || "direccion";
              const parts = [];
              if (loc.name) parts.push(loc.name);
              if (loc.address) parts.push(loc.address);
              const locationText = parts.length > 0 ? parts.join(", ") : `${loc.latitude}, ${loc.longitude}`;
              const locationValue = {
                text: locationText,
                lat: loc.latitude,
                lng: loc.longitude,
                ...(loc.name ? { name: loc.name } : {}),
                ...(loc.address ? { address: loc.address } : {})
              };
              const flowData = { ...currentSession.flowData, [fieldKey]: locationValue };
              const nextIndex = currentSession.flowStepIndex + 1;
              setSession(phoneNumber, { flowData, flowStepIndex: nextIndex, flowStartTime: Date.now() });
              saveMessage(phoneNumber, locationText, "user", {
                contactName, type: "location",
                locationData: locationValue
              }).catch(() => {});
              await executeFlowStep(phoneNumber, flow, nextIndex);
              return res.sendStatus(200);
            }

            // image_input: handle image/document
            if (currentStep?.type === "image_input" && (msgType === "image" || msgType === "document")) {
              const mediaId = messageObj?.[msgType]?.id;
              if (mediaId) {
                try {
                  const { downloadAndUploadMedia } = require("../services/mediaService");
                  const fileUrl = await downloadAndUploadMedia(mediaId, phoneNumber);
                  const fieldKey = currentStep.fieldKey || "archivoUrl";
                  const flowData = { ...currentSession.flowData, [fieldKey]: fileUrl };
                  const nextIndex = currentSession.flowStepIndex + 1;
                  setSession(phoneNumber, { flowData, flowStepIndex: nextIndex, flowStartTime: Date.now() });
                  await executeFlowStep(phoneNumber, flow, nextIndex);
                  return res.sendStatus(200);
                } catch (e) {
                  console.error("Error processing flow image:", e.message);
                }
              } else if (currentStep.optional) {
                const nextIndex = currentSession.flowStepIndex + 1;
                setSession(phoneNumber, { flowStepIndex: nextIndex, flowStartTime: Date.now() });
                await executeFlowStep(phoneNumber, flow, nextIndex);
                return res.sendStatus(200);
              }
            }
          }
          try {
            await sendTextMessage(
              "Lo sentimos, no podemos procesar archivos multimedia por este canal. Por favor describe tu consulta en texto. 📝",
              phoneNumber
            );
          } catch (e) { /* best effort */ }
        }
        return res.sendStatus(200);
      }

      saveMessage(phoneNumber, userMessage, "user", { contactName }).catch(err =>
        console.error("Error saving user message:", err.message)
      );

      const mode = await getConversationMode(phoneNumber);
      if (mode === "admin") return res.sendStatus(200);

      let session = getSession(phoneNumber);
      if (!session) session = await getSessionAsync(phoneNumber);
      if (!session) {
        setSession(phoneNumber, { step: "initial" });
        session = getSession(phoneNumber);
      }

      const config = await getGeneralConfig();
      const flowTimeout = config?.registrationTimeout || 180000;
      if (session.step && session.step.startsWith("flow_") && session.flowStartTime) {
        if (Date.now() - session.flowStartTime > flowTimeout) {
          const timeoutMsg = await getMessage("flow_timeout", "El tiempo del proceso expiró. Escribe *menu* para volver.");
          await sendTextMessage(timeoutMsg, phoneNumber);
          setSession(phoneNumber, { step: "main_menu" });
          return res.sendStatus(200);
        }
      }

      if (session.step === "initial" || !session.hasGreeted) {
        await sendGreeting(phoneNumber, contactName);
        setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
      } else {
        await handleUserMessage(phoneNumber, userMessage, session);
      }

      return res.sendStatus(200);
    });
  } catch (error) {
    console.error(`[multi-tenant:${orgId}] Error al procesar mensaje:`, error.message || error);
    return res.sendStatus(200);
  }
};

module.exports = {
  apiVerification,
  requestMessageFromWhatsapp,
  apiVerificationMulti,
  requestMessageMulti
};
