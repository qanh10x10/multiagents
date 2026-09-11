import { validateSafeEnvironmentKey } from "./provider-settings.ts";

/**
 * Provider Credential Management
 *
 * Ephemeral in-process credential storage for multiagent provider authentication.
 *
 * SECURITY INVARIANTS:
 * - Credentials are kept strictly in-memory during the running process lifetime.
 * - Credentials are NEVER written to plaintext disk files, logs, or browser localStorage.
 * - Credentials are NEVER included in exported catalogs or team templates.
 * - All stored credentials are LOST on process restart; the user must re-enter them on launch.
 * - Non-secret environment references (e.g. OPENAI_API_KEY) can be resolved at runtime
 *   without storing plaintext credentials in templates.
 * - Environment variable keys are validated against reserved OS/system variables to prevent
 *   arbitrary environment leakage.
 * - Verification state is decoupled from credential presence; automated/paid API network calls
 *   are NEVER performed automatically.
 * - Child process environment projection is server-only and scoped to runtime execution.
 */

export type CredentialState = "unconfigured" | "credential-present" | "connection-verified";

export interface ProviderCredentialStatus {
  providerId: string;
  state: CredentialState;
  source: "ephemeral" | "env" | "none";
  envKeyRef?: string;
  lastVerifiedAt?: string;
}

export class ProviderCredentialStore {
  // Ephemeral in-memory store; secrets are lost on process exit (no plaintext disk writes)
  private static ephemeralKeys = new Map<string, string>();
  private static verifiedProviders = new Map<string, string>(); // providerId -> ISO timestamp

  /**
   * Store a user-provided API key in ephemeral memory for the given provider.
   * Input must come only from secure local UI or host password prompt.
   */
  static setKey(providerId: string, apiKey: string): void {
    if (typeof providerId !== "string" || !providerId.trim()) {
      throw new Error("Invalid provider ID.");
    }
    if (typeof apiKey !== "string" || !apiKey.trim() || /[\x00-\x1f\x7f]/.test(apiKey)) {
      throw new Error("API key must be a valid non-empty string without control characters.");
    }
    this.ephemeralKeys.set(providerId, apiKey.trim());
    // Invalidate prior verification if key updated
    this.verifiedProviders.delete(providerId);
  }

  /**
   * Retrieve the active key for a provider.
   * Priority: 1) Ephemeral in-memory key, 2) Environment variable if envKeyRef provided.
   */
  static getKey(
    providerId: string,
    envKeyRef?: string,
    env: Record<string, string | undefined> = process.env
  ): string | undefined {
    const ephemeral = this.ephemeralKeys.get(providerId);
    if (ephemeral) return ephemeral;

    if (envKeyRef !== undefined) {
      validateSafeEnvironmentKey(envKeyRef);
      if (typeof env === "object" && typeof env[envKeyRef] === "string") {
        const val = env[envKeyRef]!.trim();
        if (val) return val;
      }
    }

    return undefined;
  }

  /**
   * Check if a credential is available for the given provider.
   */
  static hasKey(
    providerId: string,
    envKeyRef?: string,
    env: Record<string, string | undefined> = process.env
  ): boolean {
    return this.getKey(providerId, envKeyRef, env) !== undefined;
  }

  /**
   * Clear any ephemeral key and verification state for the provider.
   */
  static clearKey(providerId: string): void {
    this.ephemeralKeys.delete(providerId);
    this.verifiedProviders.delete(providerId);
  }

  /**
   * Alias for clearKey.
   */
  static deleteKey(providerId: string): void {
    this.clearKey(providerId);
  }

  /**
   * Get the current credential state without triggering external network calls.
   */
  static getStatus(
    providerId: string,
    envKeyRef?: string,
    env: Record<string, string | undefined> = process.env
  ): ProviderCredentialStatus {
    const hasEphemeral = this.ephemeralKeys.has(providerId);
    let hasEnv = false;

    if (envKeyRef !== undefined) {
      try {
        validateSafeEnvironmentKey(envKeyRef);
        hasEnv = !!(typeof env === "object" && typeof env[envKeyRef] === "string" && env[envKeyRef]!.trim());
      } catch {
        hasEnv = false;
      }
    }

    const lastVerified = this.verifiedProviders.get(providerId);

    if (hasEphemeral) {
      return {
        providerId,
        state: lastVerified ? "connection-verified" : "credential-present",
        source: "ephemeral",
        envKeyRef,
        lastVerifiedAt: lastVerified,
      };
    }

    if (hasEnv) {
      return {
        providerId,
        state: lastVerified ? "connection-verified" : "credential-present",
        source: "env",
        envKeyRef,
        lastVerifiedAt: lastVerified,
      };
    }

    return {
      providerId,
      state: "unconfigured",
      source: "none",
      envKeyRef,
    };
  }

  /**
   * Mark a provider as connection-verified after an explicitly user-authorized test.
   * Note: NEVER call automatically.
   */
  static markVerified(providerId: string, timestamp?: string): void {
    this.verifiedProviders.set(providerId, timestamp || new Date().toISOString());
  }

  /**
   * Projects active in-memory ephemeral credentials onto child process environment map.
   * Scoped strictly to server process invocation (e.g. child worker launcher transport).
   * Never persisted to disk or sent across network/tool APIs.
   */
  static buildProcessEnv(
    baseEnv: Record<string, string | undefined> = process.env,
    providerEnvMap?: Record<string, string> // providerId -> envKeyName
  ): Record<string, string | undefined> {
    const projected = { ...baseEnv };
    if (!providerEnvMap) return projected;

    for (const [providerId, envKeyName] of Object.entries(providerEnvMap)) {
      validateSafeEnvironmentKey(envKeyName);
      const ephemeralKey = this.ephemeralKeys.get(providerId);
      if (ephemeralKey) {
        projected[envKeyName] = ephemeralKey;
      }
    }
    return projected;
  }

  /**
   * Clear all ephemeral keys and verification states (used in tests or session reset).
   */
  static reset(): void {
    this.ephemeralKeys.clear();
    this.verifiedProviders.clear();
  }
}
