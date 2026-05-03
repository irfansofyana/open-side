export type StreamDiagnosticFields = Record<string, unknown>;

export type StreamDiagnosticEntry = {
  at: string;
  event: string;
  fields: StreamDiagnosticFields;
};

export type StreamDiagnosticsLogger = {
  clear: () => void;
  getEntries: () => StreamDiagnosticEntry[];
  log: (event: string, fields?: StreamDiagnosticFields) => void;
};

type StreamDiagnosticsOptions = {
  enabled?: boolean;
  maxEntries?: number;
  now?: () => number;
  sink?: (event: string, fields: StreamDiagnosticFields) => void;
};

const isSensitiveField = (key: string): boolean => {
  const normalized = key.toLowerCase();

  return (
    normalized === "authorization" ||
    normalized === "body" ||
    normalized === "content" ||
    normalized === "page" ||
    normalized === "password" ||
    normalized === "prompt" ||
    normalized === "secret" ||
    normalized === "text" ||
    normalized.includes("credential") ||
    normalized.includes("token")
  );
};

const redactFields = (fields: StreamDiagnosticFields = {}): StreamDiagnosticFields =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      isSensitiveField(key) ? "[redacted]" : value
    ])
  );

const consoleSink = (event: string, fields: StreamDiagnosticFields): void => {
  console.debug("[Open WebUI stream]", event, fields);
};

export function createStreamDiagnosticsLogger({
  enabled = true,
  maxEntries = 200,
  now = Date.now,
  sink = consoleSink
}: StreamDiagnosticsOptions = {}): StreamDiagnosticsLogger {
  const entries: StreamDiagnosticEntry[] = [];

  return {
    clear: () => {
      entries.length = 0;
    },
    getEntries: () => [...entries],
    log: (event, fields = {}) => {
      if (!enabled) {
        return;
      }

      const redactedFields = redactFields(fields);
      entries.push({
        at: new Date(now()).toISOString(),
        event,
        fields: redactedFields
      });

      if (entries.length > maxEntries) {
        entries.splice(0, entries.length - maxEntries);
      }

      sink(event, redactedFields);
    }
  };
}

export const streamDiagnostics = createStreamDiagnosticsLogger();

declare global {
  var openWebUIStreamDiagnostics: StreamDiagnosticsLogger | undefined;
}

globalThis.openWebUIStreamDiagnostics = streamDiagnostics;
