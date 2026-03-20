"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwilioTelephonyAdapter = void 0;
const errors_1 = require("../errors");
const util_1 = require("./util");
class TwilioTelephonyAdapter {
    constructor(config, fetchFn) {
        this.config = config;
        this.fetchFn = fetchFn ?? globalThis.fetch;
    }
    providerName() {
        return "twilio";
    }
    async startCall(input) {
        if (this.config.callMode === "companion") {
            throw new errors_1.CompanionModeError("Companion mode is enabled. Use the OpenClaw voice-call plugin for live calls instead of ClawVoice Twilio streaming.");
        }
        const normalizedTo = (0, util_1.normalizeE164)(input.to);
        if (!this.config.twilioAccountSid ||
            !this.config.twilioAuthToken ||
            !this.config.twilioPhoneNumber) {
            throw new Error("Twilio credentials missing: twilioAccountSid, twilioAuthToken, and twilioPhoneNumber are required");
        }
        const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Calls.json`;
        const from = input.from ?? this.config.twilioPhoneNumber;
        const baseWebhookUrl = this.config.twilioStreamUrl?.trim();
        if (!baseWebhookUrl) {
            throw new Error("Twilio stream URL missing: set CLAWVOICE_TWILIO_STREAM_URL to your public wss:// media stream endpoint");
        }
        const callSidPlaceholder = "{CallSid}";
        const twiml = `<Response><Connect><Stream url="${baseWebhookUrl}" name="clawvoice" track="inbound_track"><Parameter name="to" value="${normalizedTo}"/><Parameter name="purpose" value="${input.purpose ?? ""}"/><Parameter name="greeting" value="${input.greeting ?? ""}"/><Parameter name="callSid" value="${callSidPlaceholder}"/></Stream></Connect></Response>`;
        const body = new URLSearchParams({
            To: normalizedTo,
            From: from ?? "",
            Twiml: twiml,
        });
        const auth = Buffer.from(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`).toString("base64");
        const response = await this.fetchFn(url, {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(`Twilio API error (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        return {
            providerCallId: data.sid,
            normalizedTo,
        };
    }
    async sendSms(input) {
        const normalizedTo = (0, util_1.normalizeE164)(input.to);
        if (!this.config.twilioAccountSid ||
            !this.config.twilioAuthToken ||
            !this.config.twilioPhoneNumber) {
            throw new Error("Twilio credentials missing: twilioAccountSid, twilioAuthToken, and twilioPhoneNumber are required");
        }
        const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Messages.json`;
        const from = input.from ?? this.config.twilioPhoneNumber;
        const body = new URLSearchParams({
            To: normalizedTo,
            From: from ?? "",
            Body: input.body,
        });
        const auth = Buffer.from(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`).toString("base64");
        const response = await this.fetchFn(url, {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            throw new Error(`Twilio API error (${response.status}): ${errorText}`);
        }
        const data = (await response.json());
        return {
            providerMessageId: data.sid,
            normalizedTo,
        };
    }
    async hangup(providerCallId) {
        if (!this.config.twilioAccountSid || !this.config.twilioAuthToken) {
            return;
        }
        const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Calls/${providerCallId}.json`;
        const auth = Buffer.from(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`).toString("base64");
        await this.fetchFn(url, {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ Status: "completed" }).toString(),
        }).catch(() => undefined);
    }
}
exports.TwilioTelephonyAdapter = TwilioTelephonyAdapter;
