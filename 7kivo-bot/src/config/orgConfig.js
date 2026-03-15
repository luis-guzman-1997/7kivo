require("dotenv").config();
const { getContextOrgId } = require("./requestContext");

const getOrgId = () => {
  // Multi-tenant: orgId viene del contexto de la request (AsyncLocalStorage)
  const contextOrgId = getContextOrgId();
  if (contextOrgId) return contextOrgId;

  // Single-tenant: orgId viene del .env (clientes existentes)
  const orgId = process.env.ORG_ID || process.env.SCHOOL_ID;
  if (!orgId) {
    throw new Error("ORG_ID no está configurado en las variables de entorno");
  }
  return orgId;
};

module.exports = { getOrgId };
