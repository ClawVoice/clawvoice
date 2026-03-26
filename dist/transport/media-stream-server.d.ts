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
}
export declare class MediaStreamServer {
    private readonly options;
    private httpServer;
    private wss;
    private readonly routes;
    constructor(options: MediaStreamServerOptions);
    /**
     * Register an HTTP route on the standalone server.
     * Handlers receive Express-like req/res shims (req.body, res.status().json(), etc.).
     */
    registerHttpRoute(method: string, path: string, handler: HttpHandler): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleHttpRequest;
}
export {};
