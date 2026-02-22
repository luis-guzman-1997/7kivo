const { getSession, getSessionAsync, setSession, clearSession } = require("../config/sessionData");
const { sendTextMessage: _rawSendText, sendInteractiveButtons, sendInteractiveList } = require("../models/messageModel");
const {
  getMessage,
  getContactInfo,
  getScheduleInfo,
  getGeneralInfo,
  getGeneralConfig,
  getFlows,
  getFlow,
  getMenuConfig,
  getCollectionItems,
  getCollectionItem,
  getCollectionDef,
  saveFlowSubmission
} = require("../services/botMessagesService");
const { saveMessage, getConversationMode } = require("../services/conversationService");

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
        if (mode === "admin") {
          return res.sendStatus(200);
        }

        await handleInteractiveResponse(phoneNumber, buttonId);
        return res.sendStatus(200);
      }
    }

    const userMessage = messageObj?.text?.body?.trim() || "";

    if (userMessage) {
      saveMessage(phoneNumber, userMessage, "user", { contactName }).catch(err =>
        console.error("Error saving user message:", err.message)
      );
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
    return res.sendStatus(500);
  }
};

// ==================== DYNAMIC MENU ====================

const buildMenuItems = async () => {
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
        if (flow && flow.active !== false) {
          rows.push({
            id: `flow_${flow.id}`,
            title: (item.label || flow.menuLabel || flow.name).substring(0, 24),
            description: (item.description || flow.menuDescription || "").substring(0, 72)
          });
        }
      }
    }
    rows.push({ id: "exit_chat", title: "Salir", description: "Finalizar conversación" });
    return rows;
  }

  // Fallback: auto-generate from builtins + active flows
  const rows = [
    { id: "builtin_schedule", title: "Horarios", description: "Horarios de atención" },
    { id: "builtin_contact", title: "Ubicación", description: "Dirección" },
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

  const menuRows = await buildMenuItems();

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

  const menuRows = await buildMenuItems();

  if (menuRows.length === 0) {
    await sendTextMessage("No hay opciones disponibles.", phoneNumber);
    return;
  }

  const sections = [{ title: "Opciones", rows: menuRows }];
  await sendInteractiveList("¿En qué más puedo ayudarte?", menuButtonText, sections, phoneNumber);
};

// ==================== INTERACTIVE RESPONSE HANDLER ====================

