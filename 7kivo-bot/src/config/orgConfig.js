require("dotenv").config();

const getOrgId = () => {
  const orgId = process.env.ORG_ID || process.env.SCHOOL_ID;
  if (!orgId) {
    throw new Error("ORG_ID no está configurado en las variables de entorno");
  }
  return orgId;
};

module.exports = { getOrgId };
