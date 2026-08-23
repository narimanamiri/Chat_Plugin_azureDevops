/** Stub of azure-devops-extension-sdk. */
const { state, dataManager } = require("./index.cjs");

const SERVICES = {
  "ms.vss-features.extension-data-service": {
    getExtensionDataManager: async () => dataManager,
  },
  "ms.vss-tfs-web.tfs-page-data-service": {
    getProject: async () => ({ id: "proj-1", name: "Project One" }),
  },
  "ms.vss-features.host-navigation-service": { navigate() {} },
  "ms.vss-features.identity-service": {
    searchIdentitiesAsync: async (query) =>
      (state.identitySearchResults ?? []).filter((entry) =>
        (entry.displayName ?? "").toLowerCase().includes(String(query).toLowerCase())
      ),
  },
};

module.exports = {
  init: async () => undefined,
  ready: async () => undefined,
  notifyLoadSucceeded: () => undefined,
  register: () => undefined,
  getUser: () => {
    // Some Azure DevOps Server frames hand back a user context with no
    // display name at all. `state.sdkUserHasNoName` reproduces that.
    if (state.sdkUserHasNoName) return { id: state.currentUser.id };
    return {
      id: state.currentUser.id,
      displayName: state.currentUser.displayName,
      name: state.currentUser.displayName,
    };
  },
  getHost: () => ({ id: "host", name: "collection" }),
  getExtensionContext: () => ({ id: "pub.azdo-secure-chat" }),
  getAccessToken: async () => "token",
  getService: async (id) => {
    const service = SERVICES[id];
    if (!service) throw new Error(`no stub for service ${id}`);
    return service;
  },
};
