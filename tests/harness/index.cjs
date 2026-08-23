/**
 * An in-process emulator of the Azure DevOps extension environment.
 *
 * Everything the extension talks to is stubbed here: the SDK handshake, the
 * Extension Data Service, the Core REST client, and IndexedDB. That makes it
 * possible to run the REAL `src/core` code - crypto, storage, conversations,
 * messages, files - against two or more simulated users in one Node process.
 *
 * Why this exists: typecheck plus unit tests on pure functions repeatedly
 * failed to catch integration bugs (stale key caches, names resolving to raw
 * ids, delete-and-recreate corruption). Those only appear when two clients
 * share one document store, which is exactly what this reproduces.
 *
 * Module interception is done through `Module._resolveFilename` because the
 * compiled core is CommonJS and imports the SDK by bare specifier.
 */

const path = require("node:path");
const Module = require("node:module");

const HERE = __dirname;
const STUBS = {
  "azure-devops-extension-sdk": path.join(HERE, "stub-sdk.cjs"),
  "azure-devops-extension-api": path.join(HERE, "stub-api.cjs"),
  "azure-devops-extension-api/Core": path.join(HERE, "stub-api-core.cjs"),
  "azure-devops-extension-api/Git": path.join(HERE, "stub-api-git.cjs"),
  "azure-devops-extension-api/Identities": path.join(HERE, "stub-api-identities.cjs"),
  "azure-devops-extension-api/WorkItemTracking": path.join(HERE, "stub-api-wit.cjs"),
};

let installed = false;
function installModuleInterception() {
  if (installed) return;
  installed = true;
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (STUBS[request]) return STUBS[request];
    return original.call(this, request, ...rest);
  };
}

/* ------------------------------------------------------------------ */
/* shared mutable state the stubs read                                 */
/* ------------------------------------------------------------------ */

const state = {
  /** collectionKey -> collectionName -> docId -> doc */
  documents: new Map(),
  /** user id -> { id, name } */
  currentUser: { id: "user-a", displayName: "Alice Example" },
  /** what the Core client reports */
  teams: [{ id: "team-1", projectId: "proj-1", name: "Team One" }],
  teamMembers: new Map(), // teamId -> [{identity:{id,displayName,isContainer}}]
  projects: [{ id: "proj-1", name: "Project One" }],
  /** per-device IndexedDB contents: deviceId -> Map */
  devices: new Map(),
  currentDevice: "device-a",
  /** counts every data-service call, so tests can assert on chattiness */
  calls: { get: 0, list: 0, set: 0, delete: 0 },
  /** artificial latency per data-service call, milliseconds */
  latencyMs: 0,
  /** when set, every setDocument rejects with this status */
  failWritesWithStatus: 0,
  /** simulate an SDK user context with no display name */
  sdkUserHasNoName: false,
};

module.exports.state = state;

/* ------------------------------------------------------------------ */
/* document store                                                      */
/* ------------------------------------------------------------------ */

const scopeKey = (options) =>
  options && options.scopeType === "User" ? `user:${state.currentUser.id}` : "default";

function bucket(scope, collection) {
  if (!state.documents.has(scope)) state.documents.set(scope, new Map());
  const scoped = state.documents.get(scope);
  if (!scoped.has(collection)) scoped.set(collection, new Map());
  return scoped.get(collection);
}

