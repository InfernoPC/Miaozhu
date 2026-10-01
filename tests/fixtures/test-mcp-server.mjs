// A real MCP server over stdio, used by the plugin tests: three tiny tools covering
// text results, error results and image results.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'test-server', version: '1.0.0' })

server.registerTool('echo', { description: 'Echo the text back', inputSchema: { text: z.string() } }, async ({ text }) => ({
  content: [{ type: 'text', text: `echo: ${text} (env TEST_FLAG=${process.env.TEST_FLAG ?? 'unset'})` }]
}))

server.registerTool('fail', { description: 'Always fails', inputSchema: {} }, async () => ({
  isError: true,
  content: [{ type: 'text', text: 'something went wrong on the server' }]
}))

server.registerTool('pixel', { description: 'Returns a 1x1 PNG', inputSchema: {} }, async () => ({
  content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }]
}))

await server.connect(new StdioServerTransport())
