import { PluginAPI } from "@openclaw/plugin-sdk";
import { ClawVoiceConfig } from "./config";
import { InboundCallRecord } from "./inbound/types";
type InboundHandler = (record: InboundCallRecord) => void;
type InboundTextHandler = (from: string, to: string, body: string, messageId?: string) => void;
type RecordingHandler = (providerCallId: string, recordingUrl: string) => void;
export declare function registerRoutes(api: PluginAPI, config: ClawVoiceConfig, onInbound?: InboundHandler, onInboundText?: InboundTextHandler, onRecording?: RecordingHandler): void;
export {};