function notFound(what) {
  const err = new Error(`${what} not found`);
  err.status = 404;
  return err;
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const delay = () =>
  state.latencyMs > 0
    ? new Promise((resolve) => setTimeout(resolve, state.latencyMs))
    : Promise.resolve();

const dataManager = {
  async getDocument(collection, id, options) {
    state.calls.get++;
    await delay();
    const doc = bucket(scopeKey(options), collection).get(id);
    if (!doc) throw notFound(`${collection}/${id}`);
    return clone(doc);
  },
  async getDocuments(collection, options) {
    state.calls.list++;
    await delay();
    return [...bucket(scopeKey(options), collection).values()].map(clone);
  },
  async setDocument(collection, doc, options) {
    state.calls.set++;
    await delay();
    if (state.failWritesWithStatus) {
      const err = new Error(`stubbed failure ${state.failWritesWithStatus}`);
      err.status = state.failWritesWithStatus;
      throw err;
    }
    const store = bucket(scopeKey(options), collection);
    const existing = store.get(doc.id);
    // Optimistic concurrency, matching the real service: -1 means last write
    // wins, anything else must match the stored etag.
    if (existing && doc.__etag !== undefined && doc.__etag !== -1) {
      if (doc.__etag !== existing.__etag) {
        const err = new Error("etag mismatch");
        err.status = 409;
        throw err;
      }
    }
    const stored = clone(doc);
    stored.__etag = (existing?.__etag ?? 0) + 1;
    store.set(doc.id, stored);
    return clone(stored);
  },
  async deleteDocument(collection, id, options) {
    state.calls.delete++;
    const store = bucket(scopeKey(options), collection);
    if (!store.has(id)) throw notFound(`${collection}/${id}`);
    store.delete(id);
  },
  async getValue(key, options) {
    const doc = bucket(scopeKey(options), "$settings").get(key);
    if (!doc) throw notFound(key);
    return clone(doc.value);
  },
  async setValue(key, value, options) {
    bucket(scopeKey(options), "$settings").set(key, { id: key, value: clone(value) });
    return value;
  },
};

module.exports.dataManager = dataManager;

/* ------------------------------------------------------------------ */
/* browser globals                                                     */
/* ------------------------------------------------------------------ */

function deviceStore() {
  if (!state.devices.has(state.currentDevice)) state.devices.set(state.currentDevice, new Map());
  return state.devices.get(state.currentDevice);
}

/** Minimal IndexedDB: one database, one object store, per simulated device. */
function installIndexedDb() {
  const request = (execute) => {
    const req = {};
    queueMicrotask(() => {
      try {
        req.result = execute();
        req.onsuccess?.();
      } catch (err) {
        req.error = err;
        req.onerror?.();
      }
    });
    return req;
  };

  globalThis.indexedDB = {
    open() {
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => undefined,
        transaction() {
          const tx = {
            objectStore: () => ({
              get: (key) => request(() => deviceStore().get(key)),
              put: (value, key) => request(() => deviceStore().set(key, value)),
              delete: (key) => request(() => deviceStore().delete(key)),
            }),
          };
          queueMicrotask(() => tx.oncomplete?.());
          return tx;
        },
      };
      return request(() => db);
    },
  };
}

function installDom() {
  if (!globalThis.window) globalThis.window = globalThis;
  globalThis.window.location = { origin: "http://devops.local", pathname: "/" };
  if (!globalThis.document) {
    globalThis.document = {
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
    };
  }
  globalThis.isSecureContext = true;
}

/* ------------------------------------------------------------------ */
/* world                                                               */
/* ------------------------------------------------------------------ */

/**
 * Prepare the environment and load the compiled core. Call once per test
 * file, before touching any extension module.
 */
function bootWorld() {
  installModuleInterception();
  installIndexedDb();
  installDom();

  const core = {
    client: require("../build/client.js"),
    crypto: require("../build/crypto.js"),
    model: require("../build/model.js"),
    devops: require("../build/devops.js"),
    storage: require("../build/storage.js"),
  };
  return core;
}

/**
 * Run `fn` as a particular user on a particular device.
 *
 * The extension keeps process-wide singletons (the data manager, the
 * directory cache). Those are reset between switches so each client starts
 * from a clean in-memory state while SHARING the document store, which is
 * what makes two-user scenarios realistic.
 */
async function asUser(core, user, device, fn) {
  const previousUser = state.currentUser;
  const previousDevice = state.currentDevice;
  state.currentUser = user;
  state.currentDevice = device;

  core.storage.__resetStoreForTests?.();
  core.devops.__resetDirectoryForTests?.();

  try {
    const client = await core.client.ChatClient.create();
    await client.init();
    const result = await fn(client);
    // Background startup keeps running after init returns. In the product
    // that is the point; here it would leak into the next simulated user, so
    // drain it before switching identities.
    await client.whenWarm();
    return result;
  } finally {
    state.currentUser = previousUser;
    state.currentDevice = previousDevice;
  }
}

module.exports.bootWorld = bootWorld;
module.exports.asUser = asUser;

/** Register a team member so the directory stub reports them. */
module.exports.addTeamMember = function addTeamMember(teamId, id, displayName) {
  if (!state.teamMembers.has(teamId)) state.teamMembers.set(teamId, []);
  state.teamMembers.get(teamId).push({ identity: { id, displayName, isContainer: false } });
};

module.exports.resetWorld = function resetWorld() {
  state.documents = new Map();
  state.devices = new Map();
  state.teamMembers = new Map();
  state.calls = { get: 0, list: 0, set: 0, delete: 0 };
  state.latencyMs = 0;
  state.failWritesWithStatus = 0;
  state.sdkUserHasNoName = false;
};
