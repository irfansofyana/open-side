import {
  defaultFeatureFlags,
  type FeatureFlags,
  type FeatureKey,
  type OpenWebUIFunction,
  type OpenWebUIModel,
  type OpenWebUITool,
  type ToolMenuItem,
  type ToolsSelection
} from "../openwebui/types";

type BuildToolsMenuInput = {
  tools: OpenWebUITool[];
  functions: OpenWebUIFunction[];
  modelItem?: OpenWebUIModel;
  availableFeatures?: Partial<Record<FeatureKey, boolean>>;
};

type ResolveToolsSelectionInput = {
  items: ToolMenuItem[];
  enabledIds?: string[];
  disabledIds?: string[];
};

type ResolveAvailableFeaturesInput = {
  config?: Record<string, unknown>;
  modelItem?: OpenWebUIModel;
};

const builtInFeatures: Array<{
  key: FeatureKey;
  name: string;
  description: string;
}> = [
  {
    key: "web_search",
    name: "Web search",
    description: "Allow Open WebUI to use server-side web search."
  },
  {
    key: "image_generation",
    name: "Image generation",
    description: "Allow Open WebUI image generation when available."
  },
  {
    key: "code_interpreter",
    name: "Code interpreter",
    description: "Allow Open WebUI code interpreter when available."
  },
  {
    key: "memory",
    name: "Memory",
    description: "Allow Open WebUI memory tools when available."
  }
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const getModelMeta = (modelItem?: OpenWebUIModel): Record<string, unknown> =>
  isRecord(modelItem?.meta) ? modelItem.meta : {};

const getNestedRecord = (
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined => (isRecord(value[key]) ? value[key] : undefined);

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

export const resolveModelToolIds = (modelItem?: OpenWebUIModel): string[] => {
  if (!modelItem) {
    return [];
  }

  const meta = getModelMeta(modelItem);
  const info = isRecord(modelItem.info) ? modelItem.info : undefined;
  const infoMeta = info ? getNestedRecord(info, "meta") : undefined;
  const records = [modelItem, meta, info, infoMeta].filter(isRecord);

  return uniqueStrings(
    records.flatMap((record) => [
      ...getStringArray(record.toolIds),
      ...getStringArray(record.tool_ids),
      ...getStringArray(record.defaultToolIds),
      ...getStringArray(record.default_tool_ids)
    ])
  );
};

const featureConfigKeys: Record<FeatureKey, string[]> = {
  web_search: ["enable_web_search", "web_search"],
  image_generation: ["enable_image_generation", "image_generation"],
  code_interpreter: ["enable_code_interpreter", "code_interpreter"],
  memory: ["enable_memory", "memory"]
};

const findBoolean = (
  records: Array<Record<string, unknown> | undefined>,
  keys: string[]
): boolean | undefined => {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];

      if (typeof value === "boolean") {
        return value;
      }
    }
  }

  return undefined;
};

const isToolActive = (tool: OpenWebUITool): boolean => tool.raw.is_active !== false;

const isToggleableFilter = (fn: OpenWebUIFunction): boolean => {
  const meta = isRecord(fn.raw.meta) ? fn.raw.meta : {};
  const manifest = isRecord(meta.manifest) ? meta.manifest : {};

  return fn.type === "filter" && (fn.raw.toggle === true || meta.toggle === true || manifest.toggle === true);
};

const isFeatureEnabledByConfig = (
  config: Record<string, unknown> | undefined,
  featureKey: FeatureKey
): boolean => {
  if (!config) {
    return false;
  }

  const features = getNestedRecord(config, "features");

  return findBoolean([features, config], featureConfigKeys[featureKey]) === true;
};

