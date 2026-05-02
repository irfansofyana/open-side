import type { CitationSource } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStringArray = (value: unknown): string[] => {
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
};

const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (isRecord(value)) {
    return [value];
  }

  return Array.isArray(value) ? value.filter(isRecord) : [];
};

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const isUrl = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://");

const getDocuments = (value: Record<string, unknown>): string[] => [
  ...toStringArray(value.document),
  ...toStringArray(value.documents),
  ...toStringArray(value.content)
];

const getUrlFromMetadata = (metadata: Record<string, unknown>[]): string | undefined => {
  for (const item of metadata) {
    const url = getString(item.url);
    const source = getString(item.source);

    if (url) {
      return url;
    }

    if (source && isUrl(source)) {
      return source;
    }
  }

  return undefined;
};

const getNameFromMetadata = (metadata: Record<string, unknown>[]): string | undefined => {
  for (const item of metadata) {
    const name =
      getString(item.title) ??
      getString(item.name) ??
      getString(item.site_name) ??
      (() => {
        const source = getString(item.source);

        return source && !isUrl(source) ? source : undefined;
      })();

    if (name) {
      return name;
    }
  }

  return undefined;
};

export function normalizeCitationSource(
  value: unknown,
  index = 1
): CitationSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = isRecord(value.source) ? value.source : undefined;
  const metadata = toRecordArray(value.metadata);
  const documents = getDocuments(value);
  const url =
    getString(value.url) ??
    getUrlFromMetadata(metadata) ??
    getString(source?.url);
  const name =
    getString(value.title) ??
    getNameFromMetadata(metadata) ??
    getString(value.name) ??
    getString(source?.name) ??
    url ??
    `Source ${index}`;

  if (!name && !url && documents.length === 0) {
    return undefined;
  }

  return {
    documents,
    index,
    metadata,
    name,
    ...(url ? { url } : {})
  };
}

const expandCitationEntry = (value: unknown): unknown[] => {
  if (!isRecord(value)) {
    return [];
  }

  const metadata = toRecordArray(value.metadata);

  if (metadata.length <= 1) {
    return [value];
  }

  const documents = getDocuments(value);

  return metadata.map((metadataItem, index) => ({
    document: documents[index] ? [documents[index]] : [],
    metadata: [metadataItem],
    source: value.source
  }));
};

export function normalizeCitationSources(value: unknown): CitationSource[] {
  const entries = Array.isArray(value)
    ? value.flatMap(expandCitationEntry)
    : expandCitationEntry(value);
  const deduped: CitationSource[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const source = normalizeCitationSource(entry, deduped.length + 1);

    if (!source) {
      continue;
    }

    const key = `${source.url ?? ""}|${source.name}|${source.documents[0] ?? ""}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({ ...source, index: deduped.length + 1 });
  }

  return deduped;
}
