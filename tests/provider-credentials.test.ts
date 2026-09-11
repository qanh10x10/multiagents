import { describe, it, expect, beforeEach } from "bun:test";
import { ProviderCredentialStore } from "../shared/provider-credentials.ts";

describe("ProviderCredentialStore", () => {
  beforeEach(() => {
    ProviderCredentialStore.reset();
  });

  it("stores and retrieves ephemeral keys in memory without disk persistence", () => {
    expect(ProviderCredentialStore.hasKey("p1")).toBe(false);
    expect(ProviderCredentialStore.getKey("p1")).toBeUndefined();

    ProviderCredentialStore.setKey("p1", "sk-test-secret-12345");
    expect(ProviderCredentialStore.hasKey("p1")).toBe(true);
    expect(ProviderCredentialStore.getKey("p1")).toBe("sk-test-secret-12345");

    ProviderCredentialStore.deleteKey("p1");
    expect(ProviderCredentialStore.hasKey("p1")).toBe(false);
    expect(ProviderCredentialStore.getKey("p1")).toBeUndefined();
  });

  it("rejects empty or control-character credentials", () => {
    expect(() => {
      ProviderCredentialStore.setKey("p1", "");
    }).toThrow("API key must be a valid non-empty string");

    expect(() => {
      ProviderCredentialStore.setKey("p1", "secret\nkey");
    }).toThrow("API key must be a valid non-empty string without control characters.");
  });

  it("rejects reading from reserved OS environment variables", () => {
    expect(() => {
      ProviderCredentialStore.getKey("p1", "PATH");
    }).toThrow("Environment key must not use reserved OS or runtime variable names.");

    expect(() => {
      ProviderCredentialStore.getKey("p1", "USERPROFILE");
    }).toThrow("Environment key must not use reserved OS or runtime variable names.");

    expect(() => {
      ProviderCredentialStore.buildProcessEnv({}, { p1: "HOME" });
    }).toThrow("Environment key must not use reserved OS or runtime variable names.");
  });

  it("resolves environment variable fallback and prioritizes ephemeral store", () => {
    const mockEnv = {
      MY_CUSTOM_API_KEY: "env-key-value",
    };

    // Resolves from env
    expect(ProviderCredentialStore.hasKey("p2", "MY_CUSTOM_API_KEY", mockEnv)).toBe(true);
    expect(ProviderCredentialStore.getKey("p2", "MY_CUSTOM_API_KEY", mockEnv)).toBe("env-key-value");

    const envStatus = ProviderCredentialStore.getStatus("p2", "MY_CUSTOM_API_KEY", mockEnv);
    expect(envStatus.state).toBe("credential-present");
    expect(envStatus.source).toBe("env");

    // Ephemeral key takes precedence
    ProviderCredentialStore.setKey("p2", "ephemeral-override");
    expect(ProviderCredentialStore.getKey("p2", "MY_CUSTOM_API_KEY", mockEnv)).toBe("ephemeral-override");

    const ephemStatus = ProviderCredentialStore.getStatus("p2", "MY_CUSTOM_API_KEY", mockEnv);
    expect(ephemStatus.state).toBe("credential-present");
    expect(ephemStatus.source).toBe("ephemeral");
  });

  it("projects server-only child process environment for worker launch", () => {
    ProviderCredentialStore.setKey("p-openai", "sk-live-123");
    const base = { PATH: "/usr/bin", HOME: "/home/user" };

    const projected = ProviderCredentialStore.buildProcessEnv(base, {
      "p-openai": "OPENAI_API_KEY",
    });

    expect(projected.PATH).toBe("/usr/bin");
    expect(projected.OPENAI_API_KEY).toBe("sk-live-123");
    // Ensure base was not mutated
    expect(base.OPENAI_API_KEY).toBeUndefined();
  });

  it("manages connection-verified state and resets on key modification", () => {
    ProviderCredentialStore.setKey("p3", "valid-key");
    let status = ProviderCredentialStore.getStatus("p3");
    expect(status.state).toBe("credential-present");
    expect(status.lastVerifiedAt).toBeUndefined();

    ProviderCredentialStore.markVerified("p3", "2026-09-09T00:00:00.000Z");
    status = ProviderCredentialStore.getStatus("p3");
    expect(status.state).toBe("connection-verified");
    expect(status.lastVerifiedAt).toBe("2026-09-09T00:00:00.000Z");

    // Updating key clears verified state
    ProviderCredentialStore.setKey("p3", "new-valid-key");
    status = ProviderCredentialStore.getStatus("p3");
    expect(status.state).toBe("credential-present");
    expect(status.lastVerifiedAt).toBeUndefined();
  });

  it("reports unconfigured status when neither ephemeral nor environment credentials exist", () => {
    const status = ProviderCredentialStore.getStatus("p-none", "MISSING_ENV_VAR", {});
    expect(status.state).toBe("unconfigured");
    expect(status.source).toBe("none");
  });
});
