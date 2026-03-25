import { IncomingMessage, ServerResponse } from "http";
import { TwilioMediaSessionHandler } from "./media-session-handler";
export interface HttpRouteEntry {
    method: string;
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}
interface MediaStreamServerOptions {
    host: string;
    port: number;
    path: string;
    sessionHandler: TwilioMediaSessionHandler;
    httpRoutes?: HttpRouteEntry[];
}
export declare class MediaStreamServer {
    private readonly options;
    private httpServer;
    private wss;
    constructor(options: MediaStreamServerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleHttpRequest;
}
export {};
