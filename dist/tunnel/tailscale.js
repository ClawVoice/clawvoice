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
        let stderr = "";
        let settled = false;
        const proc = (0, node_child_process_1.spawn)("tailscale", args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        proc.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        const finish = (code, out, err) => {
            if (settled)
                return;
            settled = true;
            resolve({ code, stdout: out, stderr: err && err.length > 0 ? err : undefined });
        };
        const timer = setTimeout(() => {
            try {
                proc.kill();
            }
            catch {
            }
            finish(-1, "", stderr);
        }, timeoutMs);
        proc.on("error", () => {
            clearTimeout(timer);
            finish(-1, "", stderr);
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            finish(code ?? -1, stdout, stderr);
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
    const p = normalizePath(opts.path);
    const dnsName = await getTailscaleDnsName();
    if (!dnsName)
        return null;
    const { code } = await runTailscaleCommand([opts.mode, "--bg", "--yes", "--set-path", p, opts.localUrl], 10000);
    if (code === 0) {
        return `https://${dnsName}${p}`;
    }
    return null;
}
const normalizePath = (p) => (p.startsWith("/") ? p : `/${p}`);
async function cleanupTailscaleExposure(opts) {
    const p = normalizePath(opts.path);
    await runTailscaleCommand([opts.mode, "--yes", "--set-path", p, "off"], 10000);
    await runTailscaleCommand([opts.mode, "off", p]);
    await runTailscaleCommand([opts.mode, "off"]);
}
async function exposeViaTailscale(opts) {
    const localPath = normalizePath(opts.localPath);
    const tsPath = normalizePath(opts.tailscalePath ?? localPath);
    const localUrl = `http://127.0.0.1:${opts.localPort}${localPath}`;
    if (opts.mode === "off") {
        await Promise.all([
            cleanupTailscaleExposure({ mode: "serve", path: tsPath }),
            cleanupTailscaleExposure({ mode: "funnel", path: tsPath }),
        ]);
        return { ok: true, mode: "off", path: tsPath, localUrl, publicUrl: null };
    }
    const oppositeMode = opts.mode === "funnel" ? "serve" : "funnel";
    await cleanupTailscaleExposure({ mode: oppositeMode, path: tsPath });
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
