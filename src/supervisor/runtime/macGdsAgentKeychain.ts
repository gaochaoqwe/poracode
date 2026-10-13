import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const KEYCHAIN_TIMEOUT_MS = 5_000;
const CREDENTIAL_SUFFIX = "-credentials";
const ACCOUNT_RE = /^[a-zA-Z0-9._-]+$/;

interface KeychainEnv {
  GDS_AGENT_CONFIG_DIR?: string | undefined;
  GDSAGENT_SECURESTORAGE_CONFIG_DIR?: string | undefined;
  GDS_AGENT_CUSTOM_OAUTH_URL?: string | undefined;
}

export interface GdsAgentKeychainCredential {
  service: string;
  content: string;
}

export function gdsAgentKeychainAccount(
  env: { USER?: string | undefined } = process.env,
  fallbackUsername = userInfo().username,
): string {
  const account = env.USER || fallbackUsername || "gds-agent-user";
  return ACCOUNT_RE.test(account) ? account : "gds-agent-user";
}

function defaultGdsAgentConfigDir(): string {
  return join(homedir(), ".gdsAgent");
}

function secureStorageConfigDir(env: KeychainEnv): string {
  const secureDir = env.GDSAGENT_SECURESTORAGE_CONFIG_DIR;
  if (secureDir !== undefined) return (secureDir || defaultGdsAgentConfigDir()).normalize("NFC");
  return (env.GDS_AGENT_CONFIG_DIR || defaultGdsAgentConfigDir()).normalize("NFC");
}

function keychainConfigHashSuffix(env: KeychainEnv): string {
  const secureDir = env.GDSAGENT_SECURESTORAGE_CONFIG_DIR;
  const useDefaultKey = secureDir !== undefined ? secureDir.length === 0 : !env.GDS_AGENT_CONFIG_DIR;
  if (useDefaultKey) return "";
  return `-${createHash("sha256").update(secureStorageConfigDir(env)).digest("hex").slice(0, 8)}`;
}

function oauthSuffixes(env: KeychainEnv): string[] {
  const suffixes = [""];
  if (env.GDS_AGENT_CUSTOM_OAUTH_URL) suffixes.push("-custom-oauth");
  // Developer/local GdsAgent builds use this suffix. Trying it after the prod
  // name is harmless and keeps usage working for non-production installs.
  suffixes.push("-local-oauth");
  return [...new Set(suffixes)];
}

export function gdsAgentKeychainServiceNames(env: KeychainEnv = process.env): string[] {
  const hashSuffix = keychainConfigHashSuffix(env);
  return oauthSuffixes(env).map(
    (oauthSuffix) => `gdsAgent${oauthSuffix}${CREDENTIAL_SUFFIX}${hashSuffix}`,
  );
}

export async function readGdsAgentCredentialsFromMacKeychainEntry(
  env: KeychainEnv = process.env,
): Promise<GdsAgentKeychainCredential | undefined> {
  if (process.platform !== "darwin") return undefined;
  const account = gdsAgentKeychainAccount();
  for (const service of gdsAgentKeychainServiceNames(env)) {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-a", account, "-w", "-s", service],
        { timeout: KEYCHAIN_TIMEOUT_MS, encoding: "utf8" },
      );
      const trimmed = stdout.trim();
      if (trimmed) return { service, content: trimmed };
    } catch {
      // Try the next candidate. Missing/locked keychains degrade to auth-missing.
    }
  }
  return undefined;
}

export async function readGdsAgentCredentialsFromMacKeychainService(
  service: string,
): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-a", gdsAgentKeychainAccount(), "-w", "-s", service],
      { timeout: KEYCHAIN_TIMEOUT_MS, encoding: "utf8" },
    );
    const trimmed = stdout.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function readGdsAgentCredentialsFromMacKeychain(
  env: KeychainEnv = process.env,
): Promise<string | undefined> {
  return (await readGdsAgentCredentialsFromMacKeychainEntry(env))?.content;
}

export async function writeGdsAgentCredentialsToMacKeychain(
  service: string,
  content: string,
): Promise<void> {
  if (process.platform !== "darwin") return;
  await execFileAsync(
    "security",
    ["add-generic-password", "-U", "-a", gdsAgentKeychainAccount(), "-s", service, "-w", content],
    { timeout: KEYCHAIN_TIMEOUT_MS, encoding: "utf8" },
  );
}
