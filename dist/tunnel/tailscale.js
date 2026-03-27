"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTailscaleSelfInfo = getTailscaleSelfInfo;
exports.getTailscaleDnsName = getTailscaleDnsName;
exports.isTailscaleAvailable = isTailscaleAvailable;
exports.setupTailscaleExposure = setupTailscaleExposure;
exports.cleanupTailscaleExposure = cleanupTailscaleExposure;
exports.exposeViaTailscale = exposeViaTailscale;
const node_child_process_1 = require("node:child_process");
function runTailscaleCommand(args, timeoutMs = 2500) {
    return new Promise((resolve) => {
        let stdout = "";
        const proc = (0, node_child_process_1.spawn)("tailscale", args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        proc.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            resolve({ code: -1, stdout: "" });
        }, timeoutMs);
        proc.on("error", () => {
            clearTimeout(timer);
            resolve({ code: -1, stdout: "" });
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? -1, stdout });
        });
    });
}
async function getTailscaleSelfInfo() {
    const { code, stdout } = await runTailscaleCommand(["status", "--json"]);
    if (code !== 0)
        return null;
    try {
        const status = JSON.parse(stdout);
        return {
            dnsName: status.Self?.DNSName?.replace(/\.$/, "") || null,
            nodeId: status.Self?.ID || null,
        };
    }
    catch {
        return null;
    }
}
async function getTailscaleDnsName() {
    const info = await getTailscaleSelfInfo();
    return info?.dnsName ?? null;
}
async function isTailscaleAvailable() {
    const { code } = await runTailscaleCommand(["status", "--json"]);
    return code === 0;
}
async function setupTailscaleExposure(opts) {
    const dnsName = await getTailscaleDnsName();
    if (!dnsName)
        return null;
    const { code } = await runTailscaleCommand([opts.mode, "--bg", "--yes", "--set-path", opts.path, opts.localUrl], 10000);
    if (code === 0) {
        return `https://${dnsName}${opts.path}`;
    }
    return null;
}
async function cleanupTailscaleExposure(opts) {
    await runTailscaleCommand([opts.mode, "off", opts.path]);
}
async function exposeViaTailscale(opts) {
    const tsPath = opts.tailscalePath ?? opts.localPath;
    const localUrl = `http://127.0.0.1:${opts.localPort}${opts.localPath}`;
    if (opts.mode === "off") {
        await cleanupTailscaleExposure({ mode: "serve", path: tsPath });
        await cleanupTailscaleExposure({ mode: "funnel", path: tsPath });
        return { ok: true, mode: "off", path: tsPath, localUrl, publicUrl: null };
    }
    const publicUrl = await setupTailscaleExposure({
        mode: opts.mode,
        path: tsPath,
        localUrl,
    });
    if (publicUrl) {
        return { ok: true, mode: opts.mode, path: tsPath, localUrl, publicUrl };
    }
    const info = await getTailscaleSelfInfo();
    const enableUrl = info?.nodeId
        ? `https://login.tailscale.com/f/${opts.mode}?node=${info.nodeId}`
        : null;
    return {
        ok: false,
        mode: opts.mode,
        path: tsPath,
        localUrl,
        publicUrl: null,
        hint: {
            note: "Tailscale serve/funnel may need to be enabled for your tailnet. " +
                "Check your Tailscale admin console or visit the URL below.",
            enableUrl,
        },
    };
}
