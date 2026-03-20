import { TwilioMediaSessionHandler } from "./media-session-handler";
interface MediaStreamServerOptions {
    host: string;
    port: number;
    path: string;
    sessionHandler: TwilioMediaSessionHandler;
}
export declare class MediaStreamServer {
    private readonly options;
    private wss;
    constructor(options: MediaStreamServerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
}
export {};
