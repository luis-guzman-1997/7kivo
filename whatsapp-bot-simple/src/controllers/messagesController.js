const { getSession, getSessionAsync, setSession, clearSession } = require("../config/sessionData");
const { sendTextMessage: _rawSendText, sendInteractiveButtons, sendInteractiveList } = require("../models/messageModel");
const {
  getMessage,
  getContactInfo,
  getScheduleInfo,
  getGeneralInfo,
  getProgramInfo,
  getAllPrograms,
  getGeneralConfig,
  getFlows,
  getFlow,
  getMenuConfig,
  getCollectionItems,
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

  // Fallback: auto-generate from builtin + active flows
  const rows = [
    { id: "builtin_programs", title: "Programas", description: "Ver programas disponibles" },
    { id: "builtin_schedule", title: "Horarios", description: "Ver horarios de clases" },
    { id: "builtin_contact", title: "Ubicación", description: "Dirección del instituto" },
    { id: "builtin_general", title: "Información General", description: "Sobre el instituto" }
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
  const name = contactName ? ` ${contactName}` : "";

  const greetingTemplate = menuConfig?.greeting ||
    await getMessage("greeting", "¡Hola{name}!\n\nBienvenido al *Instituto CanZion Sonsonate*.\n\nSelecciona una opción:");
  const greeting = greetingTemplate.replace("{name}", name);

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

// ==================== INTERACTIVE RESPONSE HANDLER ====================

const handleInteractiveResponse = async (phoneNumber, buttonId) => {
  const session = getSession(phoneNumber);

  // Handle flow select step responses
  if (session && session.step === "flow_select") {
    await handleFlowSelectResponse(phoneNumber, buttonId, session);
    return;
  }

  // Exit chat
  if (buttonId === "exit_chat") {
    await sendTextMessage("¡Hasta luego! 👋 Escribe cuando necesites ayuda.", phoneNumber);
    clearSession(phoneNumber);
    return;
  }

  // Builtin actions
  if (buttonId.startsWith("builtin_")) {
    const action = buttonId.substring(8);
    const builtinActions = {
      programs: () => showProgramsMenu(phoneNumber),
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

  // Program detail
  if (buttonId.startsWith("prog_")) {
    const programId = buttonId.substring(5);
    await showProgramDetail(phoneNumber, programId);
    return;
  }

  // Back to menu
  if (buttonId === "back_main") {
    await sendGreeting(phoneNumber);
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
    return;
  }

  // Legacy: direct action names (backward compat)
  const legacyActions = {
    programs: () => showProgramsMenu(phoneNumber),
    schedule: () => showSchedule(phoneNumber),
    contact: () => showContact(phoneNumber),
    register: () => startLegacyOrFlowRegistration(phoneNumber),
    general: () => showGeneralInfo(phoneNumber),
    back_main: () => sendGreeting(phoneNumber)
  };

  if (legacyActions[buttonId]) {
    await legacyActions[buttonId]();
    return;
  }

  // Legacy program ID
  const program = await getProgramInfo(buttonId);
  if (program) {
    await showProgramDetail(phoneNumber, buttonId);
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

    case "message":
      await sendTextMessage(step.prompt, phoneNumber);
      // Auto-advance to next step
      const session = getSession(phoneNumber);
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

const sendSelectList = async (phoneNumber, flow, step, stepIndex) => {
  let rows = [];

  if (step.optionsSource && step.optionsSource !== "custom") {
    const items = await getCollectionItems(step.optionsSource);
    rows = items.map(item => ({
      id: `fsel_${item.id}`,
      title: (item.name || item.label || item.id).substring(0, 24),
      description: (item.description || item.age || "").substring(0, 72)
    }));
  } else if (step.customOptions && step.customOptions.length > 0) {
    rows = step.customOptions.map(opt => ({
      id: `fsel_${opt.value}`,
      title: (opt.label || opt.value).substring(0, 24),
      description: ""
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
    const items = await getCollectionItems(step.optionsSource);
    buttons = items.slice(0, 3).map(item => ({
      id: `fsel_${item.id}`,
      title: (item.name || item.label || item.id).substring(0, 20)
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

  // Resolve the display name
  let displayName = selectedValue;
  if (step.optionsSource && step.optionsSource !== "custom") {
    const items = await getCollectionItems(step.optionsSource);
    const found = items.find(i => i.id === selectedValue);
    if (found) displayName = found.name || found.label || selectedValue;
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

const showProgramsMenu = async (phoneNumber) => {
  const text = await getMessage("programs_menu", "*Programas Disponibles*\n\nSelecciona un programa:");
  const programs = await getAllPrograms();

  if (programs.length === 0) {
    await sendTextMessage("No hay programas disponibles actualmente.", phoneNumber);
    return;
  }

  const programRows = programs.map(p => ({
    id: `prog_${p.id}`,
    title: (p.name || "Programa").substring(0, 24),
    description: (p.age || "").substring(0, 72)
  }));

  const sections = [
    { title: "Programas", rows: programRows },
    { title: "Navegación", rows: [{ id: "back_main", title: "Menú Principal", description: "Volver" }] }
  ];

  await sendInteractiveList(text, "Ver programas", sections, phoneNumber);
};

const showProgramDetail = async (phoneNumber, programId) => {
  const program = await getProgramInfo(programId);

  let info;
  if (program) {
    info = `*${program.name}*\n\n`;
    info += `*Edad:* ${program.age}\n`;
    if (program.ageNote) info += `(${program.ageNote})\n`;
    info += `\n*Duración:* ${program.duration}\n\n`;
    if (program.includes && program.includes.length > 0) {
      info += "*Incluye:*\n";
      program.includes.forEach(item => { info += `• ${item}\n`; });
    }
    if (program.note) info += `\n*Nota:* ${program.note}`;
    if (program.focus) info += `\n*Enfoque:* ${program.focus}`;
  } else {
    info = "Información no disponible.";
  }

  const buttons = [
    { id: "builtin_programs", title: "Ver Otros Programas" },
    { id: "back_main", title: "Menú Principal" }
  ];

  await sendInteractiveButtons(info, buttons, phoneNumber);
};

const showSchedule = async (phoneNumber) => {
  const schedule = await getScheduleInfo();

  let info;
  if (schedule) {
    info = "*Horarios*\n\n";
    info += `*Día:* ${schedule.day}\n\n`;
    info += `*Horario:* ${schedule.time}\n\n`;
    if (schedule.appliesTo && schedule.appliesTo.length > 0) {
      info += "*Aplica para todos los programas:*\n";
      schedule.appliesTo.forEach(p => { info += `• ${p}\n`; });
    }
    info += `\n*Modalidad:* ${schedule.modality}`;
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
    if (contact.city || contact.country) info += "\n\n";
    if (contact.attentionHours) info += `*Horarios de atención:*\n${contact.attentionHours}`;
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
    info += `*${general.schoolName}*\n${general.description}\n\n`;
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
    { id: "builtin_programs", title: "Ver Programas" },
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

  // Waiting for select but user typed text
  if (session.step === "flow_select") {
    await sendTextMessage("Por favor selecciona una opción del menú.", phoneNumber);
    return;
  }

  // General keywords
  if (lowerMessage.includes("hola") || lowerMessage.includes("hi") || lowerMessage.includes("menu") || lowerMessage.includes("menú")) {
    await sendGreeting(phoneNumber);
    setSession(phoneNumber, { step: "main_menu", hasGreeted: true });
  } else if (lowerMessage.includes("programa") || lowerMessage.includes("curso")) {
    await showProgramsMenu(phoneNumber);
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
