require("dotenv").config();

/**
 * Obtiene el ID de la escuela desde las variables de entorno
 * @returns {string} El ID de la escuela
 */
const getSchoolId = () => {
  const schoolId = process.env.SCHOOL_ID;
  if (!schoolId) {
    throw new Error("SCHOOL_ID no está configurado en las variables de entorno");
  }
  return schoolId;
};

module.exports = {
  getSchoolId
};

