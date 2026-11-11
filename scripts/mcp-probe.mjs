// Calls dummyPlane's MCP server as a Claude session would, with a node's
// launch file. Usage:
//   node scripts/mcp-probe.mjs <path to <appdata>/mcp/<nodeId>.json> <method> [json params]
import { readFileSync } from "node:fs";

const [configPath, method, params = "{}"] = process.argv.slice(2);
const server = JSON.parse(readFileSync(configPath, "utf8")).mcpServers.dummyplane;
let id = 0;
async function rpc(method, params) {
  const response = await fetch(server.url, {
    method: "POST",
    headers: { ...server.headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return { status: response.status, body: await response.text() };
}
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } });
const answer = await rpc(method, JSON.parse(params));
console.log(answer.status, answer.body);
