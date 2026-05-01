export type ServerPermissionResult = {
  granted: boolean;
  originPattern: string;
};

export const toOriginPattern = (serverUrl: string): string => {
  let url: URL;

  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error("Invalid server URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use http or https");
  }

  return `${url.origin}/*`;
};

export const requestServerOriginPermission = async (
  serverUrl: string
): Promise<ServerPermissionResult> => {
  const originPattern = toOriginPattern(serverUrl);
  const request = { origins: [originPattern] };
  const alreadyGranted = await chrome.permissions.contains(request);

  if (alreadyGranted) {
    return { granted: true, originPattern };
  }

  const granted = await chrome.permissions.request(request);
  return { granted, originPattern };
};
