"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwilioTelephonyAdapter = void 0;
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
        // Twilio's <Stream> element strips ALL query parameters from the URL,
        // so auth token and ref ID are passed as <Parameter> elements instead.
        // They arrive in the `start` event's customParameters on the media stream.
        let recordAttr = "";
        if (this.config.recordCalls) {
            // Derive HTTPS webhook URL from the WSS stream URL for recording status callback
            const recordingCallbackUrl = baseWebhookUrl
                .replace(/^wss:/i, "https:")
                .replace(/\/media-stream\/?$/, "/clawvoice/webhooks/twilio/recording");
            recordAttr = ` record="record-from-answer" recordingStatusCallback="${recordingCallbackUrl}" recordingStatusCallbackEvent="completed"`;
        }
        // XML-escape values to prevent TwiML parse errors from special chars in purpose/greeting
        const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
        const safeStreamUrl = xmlEscape(baseWebhookUrl);
        const safePurpose = xmlEscape(input.purpose ?? "");
        const safeGreeting = xmlEscape(input.greeting ?? "");
        const safeRef = xmlEscape(input.refId ?? "");
        const safeToken = xmlEscape(input.mediaStreamAuthToken ?? "");
        const twiml = `<Response><Connect${recordAttr}><Stream url="${safeStreamUrl}" name="clawvoice" track="inbound_track"><Parameter name="clawvoice_token" value="${safeToken}"/><Parameter name="clawvoice_ref" value="${safeRef}"/><Parameter name="to" value="${normalizedTo}"/><Parameter name="purpose" value="${safePurpose}"/><Parameter name="greeting" value="${safeGreeting}"/><Parameter name="callSid" value="${callSidPlaceholder}"/></Stream></Connect></Response>`;
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
            console.error(`[clawvoice] Twilio startCall API error (${response.status}):`, errorText);
            throw new Error(`Twilio API error (${response.status}): Call initiation failed`);
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
            console.error(`[clawvoice] Twilio sendSms API error (${response.status}):`, errorText);
            throw new Error(`Twilio API error (${response.status}): SMS send failed`);
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
        // H2: Validate providerCallId format to prevent URL injection
        if (!/^CA[0-9a-f]{32}$/i.test(providerCallId)) {
            console.error(`[clawvoice] Invalid Twilio call SID format: ${providerCallId}`);
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