const isFeatureExplicitlyDisabledByModel = (
  modelItem: OpenWebUIModel | undefined,
  featureKey: FeatureKey
): boolean => {
  if (!modelItem) {
    return false;
  }

  const meta = getModelMeta(modelItem);
  const info = isRecord(modelItem.info) ? modelItem.info : undefined;
  const capabilities = [
    getNestedRecord(modelItem, "capabilities"),
    getNestedRecord(meta, "capabilities"),
    info ? getNestedRecord(info, "capabilities") : undefined
  ];

  return findBoolean(capabilities, featureConfigKeys[featureKey]) === false;
};

const isItemEnabled = (
  item: ToolMenuItem,
  enabledIds: Set<string>,
  disabledIds: Set<string>
): boolean => enabledIds.has(item.id) || (item.isEnabledByDefault && !disabledIds.has(item.id));

export function resolveAvailableFeatures({
  config,
  modelItem
}: ResolveAvailableFeaturesInput): FeatureFlags {
  return {
    web_search:
      isFeatureEnabledByConfig(config, "web_search") &&
      !isFeatureExplicitlyDisabledByModel(modelItem, "web_search"),
    image_generation:
      isFeatureEnabledByConfig(config, "image_generation") &&
      !isFeatureExplicitlyDisabledByModel(modelItem, "image_generation"),
    code_interpreter:
      isFeatureEnabledByConfig(config, "code_interpreter") &&
      !isFeatureExplicitlyDisabledByModel(modelItem, "code_interpreter"),
    memory:
      isFeatureEnabledByConfig(config, "memory") &&
      !isFeatureExplicitlyDisabledByModel(modelItem, "memory")
  };
}

export function buildToolsMenu({
  availableFeatures = {},
  functions,
  modelItem,
  tools
}: BuildToolsMenuInput): ToolMenuItem[] {
  const meta = getModelMeta(modelItem);
  const defaultFilterIds = new Set([
    ...getStringArray(meta.defaultFilterIds),
    ...getStringArray(meta.default_filter_ids)
  ]);
  const defaultFeatureIds = new Set([
    ...getStringArray(meta.defaultFeatureIds),
    ...getStringArray(meta.default_feature_ids),
    ...getStringArray(meta.defaultFeatures),
    ...getStringArray(meta.default_features)
  ]);
  const builtinItems = builtInFeatures.flatMap<ToolMenuItem>((feature) =>
    availableFeatures[feature.key]
      ? [
          {
            id: feature.key,
            name: feature.name,
            description: feature.description,
            kind: "builtin",
            featureKey: feature.key,
            isEnabledByDefault: defaultFeatureIds.has(feature.key)
          }
        ]
      : []
  );
  const toolItems = tools
    .filter(isToolActive)
    .map<ToolMenuItem>((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      kind: "tool",
      isEnabledByDefault: false
    }));
  const filterItems = functions
    .filter((fn) => fn.isActive && isToggleableFilter(fn))
    .map<ToolMenuItem>((fn) => ({
      id: fn.id,
      name: fn.name,
      description: fn.description,
      kind: "filter",
      isEnabledByDefault: defaultFilterIds.has(fn.id)
    }));

  return [...builtinItems, ...toolItems, ...filterItems];
}

export function resolveActiveToolItems({
  disabledIds = [],
  enabledIds = [],
  items
}: ResolveToolsSelectionInput): ToolMenuItem[] {
  const enabledIdSet = new Set(enabledIds);
  const disabledIdSet = new Set(disabledIds);

  return items.filter((item) => isItemEnabled(item, enabledIdSet, disabledIdSet));
}

export function resolveToolsSelection(input: ResolveToolsSelectionInput): ToolsSelection {
  const activeItems = resolveActiveToolItems(input);
  const features: FeatureFlags = { ...defaultFeatureFlags };

  activeItems.forEach((item) => {
    if (item.kind === "builtin") {
      features[item.featureKey] = true;
    }
  });

  return {
    toolIds: activeItems.filter((item) => item.kind === "tool").map((item) => item.id),
    filterIds: activeItems.filter((item) => item.kind === "filter").map((item) => item.id),
    features
  };
}