const handleInteractiveResponse = async (phoneNumber, buttonId) => {
  const session = getSession(phoneNumber);

  // Handle flow select step responses
  if (session && session.step === "flow_select") {
    await handleFlowSelectResponse(phoneNumber, buttonId, session);
    return;
  }

  // Handle browse_collection selection
  if (session && session.step === "flow_browse") {
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

  // Exit chat
  if (buttonId === "exit_chat") {
    await sendTextMessage("¡Hasta luego! Escribe cuando necesites ayuda.", phoneNumber);
    clearSession(phoneNumber);
    return;
  }

  // Builtin actions (schedule, contact, general - programs removed)
  if (buttonId.startsWith("builtin_")) {
    const action = buttonId.substring(8);
    const builtinActions = {
      schedule: () => showSchedule(phoneNumber),
      contact: () => showContact(phoneNumber),
      general: () => showGeneralInfo(phoneNumber)
    };

    if (builtinActions[action]) {
      await builtinActions[action]();
      return;
    }
  }

  // Flow actions
  if (buttonId.startsWith("flow_")) {
    const flowId = buttonId.substring(5);
    await startFlow(phoneNumber, flowId);
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

  const fallbackMsg = await getMessage("option_not_recognized", "Opción no reconocida. Selecciona una opción del menú.");
  await sendTextMessage(fallbackMsg, phoneNumber);
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
  const flow = await getFlow(flowId);
  if (!flow || !flow.steps || flow.steps.length === 0) {
    await sendTextMessage("Este servicio no está disponible actualmente.", phoneNumber);
    return;
  }

  const cancelHint = await getMessage("flow_cancel_hint", "Puedes escribir *cancelar* o *salir* en cualquier momento para detener el proceso.\n");
  await sendTextMessage(cancelHint, phoneNumber);

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

  switch (step.type) {
    case "text_input":
      await sendTextMessage(step.prompt, phoneNumber);
      setSession(phoneNumber, {
        step: "flow_text",
        flowId: flow.id,
        flowStepIndex: stepIndex,
        flowStartTime: Date.now()
      });
      break;

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

    case "browse_collection":
      await sendBrowseCollection(phoneNumber, flow, step, stepIndex);
      break;

    case "message":
      await sendTextMessage(step.prompt, phoneNumber);
      setSession(phoneNumber, {
        flowStepIndex: stepIndex + 1,
        flowStartTime: Date.now()
      });
      await executeFlowStep(phoneNumber, flow, stepIndex + 1);
      break;

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

const sendSelectList = async (phoneNumber, flow, step, stepIndex) => {
  let rows = [];

  if (step.optionsSource && step.optionsSource !== "custom") {
    const [items, colDef] = await Promise.all([
      getCollectionItems(step.optionsSource),
      getCollectionDef(step.optionsSource)
    ]);
    rows = items.map(item => ({
      id: `fsel_${item.id}`,
      title: getItemDisplayName(item, step, colDef).substring(0, 24),
      description: getItemDescription(item, step).substring(0, 72)
    }));
  } else if (step.customOptions && step.customOptions.length > 0) {
    rows = step.customOptions.map(opt => ({
      id: `fsel_${opt.value}`,
      title: (opt.label || opt.value).substring(0, 24),
      description: (opt.description || "").substring(0, 72)
    }));
  }

  if (rows.length === 0) {
    await sendTextMessage("No hay opciones disponibles.", phoneNumber);
    setSession(phoneNumber, { step: "main_menu" });
    return;
  }

  const sections = [{ title: step.fieldLabel || "Opciones", rows }];
  const buttonText = step.buttonText || "Ver opciones";

  setSession(phoneNumber, {
    step: "flow_select",
    flowId: flow.id,
    flowStepIndex: stepIndex,
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
    if (found) displayName = found.label || selectedValue;
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

const sendBrowseCollection = async (phoneNumber, flow, step, stepIndex) => {
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
  const rows = items.map(item => ({
    id: `brw_${item.id}`,
    title: (item[displayField] || item.name || item.id).substring(0, 24),
    description: ""
  }));

  const prompt = step.prompt || "Selecciona un elemento:";
  const sections = [{ title: "Opciones", rows }];

  setSession(phoneNumber, {
    step: "flow_browse",
    flowId: flow.id,
    flowStepIndex: stepIndex,
    browseCollection: collectionSlug,
    browseDetailFields: step.detailFields || [],
    browseDisplayField: displayField,
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

  // Save to collection if configured
  if (flow.saveToCollection) {
    try {
      const submissionData = {
        ...flowData,
        phoneNumber,
        flowId: flow.id,
        flowName: flow.name
      };
      await saveFlowSubmission(flow.saveToCollection, submissionData);
    } catch (error) {
      console.error("Error saving flow submission:", error);
    }
  }

  // Build completion message with template variables
  let completionMsg = flow.completionMessage || "Proceso completado. ¡Gracias!";
  completionMsg = completionMsg.replace("{phoneNumber}", phoneNumber);

  for (const [key, value] of Object.entries(flowData)) {
    const regex = new RegExp(`\\{${key}\\}`, "g");
    const displayValue = typeof value === "string" ? value.toUpperCase() : String(value);
    completionMsg = completionMsg.replace(regex, displayValue);
  }

  clearSession(phoneNumber);
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
    info = "*Ubicación*\n\n";
    info += `*Dirección:*\n${contact.address}\n\n`;
    if (contact.city) info += `*Ciudad:* ${contact.city}`;
    if (contact.country) info += `, ${contact.country}`;
    if (contact.city || contact.country) info += "\n";
  } else {
    info = await getMessage("contact_info", "Información de ubicación no disponible.");
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
  if (general) {
    info = "*Información General*\n\n";
    info += `*${general.orgName || general.schoolName || ""}*\n${general.description}\n\n`;
    if (general.focus && general.focus.length > 0) {
      info += "*Enfoque:*\n";
      general.focus.forEach(f => { info += `• ${f}\n`; });
    }
    info += `\n*Modalidad:* ${general.modality}\n\n`;
    info += `*Instrumentos:*\n${general.instrumentsNote}\n\n`;
    if (general.openToAll) {
      info += "Abierto a todos sin discriminación.";
    }
  } else {
    info = await getMessage("general_info", "Información no disponible.");
  }

  const buttons = [
    { id: "builtin_schedule", title: "Ver Horarios" },
    { id: "back_main", title: "Menú Principal" }
  ];

  await sendInteractiveButtons(info, buttons, phoneNumber);
};

// ==================== TEXT MESSAGE HANDLER ====================

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

  // Handle active flow text/number input
  if (session.step === "flow_text") {
    await handleFlowTextInput(phoneNumber, message, session);
    return;
  }

  if (session.step === "flow_number") {
    await handleFlowNumberInput(phoneNumber, message, session);
    return;
  }

  // Waiting for select/browse but user typed text
  if (session.step === "flow_select" || session.step === "flow_browse" || session.step === "flow_browse_detail") {
    await sendTextMessage("Por favor selecciona una opción del menú.", phoneNumber);
    return;
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
  } else {
    // Fallback: show menu
    const menuConfig = await getMenuConfig();
    const fallbackText = menuConfig?.fallbackMessage ||
      await getMessage("fallback", "No estoy seguro de qué necesitas. Selecciona una opción:");

    const menuRows = await buildMenuItems();
    if (menuRows.length > 0) {
      const sections = [{ title: "Opciones", rows: menuRows }];
      await sendInteractiveList(fallbackText, "Ver opciones", sections, phoneNumber);
    } else {
      await sendTextMessage(fallbackText, phoneNumber);
    }
  }
};

module.exports = {
  apiVerification,
  requestMessageFromWhatsapp
};
