import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { InboundCallRecord } from "./inbound/types";
import { MediaStreamServer } from "./transport/media-stream-server";
interface WebhookRequest {
    body?: unknown;
    headers?: Record<string, string>;
    protocol?: string;
    url?: string;
}
type InboundHandler = (record: InboundCallRecord) => void;
type InboundTextHandler = (from: string, to: string, body: string, messageId?: string) => void;
type RecordingHandler = (providerCallId: string, recordingUrl: string) => void;
export interface WebhookCallbacks {
    onInbound?: InboundHandler;
    onInboundText?: InboundTextHandler;
    onRecording?: RecordingHandler;
}
/**
 * Core webhook handler logic, shared between OpenClaw API registration and standalone server.
 */
export declare function createWebhookHandlers(config: ClawVoiceConfig, callbacks: WebhookCallbacks, logError?: (msg: string) => void): {
    handleTelnyxWebhook: (req: WebhookRequest, response: unknown) => Promise<void>;
    handleTwilioVoice: (req: WebhookRequest, response: unknown) => Promise<void>;
    handleTwilioAmd: (req: WebhookRequest, response: unknown) => Promise<void>;
    handleTwilioSms: (req: WebhookRequest, response: unknown) => Promise<void>;
    handleTwilioRecording: (req: WebhookRequest, response: unknown) => Promise<void>;
};
/**
 * Register webhook routes on the OpenClaw API router (legacy path).
 */
export declare function registerRoutes(api: PluginAPI, config: ClawVoiceConfig, onInbound?: InboundHandler, onInboundText?: InboundTextHandler, onRecording?: RecordingHandler): void;
/**
 * Register webhook routes on the standalone MediaStreamServer.
 * This allows webhooks to work even when the OpenClaw gateway doesn't
 * dispatch plugin-registered routes correctly.
 */
export declare function registerStandaloneWebhookRoutes(server: MediaStreamServer, config: ClawVoiceConfig, callbacks: WebhookCallbacks): void;
export {};
