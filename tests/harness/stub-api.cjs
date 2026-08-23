const { CoreRestClient } = require("./stub-api-core.cjs");
const { GitRestClient } = require("./stub-api-git.cjs");
const { WorkItemTrackingRestClient } = require("./stub-api-wit.cjs");

const instances = new Map();
module.exports = {
  CommonServiceIds: {
    ExtensionDataService: "ms.vss-features.extension-data-service",
    ProjectPageService: "ms.vss-tfs-web.tfs-page-data-service",
    HostNavigationService: "ms.vss-features.host-navigation-service",
  },
  getClient(ctor) {
    if (!instances.has(ctor)) instances.set(ctor, new ctor());
    return instances.get(ctor);
  },
  CoreRestClient,
  GitRestClient,
  WorkItemTrackingRestClient,
};
