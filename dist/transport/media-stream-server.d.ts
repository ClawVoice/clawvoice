import * as http from "http";
import { TwilioMediaSessionHandler } from "./media-session-handler";
type HttpHandler = (req: http.IncomingMessage & {
    body: Record<string, unknown>;
    protocol: string;
}, res: HttpResponse) => void | Promise<void>;
interface HttpResponse {
    _statusCode: number;
    _headers: Record<string, string>;
    status(code: number): HttpResponse;
    type(contentType: string): HttpResponse;
    json(data: unknown): void;
    send(data: string): void;
}
interface MediaStreamServerOptions {
    host: string;
    port: number;
    path: string;
    sessionHandler: TwilioMediaSessionHandler;
    /** Optional auth token for WebSocket connections. If set, connections must provide it via ?token= query param or Authorization header. */
    authToken?: string;
    /** Maximum concurrent WebSocket connections (default: 20). */
    maxConnections?: number;
}
export declare class MediaStreamServer {
    private readonly options;
    private httpServer;
    private wss;
    private readonly routes;
    private activeConnections;
    private readonly rateLimitMap;
    constructor(options: MediaStreamServerOptions);
    /**
     * Register an HTTP route on the standalone server.
     * Handlers receive Express-like req/res shims (req.body, res.status().json(), etc.).
     */
    registerHttpRoute(method: string, path: string, handler: HttpHandler): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    private checkRateLimit;
    private handleHttpRequest;
}
export {};
