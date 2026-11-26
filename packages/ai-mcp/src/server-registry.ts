export interface JsonSchemaProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchemaProperty;
  readonly properties?: Record<string, JsonSchemaProperty>;
  readonly required?: readonly string[];
}

export interface McpToolSchema {
  readonly type: 'object';
  readonly properties?: Record<string, JsonSchemaProperty>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface McpToolEntry<TInput = Record<string, unknown>, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpToolSchema;
  readonly handler: (input: TInput) => Promise<TOutput> | TOutput;
}

export interface McpResourceEntry {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly reader: () => Promise<string | Uint8Array> | string | Uint8Array;
}

export interface McpPromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface McpPromptEntry {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly McpPromptArgument[];
  readonly render: (args: Record<string, string>) => Promise<string> | string;
}

export type McpRegistryErrorCode = 'DUPLICATE_ENTRY' | 'NOT_FOUND' | 'VALIDATION_ERROR';

export class McpRegistryError extends Error {
  readonly code: McpRegistryErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: McpRegistryErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'McpRegistryError';
    this.code = code;
    this.details = details;
  }
}

function validatePropertyValue(
  value: unknown,
  schema: JsonSchemaProperty,
  path: string,
  errors: string[],
): void {
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value must be one of [${schema.enum.join(', ')}]`);
    return;
  }

  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${path}: expected number`);
      }
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${path}: expected boolean`);
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
      } else if (schema.items) {
        value.forEach((item, idx) => validatePropertyValue(item, schema.items!, `${path}[${idx}]`, errors));
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
      } else if (schema.properties) {
        const obj = value as Record<string, unknown>;
        for (const req of schema.required ?? []) {
          if (obj[req] === undefined) {
            errors.push(`${path}.${req}: is required`);
          }
        }
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (obj[key] !== undefined) {
            validatePropertyValue(obj[key], propSchema, `${path}.${key}`, errors);
          }
        }
      }
      break;
  }
}

export function validateAgainstSchema(
  value: unknown,
  schema: McpToolSchema,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, errors: ['input: expected object'] };
  }

  const obj = value as Record<string, unknown>;
  for (const req of schema.required ?? []) {
    if (obj[req] === undefined) {
      errors.push(`${req}: is required`);
    }
  }

  const props = schema.properties ?? {};
  for (const [key, val] of Object.entries(obj)) {
    const propSchema = props[key];
    if (!propSchema) {
      if (schema.additionalProperties === false) {
        errors.push(`${key}: additional property not allowed`);
      }
      continue;
    }
    validatePropertyValue(val, propSchema, key, errors);
  }

  return { valid: errors.length === 0, errors };
}

interface StoredToolEntry {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpToolSchema;
  readonly handler: (input: unknown) => Promise<unknown> | unknown;
}

export class McpServerRegistry {
  private readonly tools = new Map<string, StoredToolEntry>();
  private readonly resources = new Map<string, McpResourceEntry>();
  private readonly prompts = new Map<string, McpPromptEntry>();

  registerTool<TInput = Record<string, unknown>, TOutput = unknown>(
    entry: McpToolEntry<TInput, TOutput>,
    options?: { override?: boolean },
  ): this {
    if (!options?.override && this.tools.has(entry.name)) {
      throw new McpRegistryError('DUPLICATE_ENTRY', `Tool "${entry.name}" is already registered.`, {
        name: entry.name,
      });
    }
    this.tools.set(entry.name, {
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema,
      handler: (input: unknown) => entry.handler(input as TInput),
    });
    return this;
  }

  registerResource(entry: McpResourceEntry, options?: { override?: boolean }): this {
    if (!options?.override && this.resources.has(entry.uri)) {
      throw new McpRegistryError(
        'DUPLICATE_ENTRY',
        `Resource "${entry.uri}" is already registered.`,
        { uri: entry.uri },
      );
    }
    this.resources.set(entry.uri, entry);
    return this;
  }

  registerPrompt(entry: McpPromptEntry, options?: { override?: boolean }): this {
    if (!options?.override && this.prompts.has(entry.name)) {
      throw new McpRegistryError('DUPLICATE_ENTRY', `Prompt "${entry.name}" is already registered.`, {
        name: entry.name,
      });
    }
    this.prompts.set(entry.name, entry);
    return this;
  }

  listTools(): Omit<McpToolEntry, 'handler'>[] {
    return [...this.tools.values()].map(({ handler: _handler, ...meta }) => meta);
  }

  listResources(): Omit<McpResourceEntry, 'reader'>[] {
    return [...this.resources.values()].map(({ reader: _reader, ...meta }) => meta);
  }

  listPrompts(): Omit<McpPromptEntry, 'render'>[] {
    return [...this.prompts.values()].map(({ render: _render, ...meta }) => meta);
  }

  async dispatchTool<TOutput = unknown>(name: string, input: unknown = {}): Promise<TOutput> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new McpRegistryError('NOT_FOUND', `Unknown MCP tool "${name}".`, { name });
    }
    const validation = validateAgainstSchema(input, entry.inputSchema);
    if (!validation.valid) {
      throw new McpRegistryError(
        'VALIDATION_ERROR',
        `Invalid input for tool "${name}": ${validation.errors.join('; ')}`,
        { name, errors: validation.errors },
      );
    }
    return (await entry.handler(input)) as TOutput;
  }

  async readResource(uri: string): Promise<{ uri: string; mimeType?: string; content: string | Uint8Array }> {
    const entry = this.resources.get(uri);
    if (!entry) {
      throw new McpRegistryError('NOT_FOUND', `Unknown MCP resource "${uri}".`, { uri });
    }
    const content = await entry.reader();
    return {
      uri: entry.uri,
      mimeType: entry.mimeType,
      content,
    };
  }

  async renderPrompt(name: string, args: Record<string, string> = {}): Promise<string> {
    const entry = this.prompts.get(name);
    if (!entry) {
      throw new McpRegistryError('NOT_FOUND', `Unknown MCP prompt "${name}".`, { name });
    }
    for (const arg of entry.arguments ?? []) {
      if (arg.required && (args[arg.name] === undefined || args[arg.name] === '')) {
        throw new McpRegistryError(
          'VALIDATION_ERROR',
          `Missing required argument "${arg.name}" for prompt "${name}".`,
          { name, argument: arg.name },
        );
      }
    }
    return await entry.render(args);
  }
}
