import { beforeEach, vi } from "vitest";

type StorageAreaData = Record<string, unknown>;

const storageData: StorageAreaData = {};

const getStoredValues = (keys?: string | string[] | StorageAreaData | null): StorageAreaData => {
  if (keys == null) {
    return { ...storageData };
  }

  if (typeof keys === "string") {
    return keys in storageData ? { [keys]: storageData[keys] } : {};
  }

  if (Array.isArray(keys)) {
    return keys.reduce<StorageAreaData>((result, key) => {
      if (key in storageData) {
        result[key] = storageData[key];
      }
      return result;
    }, {});
  }

  return Object.entries(keys).reduce<StorageAreaData>((result, [key, defaultValue]) => {
    result[key] = key in storageData ? storageData[key] : defaultValue;
    return result;
  }, {});
};

export const setChromeStorageData = (data: StorageAreaData): void => {
  Object.keys(storageData).forEach((key) => {
    delete storageData[key];
  });
  Object.assign(storageData, data);
};

export const getChromeStorageData = (): StorageAreaData => ({ ...storageData });

const storageLocal = {
  get: vi.fn((keys?: string | string[] | StorageAreaData | null) => Promise.resolve(getStoredValues(keys))),
  set: vi.fn((items: StorageAreaData) => {
    Object.assign(storageData, items);
    return Promise.resolve();
  }),
  remove: vi.fn((keys: string | string[]) => {
    const keysToRemove = Array.isArray(keys) ? keys : [keys];
    keysToRemove.forEach((key) => {
      delete storageData[key];
    });
    return Promise.resolve();
  }),
  clear: vi.fn(() => {
    Object.keys(storageData).forEach((key) => {
      delete storageData[key];
    });
    return Promise.resolve();
  })
};

beforeEach(() => {
  setChromeStorageData({});
  storageLocal.get.mockClear();
  storageLocal.set.mockClear();
  storageLocal.remove.mockClear();
  storageLocal.clear.mockClear();
});

vi.stubGlobal("chrome", {
  storage: {
    local: storageLocal
  },
  runtime: {
    onInstalled: {
      addListener: vi.fn()
    }
  },
  sidePanel: {
    setPanelBehavior: vi.fn(() => Promise.resolve()),
    open: vi.fn(() => Promise.resolve())
  },
  action: {
    onClicked: {
      addListener: vi.fn()
    }
  }
});
