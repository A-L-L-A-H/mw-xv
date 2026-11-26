import { describe, expect, it } from 'vitest';
import { McpRegistryError, McpServerRegistry, validateAgainstSchema } from './server-registry.js';

describe('server-registry', () => {
  it('validates tool inputs against JSON schema', () => {
    const schema = {
      type: 'object' as const,
      required: ['query'],
      additionalProperties: false,
      properties: {
        query: { type: 'string' as const },
        limit: { type: 'integer' as const },
      },
    };

    expect(validateAgainstSchema({ query: 'hello', limit: 5 }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ limit: 'bad' }, schema).valid).toBe(false);
    expect(validateAgainstSchema({ query: 'ok', extra: 1 }, schema).valid).toBe(false);
  });

  it('registers and dispatches tools, resources, and prompts', async () => {
    const registry = new McpServerRegistry();
    registry.registerTool({
      name: 'echo',
      description: 'Echoes text',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string' } },
      },
      handler: ({ text }: { text: string }) => ({ echoed: text }),
    });

    registry.registerResource({
      uri: 'mem://status',
      name: 'status',
      mimeType: 'text/plain',
      reader: () => 'healthy',
    });

    registry.registerPrompt({
      name: 'greet',
      arguments: [{ name: 'user', required: true }],
      render: ({ user }) => `Hello, ${user}!`,
    });

    expect(registry.listTools().map((t) => t.name)).toEqual(['echo']);
    expect(await registry.dispatchTool('echo', { text: 'wave-s' })).toEqual({ echoed: 'wave-s' });
    await expect(registry.dispatchTool('echo', {})).rejects.toThrow(McpRegistryError);
    expect((await registry.readResource('mem://status')).content).toBe('healthy');
    expect(await registry.renderPrompt('greet', { user: 'Ada' })).toBe('Hello, Ada!');
    await expect(registry.renderPrompt('greet', {})).rejects.toThrow(McpRegistryError);
  });
});
