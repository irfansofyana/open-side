import { buildToolsMenu, resolveAvailableFeatures, resolveToolsSelection } from "./toolsRuntime";
import type { OpenWebUIFunction, OpenWebUITool, OpenWebUIModel } from "../openwebui/types";

describe("toolsRuntime", () => {
  it("normalizes tools, toggle filters, and server-enabled built-in features", () => {
    const tools: OpenWebUITool[] = [
      {
        id: "search_tool",
        name: "Search Tool",
        description: "Search the web",
        raw: { id: "search_tool", name: "Search Tool", is_global: true }
      },
      {
        id: "model_tool",
        name: "Model Tool",
        raw: { id: "model_tool", name: "Model Tool" }
      },
      {
        id: "inactive_tool",
        name: "Inactive Tool",
        raw: { id: "inactive_tool", name: "Inactive Tool", is_active: false }
      }
    ];
    const functions: OpenWebUIFunction[] = [
      {
        id: "style_filter",
        name: "Style Filter",
        type: "filter",
        isActive: true,
        isGlobal: false,
        raw: { id: "style_filter", type: "filter", is_active: true, meta: { toggle: true } }
      },
      {
        id: "pipe_function",
        name: "Pipe Function",
        type: "pipe",
        isActive: true,
        isGlobal: false,
        raw: { id: "pipe_function", type: "pipe", is_active: true }
      }
    ];
    const modelItem: OpenWebUIModel = {
      id: "llama",
      meta: {
        toolIds: ["model_tool"],
        defaultFilterIds: ["style_filter"]
      }
    };

    const menu = buildToolsMenu({
      availableFeatures: { web_search: true },
      functions,
      modelItem,
      tools
    });

    expect(menu.map((item) => [item.id, item.kind, item.isEnabledByDefault])).toEqual([
      ["web_search", "builtin", false],
      ["search_tool", "tool", true],
      ["model_tool", "tool", true],
      ["style_filter", "filter", true]
    ]);
  });

  it("resolves selected tool ids, filter ids, and feature flags", () => {
    const menu = buildToolsMenu({
      availableFeatures: { web_search: true, memory: true },
      functions: [
        {
          id: "style_filter",
          name: "Style Filter",
          type: "filter",
          isActive: true,
          isGlobal: false,
          raw: { id: "style_filter", type: "filter", is_active: true, meta: { toggle: true } }
        }
      ],
      modelItem: { id: "llama" },
      tools: [
        {
          id: "search_tool",
          name: "Search Tool",
          raw: { id: "search_tool", is_global: true }
        },
        {
          id: "optional_tool",
          name: "Optional Tool",
          raw: { id: "optional_tool" }
        }
      ]
    });

    const selection = resolveToolsSelection({
      disabledIds: ["search_tool"],
      enabledIds: ["optional_tool", "web_search"],
      items: menu
    });

    expect(selection).toEqual({
      toolIds: ["optional_tool"],
      filterIds: [],
      features: {
        web_search: true,
        image_generation: false,
        code_interpreter: false,
        memory: false
      }
    });
  });

  it("marks web search available from authenticated Open WebUI config unless model explicitly disables it", () => {
    expect(
      resolveAvailableFeatures({
        config: {
          features: {
            enable_web_search: true,
            enable_code_interpreter: false
          }
        },
        modelItem: { id: "llama", capabilities: { web_search: true } }
      })
    ).toEqual({
      web_search: true,
      image_generation: false,
      code_interpreter: false,
      memory: false
    });

    expect(
      resolveAvailableFeatures({
        config: {
          features: {
            enable_web_search: true
          }
        },
        modelItem: { id: "llama", capabilities: { web_search: false } }
      }).web_search
    ).toBe(false);
  });
});
