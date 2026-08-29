/* IndexedDB utility with a localStorage-like async API and flexible CRUD stores. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IDBStorage = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_DB_NAME = 'laan-social';
  const DEFAULT_STORE_NAME = 'keyval';
  const DEFAULT_VERSION = 1;

  function getIndexedDB() {
    return typeof indexedDB !== 'undefined' ? indexedDB : null;
  }

  function isSupported() {
    return Boolean(getIndexedDB());
  }

  function toRequestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }

  function normalizeStoreDefinition(store, defaultStoreName) {
    if (typeof store === 'string') {
      return {
        name: store,
        options: { keyPath: store === defaultStoreName ? 'key' : 'id' },
        indexes: []
      };
    }

    const options = {};
    if (Object.prototype.hasOwnProperty.call(store, 'keyPath')) options.keyPath = store.keyPath;
    if (Object.prototype.hasOwnProperty.call(store, 'autoIncrement')) options.autoIncrement = store.autoIncrement;

    return {
      name: store.name,
      options,
      indexes: Array.isArray(store.indexes) ? store.indexes : []
    };
  }

  function normalizeIndexDefinition(index) {
    if (typeof index === 'string') {
      return { name: index, keyPath: index, options: {} };
    }

    return {
      name: index.name,
      keyPath: index.keyPath || index.name,
      options: index.options || {}
    };
  }

  function normalizeStores(stores, defaultStoreName) {
    const list = Array.isArray(stores) && stores.length ? stores.slice() : [];

    if (!list.some((store) => (typeof store === 'string' ? store : store.name) === defaultStoreName)) {
      list.unshift({ name: defaultStoreName, keyPath: 'key' });
    }

    return list.map((store) => normalizeStoreDefinition(store, defaultStoreName));
  }

  function createAbortableTransaction(db, storeName, mode) {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    });

    return { tx, store, done };
  }

  class IndexedDBStorage {
    constructor(options) {
      const config = options || {};

      this.dbName = config.dbName || DEFAULT_DB_NAME;
      this.version = config.version || DEFAULT_VERSION;
      this.defaultStore = config.defaultStore || DEFAULT_STORE_NAME;
      this.stores = normalizeStores(config.stores, this.defaultStore);
      this.db = null;
      this.openPromise = null;
    }

    open() {
      const idb = getIndexedDB();
      if (!idb) return Promise.reject(new Error('IndexedDB is not supported in this browser.'));
      if (this.db) return Promise.resolve(this.db);
      if (this.openPromise) return this.openPromise;

      this.openPromise = new Promise((resolve, reject) => {
        const request = idb.open(this.dbName, this.version);

        request.onupgradeneeded = () => {
          const db = request.result;

          this.stores.forEach((definition) => {
            const store = db.objectStoreNames.contains(definition.name)
              ? request.transaction.objectStore(definition.name)
              : db.createObjectStore(definition.name, definition.options);

            definition.indexes
              .map(normalizeIndexDefinition)
              .forEach((index) => {
                if (!store.indexNames.contains(index.name)) {
                  store.createIndex(index.name, index.keyPath, index.options);
                }
              });
          });
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.db.onversionchange = () => this.close();
          resolve(this.db);
        };

        request.onerror = () => {
          this.openPromise = null;
          reject(request.error || new Error('Could not open IndexedDB.'));
        };

        request.onblocked = () => {
          this.openPromise = null;
          reject(new Error('IndexedDB upgrade is blocked by another open tab.'));
        };
      });

      return this.openPromise;
    }

    close() {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      this.openPromise = null;
    }

    async deleteDatabase() {
      const idb = getIndexedDB();
      if (!idb) throw new Error('IndexedDB is not supported in this browser.');

      this.close();
      await toRequestPromise(idb.deleteDatabase(this.dbName));
    }

    async useStore(storeName, mode, callback) {
      const db = await this.open();
      const { tx, store, done } = createAbortableTransaction(db, storeName || this.defaultStore, mode || 'readonly');

      try {
        const result = await callback(store);
        await done;
        return result;
      } catch (error) {
        try {
          tx.abort();
        } catch (abortError) {
          // The transaction may already be finished by the time the request error reaches here.
        }
        try {
          await done;
        } catch (doneError) {
          // The original request error is more useful to callers than the cleanup error.
        }
        throw error;
      }
    }

    setItem(key, value, storeName) {
      return this.useStore(storeName || this.defaultStore, 'readwrite', (store) => {
        return toRequestPromise(store.put({
          key: String(key),
          value,
          updatedAt: new Date().toISOString()
        }));
      });
    }

    async getItem(key, defaultValue, storeName) {
      const record = await this.useStore(storeName || this.defaultStore, 'readonly', (store) => {
        return toRequestPromise(store.get(String(key)));
      });

      return record ? record.value : defaultValue;
    }

    removeItem(key, storeName) {
      return this.useStore(storeName || this.defaultStore, 'readwrite', (store) => {
        return toRequestPromise(store.delete(String(key)));
      });
    }

    clear(storeName) {
      return this.useStore(storeName || this.defaultStore, 'readwrite', (store) => {
        return toRequestPromise(store.clear());
      });
    }

    async hasItem(key, storeName) {
      const value = await this.getItem(key, undefined, storeName);
      return typeof value !== 'undefined';
    }

    keys(storeName) {
      return this.useStore(storeName || this.defaultStore, 'readonly', (store) => {
        return toRequestPromise(store.getAllKeys());
      });
    }

    async values(storeName) {
      const records = await this.useStore(storeName || this.defaultStore, 'readonly', (store) => {
        return toRequestPromise(store.getAll());
      });

      return records.map((record) => record.value);
    }

    async entries(storeName) {
      const records = await this.useStore(storeName || this.defaultStore, 'readonly', (store) => {
        return toRequestPromise(store.getAll());
      });

      return records.map((record) => [record.key, record.value]);
    }

    length(storeName) {
      return this.count(storeName || this.defaultStore);
    }

    async key(index, storeName) {
      const keys = await this.keys(storeName || this.defaultStore);
      return typeof keys[index] === 'undefined' ? null : keys[index];
    }

    put(storeName, value, key) {
      return this.useStore(storeName, 'readwrite', (store) => {
        const request = typeof key === 'undefined' ? store.put(value) : store.put(value, key);
        return toRequestPromise(request);
      });
    }

    add(storeName, value, key) {
      return this.useStore(storeName, 'readwrite', (store) => {
        const request = typeof key === 'undefined' ? store.add(value) : store.add(value, key);
        return toRequestPromise(request);
      });
    }

    get(storeName, key) {
      return this.useStore(storeName, 'readonly', (store) => toRequestPromise(store.get(key)));
    }

    getAll(storeName, query, count) {
      return this.useStore(storeName, 'readonly', (store) => toRequestPromise(store.getAll(query, count)));
    }

    getAllKeys(storeName, query, count) {
      return this.useStore(storeName, 'readonly', (store) => toRequestPromise(store.getAllKeys(query, count)));
    }

    getAllByIndex(storeName, indexName, query, count) {
      return this.useStore(storeName, 'readonly', (store) => {
        return toRequestPromise(store.index(indexName).getAll(query, count));
      });
    }

    remove(storeName, key) {
      return this.useStore(storeName, 'readwrite', (store) => toRequestPromise(store.delete(key)));
    }

    count(storeName, query) {
      return this.useStore(storeName || this.defaultStore, 'readonly', (store) => toRequestPromise(store.count(query)));
    }

    table(storeName) {
      return {
        add: (value, key) => this.add(storeName, value, key),
        put: (value, key) => this.put(storeName, value, key),
        get: (key) => this.get(storeName, key),
        getAll: (query, count) => this.getAll(storeName, query, count),
        getAllKeys: (query, count) => this.getAllKeys(storeName, query, count),
        getAllByIndex: (indexName, query, count) => this.getAllByIndex(storeName, indexName, query, count),
        remove: (key) => this.remove(storeName, key),
        clear: () => this.clear(storeName),
        count: (query) => this.count(storeName, query)
      };
    }
  }

  function create(options) {
    return new IndexedDBStorage(options);
  }

  const defaultStorage = create();

  return {
    create,
    default: defaultStorage,
    IndexedDBStorage,
    isSupported,
    open: (...args) => defaultStorage.open(...args),
    close: (...args) => defaultStorage.close(...args),
    deleteDatabase: (...args) => defaultStorage.deleteDatabase(...args),
    setItem: (...args) => defaultStorage.setItem(...args),
    getItem: (...args) => defaultStorage.getItem(...args),
    removeItem: (...args) => defaultStorage.removeItem(...args),
    clear: (...args) => defaultStorage.clear(...args),
    hasItem: (...args) => defaultStorage.hasItem(...args),
    keys: (...args) => defaultStorage.keys(...args),
    values: (...args) => defaultStorage.values(...args),
    entries: (...args) => defaultStorage.entries(...args),
    length: (...args) => defaultStorage.length(...args),
    key: (...args) => defaultStorage.key(...args),
    put: (...args) => defaultStorage.put(...args),
    add: (...args) => defaultStorage.add(...args),
    get: (...args) => defaultStorage.get(...args),
    getAll: (...args) => defaultStorage.getAll(...args),
    getAllKeys: (...args) => defaultStorage.getAllKeys(...args),
    getAllByIndex: (...args) => defaultStorage.getAllByIndex(...args),
    remove: (...args) => defaultStorage.remove(...args),
    count: (...args) => defaultStorage.count(...args),
    table: (...args) => defaultStorage.table(...args)
  };
}));
