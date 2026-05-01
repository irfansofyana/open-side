import { vi } from "vitest";

import {
  requestServerOriginPermission,
  toOriginPattern
} from "./permissions";

const permissions = {
  contains: vi.fn(),
  request: vi.fn()
};

beforeEach(() => {
  permissions.contains.mockReset();
  permissions.request.mockReset();
  Object.assign(chrome, { permissions });
});

test("normalizes http and https URLs to origin patterns", () => {
  expect(toOriginPattern("http://localhost:3000/api")).toBe("http://localhost:3000/*");
  expect(toOriginPattern("https://openwebui.example.com/path")).toBe(
    "https://openwebui.example.com/*"
  );
});

test("rejects invalid URLs", () => {
  expect(() => toOriginPattern("not a url")).toThrow("Invalid server URL");
});

test("rejects non-http(s) schemes", () => {
  expect(() => toOriginPattern("chrome-extension://extension-id/options.html")).toThrow(
    "Server URL must use http or https"
  );
});

test("does not request permission when origin is already granted", async () => {
  permissions.contains.mockResolvedValue(true);

  await expect(requestServerOriginPermission("https://openwebui.example.com/path")).resolves.toEqual({
    granted: true,
    originPattern: "https://openwebui.example.com/*"
  });

  expect(permissions.contains).toHaveBeenCalledWith({
    origins: ["https://openwebui.example.com/*"]
  });
  expect(permissions.request).not.toHaveBeenCalled();
});

test("requests permission when origin is not already granted and returns false when user denies", async () => {
  permissions.contains.mockResolvedValue(false);
  permissions.request.mockResolvedValue(false);

  await expect(requestServerOriginPermission("http://localhost:3000/api")).resolves.toEqual({
    granted: false,
    originPattern: "http://localhost:3000/*"
  });

  expect(permissions.contains).toHaveBeenCalledWith({
    origins: ["http://localhost:3000/*"]
  });
  expect(permissions.request).toHaveBeenCalledWith({
    origins: ["http://localhost:3000/*"]
  });
});
