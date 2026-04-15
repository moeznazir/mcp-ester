import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { log } from "./logger.js";

const CLIENT_INFO = { name: "mcp-gemini-bridge", version: "1.0.0" };

export class XanoMcpClient {
  private client: Client | null = null;

  async connect(transport: Transport): Promise<void> {
    if (this.client) {
      await this.close();
    }
    log.step("mcp.client.creating");
    this.client = new Client(CLIENT_INFO, {
      capabilities: {},
    });
    this.client.onerror = (err) => log.error("mcp.client.onerror", err);
    log.step("mcp.client.connecting");
    await this.client.connect(transport);
    log.step("mcp.client.connected");
  }

  async listTools(): Promise<Tool[]> {
    const c = this.requireClient();
    log.step("mcp.tools.list.request");
    const { tools } = await c.listTools();
    log.step("mcp.tools.list.response", { count: tools?.length ?? 0 });
    return tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const c = this.requireClient();
    log.step("mcp.tools.call.request", { name, args });
    const result = (await c.callTool({
      name,
      arguments: args,
    })) as CallToolResult;
    log.step("mcp.tools.call.response", { name, isError: result.isError });
    return result;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    log.step("mcp.client.closing");
    try {
      await this.client.close();
    } catch (e) {
      log.error("mcp.client.close", e);
    }
    this.client = null;
    log.step("mcp.client.closed");
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error("MCP client not connected");
    }
    return this.client;
  }
}
