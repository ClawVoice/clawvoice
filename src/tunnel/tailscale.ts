import { spawn } from "node:child_process";

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

function runTailscaleCommand(
  args: string[],
  timeoutMs = 2500,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";

    const proc = spawn("tailscale", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (chunk: Buffer) => {
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

export async function getTailscaleSelfInfo(): Promise<TailscaleSelfInfo | null> {
  const { code, stdout } = await runTailscaleCommand(["status", "--json"]);
  if (code !== 0) return null;

  try {
    const status = JSON.parse(stdout);
    return {
      dnsName: status.Self?.DNSName?.replace(/\.$/, "") || null,
      nodeId: status.Self?.ID || null,
    };
  } catch {
    return null;
  }
}

export async function getTailscaleDnsName(): Promise<string | null> {
  const info = await getTailscaleSelfInfo();
  return info?.dnsName ?? null;
}

export async function isTailscaleAvailable(): Promise<boolean> {
  const { code } = await runTailscaleCommand(["status", "--json"]);
  return code === 0;
}

export async function setupTailscaleExposure(opts: {
  mode: "serve" | "funnel";
  path: string;
  localUrl: string;
}): Promise<string | null> {
  const dnsName = await getTailscaleDnsName();
  if (!dnsName) return null;

  const { code } = await runTailscaleCommand(
    [opts.mode, "--bg", "--yes", "--set-path", opts.path, opts.localUrl],
    10_000,
  );

  if (code === 0) {
    return `https://${dnsName}${opts.path}`;
  }
  return null;
}

export async function cleanupTailscaleExposure(opts: {
  mode: "serve" | "funnel";
  path: string;
}): Promise<void> {
  await runTailscaleCommand([opts.mode, "off", opts.path]);
}

export async function exposeViaTailscale(opts: {
  mode: TailscaleMode;
  localPort: number;
  localPath: string;
  tailscalePath?: string;
}): Promise<TailscaleExposeResult> {
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
      note:
        "Tailscale serve/funnel may need to be enabled for your tailnet. " +
        "Check your Tailscale admin console or visit the URL below.",
      enableUrl,
    },
  };
}
