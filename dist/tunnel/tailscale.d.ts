export type TailscaleMode = "off" | "serve" | "funnel";
export interface TailscaleSelfInfo {
    dnsName: string | null;
    nodeId: string | null;
}
export interface TailscaleExposeResult {
    ok: boolean;
    mode: TailscaleMode;
    path: string;
    localUrl: string;
    publicUrl: string | null;
    hint?: {
        note: string;
        enableUrl: string | null;
    };
}
export declare function getTailscaleSelfInfo(): Promise<TailscaleSelfInfo | null>;
export declare function getTailscaleDnsName(): Promise<string | null>;
export declare function isTailscaleAvailable(): Promise<boolean>;
export declare function setupTailscaleExposure(opts: {
    mode: "serve" | "funnel";
    path: string;
    localUrl: string;
}): Promise<string | null>;
export declare function cleanupTailscaleExposure(opts: {
    mode: "serve" | "funnel";
    path: string;
}): Promise<void>;
export declare function exposeViaTailscale(opts: {
    mode: TailscaleMode;
    localPort: number;
    localPath: string;
    tailscalePath?: string;
}): Promise<TailscaleExposeResult>;
