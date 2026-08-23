/**
 * storage.ts - a thin, typed wrapper over the Azure DevOps Extension Data
 * Service.
 *
 * Why this layer exists:
 *  - the raw service throws on 404 instead of returning undefined
 *  - every write needs optimistic-concurrency retry (`__etag`)
 *  - document ids are capped at 50 characters, which is easy to overrun
 *  - the same code has to run against Azure DevOps Services and Server
 *
 * There is deliberately no external database. Everything lives in the
 * collection the extension is installed into, which is what makes an
 * air-gapped install possible.
 */

import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  IExtensionDataManager,
  IExtensionDataService,
} from "azure-devops-extension-api";

import { MAX_DOC_ID, StoredDoc } from "./model";

export type Scope = "collection" | "user";

const scopeOptions = (scope: Scope) =>
  scope === "user" ? { scopeType: "User", scopeValue: "Me" } : undefined;

/** Errors the data service raises for a missing document. */
function isNotFound(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string; serverError?: unknown };
  if (!e) return false;
  if (e.status === 404 || e.statusCode === 404) return true;
  return typeof e.message === "string" && /not found|does not exist|404/i.test(e.message);
}

/**
 * Only a genuine concurrency conflict is worth retrying.
 *
 * HTTP 400 used to be included here. It is not a conflict - the service
 * returns it for permanently bad requests such as an oversized document - so
 * treating it as one turned a single hard failure into six retries with
 * backoff, roughly twelve seconds of apparent hang.
 */
function isConflict(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string };
  if (!e) return false;
  if (e.status === 409 || e.statusCode === 409) return true;
  return typeof e.message === "string" && /etag|concurren|conflict|modified/i.test(e.message);
}

/**
 * No single data-service call may hang the UI. Without this, one stalled
 * request left the hub on "Loading..." indefinitely.
 */
const STORE_TIMEOUT_MS = 20_000;

function withStoreTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${STORE_TIMEOUT_MS}ms`)),
      STORE_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function assertDocId(id: string): string {
  if (id.length > MAX_DOC_ID) {
    throw new Error(
      `Document id "${id}" is ${id.length} characters; the data service allows ${MAX_DOC_ID}.`
    );
  }
  return id;
}

export class Store {
  private constructor(private readonly mgr: IExtensionDataManager) {}

  static async create(): Promise<Store> {
    const [service, token] = await Promise.all([
      SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService),
      SDK.getAccessToken(),
    ]);
    const mgr = await service.getExtensionDataManager(SDK.getExtensionContext().id, token);
    return new Store(mgr);
  }

  /* -------------------------------------------------------------- */
  /* documents                                                      */
  /* -------------------------------------------------------------- */

  async get<T extends StoredDoc>(
    collection: string,
    id: string,
    scope: Scope = "collection"
  ): Promise<T | undefined> {
    try {
      return (await withStoreTimeout(this.mgr.getDocument(collection, assertDocId(id), scopeOptions(scope)), `Reading ${collection}/${id}`)) as T;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async list<T extends StoredDoc>(
    collection: string,
    scope: Scope = "collection"
  ): Promise<T[]> {
    try {
      return (await withStoreTimeout(
        this.mgr.getDocuments(collection, scopeOptions(scope)),
        `Listing ${collection}`
      )) as T[];
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  /** Create or replace. Uses `__etag: -1` semantics when none is supplied. */
  async put<T extends StoredDoc>(
    collection: string,
    doc: T,
    scope: Scope = "collection"
  ): Promise<T> {
    assertDocId(doc.id);
    return (await withStoreTimeout(
      this.mgr.setDocument(collection, doc, scopeOptions(scope)),
      `Writing ${collection}/${doc.id}`
    )) as T;
  }

  async remove(collection: string, id: string, scope: Scope = "collection"): Promise<void> {
    try {
      await this.mgr.deleteDocument(collection, assertDocId(id), scopeOptions(scope));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  /**
   * Read-modify-write with optimistic concurrency.
   *
   * `mutate` receives the current document (or undefined) and returns the
   * document to store, or `null` to abort. On an etag conflict the whole
   * cycle is retried against freshly read state - which is exactly what a
   * concurrent message append needs.
   */
  async mutate<T extends StoredDoc>(
    collection: string,
    id: string,
    mutate: (current: T | undefined) => T | null | Promise<T | null>,
    scope: Scope = "collection",
    attempts = 6
  ): Promise<T | undefined> {
    assertDocId(id);
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const current = await this.get<T>(collection, id, scope);
      const next = await mutate(current);
      if (next === null) return current;
      next.id = id;
      if (current && current.__etag !== undefined) next.__etag = current.__etag;
      try {
        return (await withStoreTimeout(
          this.mgr.setDocument(collection, next, scopeOptions(scope)),
          `Writing ${collection}/${id}`
        )) as T;
      } catch (err) {
        lastError = err;
        if (!isConflict(err)) throw err;
        // Exponential backoff with jitter keeps a busy channel from live-locking.
        const delay = Math.min(2000, 60 * 2 ** attempt) + Math.random() * 60;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error(
      `Could not write ${collection}/${id} after ${attempts} attempts: ${String(lastError)}`
    );
  }

  /* -------------------------------------------------------------- */
  /* simple settings                                                */
  /* -------------------------------------------------------------- */

  async getValue<T>(key: string, scope: Scope = "user"): Promise<T | undefined> {
    try {
      return await this.mgr.getValue<T>(key, scopeOptions(scope));
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  setValue<T>(key: string, value: T, scope: Scope = "user"): Promise<T> {
    return this.mgr.setValue<T>(key, value, scopeOptions(scope));
  }
}

/** Process-wide singleton. The data manager is cheap but the token is not. */
let storePromise: Promise<Store> | undefined;
export function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.create();
  return storePromise;
}

/**
 * Drop the singleton so a test harness can simulate a second user in the
 * same process. Not used by the extension itself.
 */
export function __resetStoreForTests(): void {
  storePromise = undefined;
}
