const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

const runWithOrgId = (orgId, fn) => storage.run({ orgId }, fn);
const getContextOrgId = () => storage.getStore()?.orgId || null;

module.exports = { runWithOrgId, getContextOrgId };
