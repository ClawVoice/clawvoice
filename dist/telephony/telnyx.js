"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelnyxTelephonyAdapter = void 0;
const util_1 = require("./util");
class TelnyxTelephonyAdapter {
    constructor(config, fetchFn) {
        this.config = config;
        this.fetchFn = fetchFn ?? globalThis.fetch;
    }
    providerName() {
        return "telnyx";
    }
    async startCall(input) {
        const normalizedTo = (0, util_1.normalizeE164)(input.to);
        if (!this.config.telnyxApiKey ||
            !this.config.telnyxConnectionId ||
            !this.config.telnyxPhoneNumber) {
            throw new Error("Telnyx credentials missing: telnyxApiKey, telnyxConnectionId, and telnyxPhoneNumber are required");
        }
        const from = input.from ?? this.config.telnyxPhoneNumber;
        const response = await this.fetchFn("https://api.telnyx.com/v2/calls", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.telnyxApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                connection_id: this.config.telnyxConnectionId,
                to: normalizedTo,
                from: from ?? "",
                answering_machine_detection: this.config.amdEnabled
                    ? "detect"
                    : "disabled",
            }),
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(`Telnyx API error (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        return {
            providerCallId: data.data.call_control_id,
            normalizedTo,
        };
    }
    async sendSms(input) {
        const normalizedTo = (0, util_1.normalizeE164)(input.to);
        if (!this.config.telnyxApiKey || !this.config.telnyxPhoneNumber) {
            throw new Error("Telnyx credentials missing: telnyxApiKey and telnyxPhoneNumber are required");
        }
        const from = input.from ?? this.config.telnyxPhoneNumber;
        const response = await this.fetchFn("https://api.telnyx.com/v2/messages", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.telnyxApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: from ?? "",
                to: normalizedTo,
                text: input.body,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(`Telnyx API error (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        return {
            providerMessageId: data.data.id,
            normalizedTo,
        };
    }
    async hangup(providerCallId) {
        if (!this.config.telnyxApiKey) {
            return;
        }
        await this.fetchFn(`https://api.telnyx.com/v2/calls/${providerCallId}/actions/hangup`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.telnyxApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        }).catch(() => undefined);
    }
}
exports.TelnyxTelephonyAdapter = TelnyxTelephonyAdapter;
