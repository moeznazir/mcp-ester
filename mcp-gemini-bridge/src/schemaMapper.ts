import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  SchemaType,
  type FunctionDeclaration,
} from "@google/generative-ai";
import { log } from "./logger.js";

type JsonSchemaNode = Record<string, unknown>;

/**
 * Map MCP JSON Schema tool input → Gemini {@link FunctionDeclaration.parameters}.
 * Gemini expects a subset of JSON Schema expressed with {@link SchemaType} enums.
 */
export function mcpToolsToGeminiDeclarations(tools: Tool[]): FunctionDeclaration[] {
  log.step("schemaMapper.tools_in", { count: tools.length });
  const out = tools.map((t) => {
    const decl: FunctionDeclaration = {
      name: t.name,
      description: (t.description ?? "").slice(0, 2048),
      parameters: jsonSchemaToGeminiParameters(
        (t.inputSchema ?? { type: "object", properties: {} }) as JsonSchemaNode
      ) as FunctionDeclaration["parameters"],
    };
    log.step("schemaMapper.tool_mapped", { name: t.name });
    return decl;
  });
  log.step("schemaMapper.done", { declarations: out.length });
  return out;
}

function jsonSchemaToGeminiParameters(schema: JsonSchemaNode): {
  type: SchemaType;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  items?: unknown;
  enum?: string[];
} {
  try {
    return convertNode(schema) as ReturnType<typeof jsonSchemaToGeminiParameters>;
  } catch (e) {
    log.error("schemaMapper.fallback_empty_object", e);
    return { type: SchemaType.OBJECT, properties: {} };
  }
}

function convertNode(node: unknown): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return { type: SchemaType.STRING };
  }
  const n = node as JsonSchemaNode;
  const rawType = String(n.type ?? "object").toLowerCase();

  switch (rawType) {
    case "object": {
      const props: Record<string, unknown> = {};
      const propsIn = n.properties;
      if (propsIn && typeof propsIn === "object" && !Array.isArray(propsIn)) {
        for (const [key, val] of Object.entries(propsIn as Record<string, unknown>)) {
          props[key] = convertNode(val);
        }
      }
      const out: Record<string, unknown> = {
        type: SchemaType.OBJECT,
        properties: props,
      };
      if (Array.isArray(n.required) && n.required.every((x) => typeof x === "string")) {
        out.required = n.required as string[];
      }
      if (typeof n.description === "string") out.description = n.description;
      return out;
    }
    case "array": {
      const out: Record<string, unknown> = {
        type: SchemaType.ARRAY,
        items: n.items ? convertNode(n.items) : { type: SchemaType.STRING },
      };
      if (typeof n.description === "string") out.description = n.description;
      return out;
    }
    case "string": {
      const out: Record<string, unknown> = { type: SchemaType.STRING };
      if (typeof n.description === "string") out.description = n.description;
      if (Array.isArray(n.enum) && n.enum.every((x) => typeof x === "string")) {
        out.enum = n.enum as string[];
      }
      return out;
    }
    case "number":
      return {
        type: SchemaType.NUMBER,
        ...(typeof n.description === "string" ? { description: n.description } : {}),
      };
    case "integer":
      return {
        type: SchemaType.INTEGER,
        ...(typeof n.description === "string" ? { description: n.description } : {}),
      };
    case "boolean":
      return {
        type: SchemaType.BOOLEAN,
        ...(typeof n.description === "string" ? { description: n.description } : {}),
      };
    default:
      return { type: SchemaType.STRING, description: typeof n.description === "string" ? n.description : undefined };
  }
}
