declare module "@openclaw/plugin-sdk" {
  export interface Plugin {
    name: string;
    init(api: PluginAPI): Promise<void>;
  }

  export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (input: Record<string, unknown>, ctx?: unknown) => Promise<{ content: string; data?: unknown }>;
  }

  export interface CliCommand {
    name: string;
    description: string;
    run: (args: string[]) => Promise<void>;
  }

  export interface RouteHandler {
    (request: unknown, response: HttpResponse): Promise<void>;
  }

  export interface HttpResponse {
    status(code: number): { json(value: unknown): void; send(body?: string): void };
    type(contentType: string): { send(body: string): void };
  }

  export interface Router {
    post(path: string, handler: RouteHandler): void;
    get(path: string, handler: RouteHandler): void;
  }

  export type HookHandler = (event: unknown, context: unknown) => unknown;

  export interface Logger {
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, metadata?: Record<string, unknown>): void;
  }

  export interface PluginAPI {
    config: {
      [key: string]: unknown;
      get?(key: string): unknown;
      set?(key: string, value: unknown): Promise<void>;
      setMany?(values: Record<string, unknown>): Promise<void>;
    };
    tools: { register(definition: ToolDefinition): void };
    cli: { register(definition: CliCommand): void };
    http: { router(prefix: string): Router };
    hooks: { on(name: string, handler: HookHandler): void };
    services: { register(name: string, instance: unknown): void };
    log: Logger;
  }
}
