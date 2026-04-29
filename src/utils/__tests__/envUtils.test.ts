import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getGlobalConfigFile } from "../env";
import {
  isEnvTruthy,
  isEnvDefinedFalsy,
  parseEnvVars,
  hasNodeOption,
  getAWSRegion,
  getDefaultVertexRegion,
  getVertexRegionForModel,
  isBareMode,
  shouldMaintainProjectWorkingDir,
  getAppConfigHomeDir,
} from "../envUtils";

// ─── isEnvTruthy ───────────────────────────────────────────────────────

describe("isEnvTruthy", () => {
  test("returns true for '1'", () => {
    expect(isEnvTruthy("1")).toBe(true);
  });

  test("returns true for 'true'", () => {
    expect(isEnvTruthy("true")).toBe(true);
  });

  test("returns true for 'TRUE'", () => {
    expect(isEnvTruthy("TRUE")).toBe(true);
  });

  test("returns true for 'yes'", () => {
    expect(isEnvTruthy("yes")).toBe(true);
  });

  test("returns true for 'on'", () => {
    expect(isEnvTruthy("on")).toBe(true);
  });

  test("returns true for boolean true", () => {
    expect(isEnvTruthy(true)).toBe(true);
  });

  test("returns false for '0'", () => {
    expect(isEnvTruthy("0")).toBe(false);
  });

  test("returns false for 'false'", () => {
    expect(isEnvTruthy("false")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isEnvTruthy("")).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isEnvTruthy(undefined)).toBe(false);
  });

  test("returns false for boolean false", () => {
    expect(isEnvTruthy(false)).toBe(false);
  });

  test("returns true for ' true ' (trimmed)", () => {
    expect(isEnvTruthy(" true ")).toBe(true);
  });
});

// ─── isEnvDefinedFalsy ─────────────────────────────────────────────────

describe("isEnvDefinedFalsy", () => {
  test("returns true for '0'", () => {
    expect(isEnvDefinedFalsy("0")).toBe(true);
  });

  test("returns true for 'false'", () => {
    expect(isEnvDefinedFalsy("false")).toBe(true);
  });

  test("returns true for 'no'", () => {
    expect(isEnvDefinedFalsy("no")).toBe(true);
  });

  test("returns true for 'off'", () => {
    expect(isEnvDefinedFalsy("off")).toBe(true);
  });

  test("returns true for boolean false", () => {
    expect(isEnvDefinedFalsy(false)).toBe(true);
  });

  test("returns false for undefined", () => {
    expect(isEnvDefinedFalsy(undefined)).toBe(false);
  });

  test("returns false for '1'", () => {
    expect(isEnvDefinedFalsy("1")).toBe(false);
  });

  test("returns false for 'true'", () => {
    expect(isEnvDefinedFalsy("true")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isEnvDefinedFalsy("")).toBe(false);
  });
});

// ─── parseEnvVars ──────────────────────────────────────────────────────

describe("parseEnvVars", () => {
  test("parses KEY=VALUE pairs", () => {
    const result = parseEnvVars(["FOO=bar", "BAZ=qux"]);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("handles value with equals sign", () => {
    const result = parseEnvVars(["URL=http://host?a=1&b=2"]);
    expect(result).toEqual({ URL: "http://host?a=1&b=2" });
  });

  test("returns empty object for undefined", () => {
    expect(parseEnvVars(undefined)).toEqual({});
  });

  test("returns empty object for empty array", () => {
    expect(parseEnvVars([])).toEqual({});
  });

  test("throws for missing value", () => {
    expect(() => parseEnvVars(["NOVALUE"])).toThrow("Invalid environment variable format");
  });

  test("throws for empty key", () => {
    expect(() => parseEnvVars(["=value"])).toThrow("Invalid environment variable format");
  });
});

// ─── hasNodeOption ─────────────────────────────────────────────────────

describe("hasNodeOption", () => {
  const saved = process.env.NODE_OPTIONS;
  afterEach(() => {
    if (saved === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = saved;
  });

  test("returns true when flag present", () => {
    process.env.NODE_OPTIONS = "--max-old-space-size=4096 --inspect";
    expect(hasNodeOption("--inspect")).toBe(true);
  });

  test("returns false when flag absent", () => {
    process.env.NODE_OPTIONS = "--max-old-space-size=4096";
    expect(hasNodeOption("--inspect")).toBe(false);
  });

  test("returns false when NODE_OPTIONS not set", () => {
    delete process.env.NODE_OPTIONS;
    expect(hasNodeOption("--inspect")).toBe(false);
  });

  test("does not match partial flags", () => {
    process.env.NODE_OPTIONS = "--inspect-brk";
    expect(hasNodeOption("--inspect")).toBe(false);
  });
});

// ─── getAWSRegion ──────────────────────────────────────────────────────

describe("getAWSRegion", () => {
  const savedRegion = process.env.AWS_REGION;
  const savedDefault = process.env.AWS_DEFAULT_REGION;

  afterEach(() => {
    if (savedRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = savedRegion;
    if (savedDefault === undefined) delete process.env.AWS_DEFAULT_REGION;
    else process.env.AWS_DEFAULT_REGION = savedDefault;
  });

  test("uses AWS_REGION when set", () => {
    process.env.AWS_REGION = "eu-west-1";
    expect(getAWSRegion()).toBe("eu-west-1");
  });

  test("falls back to AWS_DEFAULT_REGION", () => {
    delete process.env.AWS_REGION;
    process.env.AWS_DEFAULT_REGION = "ap-northeast-1";
    expect(getAWSRegion()).toBe("ap-northeast-1");
  });

  test("defaults to us-east-1", () => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    expect(getAWSRegion()).toBe("us-east-1");
  });
});

// ─── getDefaultVertexRegion ────────────────────────────────────────────

describe("getDefaultVertexRegion", () => {
  const saved = process.env.CLOUD_ML_REGION;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLOUD_ML_REGION;
    else process.env.CLOUD_ML_REGION = saved;
  });

  test("uses CLOUD_ML_REGION when set", () => {
    process.env.CLOUD_ML_REGION = "europe-west4";
    expect(getDefaultVertexRegion()).toBe("europe-west4");
  });

  test("defaults to us-east5", () => {
    delete process.env.CLOUD_ML_REGION;
    expect(getDefaultVertexRegion()).toBe("us-east5");
  });
});

// ─── getVertexRegionForModel ───────────────────────────────────────────

describe("getVertexRegionForModel", () => {
  const envKeys = [
    "VERTEX_REGION_CLAUDE_HAIKU_4_5",
    "VERTEX_REGION_CLAUDE_4_0_SONNET",
    "VERTEX_REGION_CLAUDE_4_6_SONNET",
    "CLOUD_ML_REGION",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("returns model-specific override when set", () => {
    process.env.VERTEX_REGION_CLAUDE_HAIKU_4_5 = "us-central1";
    expect(getVertexRegionForModel("claude-haiku-4-5-20251001")).toBe("us-central1");
  });

  test("falls back to default vertex region when override not set", () => {
    delete process.env.VERTEX_REGION_CLAUDE_4_0_SONNET;
    delete process.env.CLOUD_ML_REGION;
    expect(getVertexRegionForModel("claude-sonnet-4-some-variant")).toBe("us-east5");
  });

  test("returns default region for unknown model prefix", () => {
    delete process.env.CLOUD_ML_REGION;
    expect(getVertexRegionForModel("unknown-model-123")).toBe("us-east5");
  });

  test("returns default region for undefined model", () => {
    delete process.env.CLOUD_ML_REGION;
    expect(getVertexRegionForModel(undefined)).toBe("us-east5");
  });
});

// ─── isBareMode ────────────────────────────────────────────────────────

describe("isBareMode", () => {
  const saved = process.env.CLAUDE_CODE_SIMPLE;
  const originalArgv = [...process.argv];

  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CODE_SIMPLE;
    else process.env.CLAUDE_CODE_SIMPLE = saved;
    process.argv.length = 0;
    process.argv.push(...originalArgv);
  });

  test("returns true when CLAUDE_CODE_SIMPLE=1", () => {
    process.env.CLAUDE_CODE_SIMPLE = "1";
    expect(isBareMode()).toBe(true);
  });

  test("returns true when --bare in argv", () => {
    process.argv.push("--bare");
    expect(isBareMode()).toBe(true);
  });

  test("returns false when neither set", () => {
    delete process.env.CLAUDE_CODE_SIMPLE;
    // argv doesn't have --bare by default
    expect(isBareMode()).toBe(false);
  });
});

// ─── shouldMaintainProjectWorkingDir ───────────────────────────────────

describe("shouldMaintainProjectWorkingDir", () => {
  const saved = process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR;

  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR;
    else process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = saved;
  });

  test("returns true when set to truthy", () => {
    process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = "1";
    expect(shouldMaintainProjectWorkingDir()).toBe(true);
  });

  test("returns false when not set", () => {
    delete process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR;
    expect(shouldMaintainProjectWorkingDir()).toBe(false);
  });
});

// ─── getAppConfigHomeDir ────────────────────────────────────────────

describe("getAppConfigHomeDir", () => {
  const savedAngsheng = process.env.ANGSHENG_CONFIG_DIR;
  const saved = process.env.CLAUDE_CONFIG_DIR;
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "angsheng-app-home-"));
    process.chdir(tempDir);
    (getAppConfigHomeDir as any).cache?.clear?.();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    if (savedAngsheng === undefined) delete process.env.ANGSHENG_CONFIG_DIR;
    else process.env.ANGSHENG_CONFIG_DIR = savedAngsheng;
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    (getAppConfigHomeDir as any).cache?.clear?.();
  });

  test("uses the current project's .angsheng directory", () => {
    expect(getAppConfigHomeDir()).toBe(join(tempDir, ".angsheng"));
  });

  test("ignores legacy config directory environment variables", () => {
    process.env.ANGSHENG_CONFIG_DIR = "/tmp/test-angsheng";
    process.env.CLAUDE_CONFIG_DIR = "/tmp/test-claude";
    expect(getAppConfigHomeDir()).toBe(join(tempDir, ".angsheng"));
  });
});

// ─── getGlobalConfigFile ───────────────────────────────────────────────

describe("getGlobalConfigFile", () => {
  const savedAngsheng = process.env.ANGSHENG_CONFIG_DIR;
  const savedClaude = process.env.CLAUDE_CONFIG_DIR;
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "angsheng-config-"));
    process.chdir(tempDir);
    (getAppConfigHomeDir as any).cache?.clear?.();
    (getGlobalConfigFile as any).cache?.clear?.();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    if (savedAngsheng === undefined) delete process.env.ANGSHENG_CONFIG_DIR;
    else process.env.ANGSHENG_CONFIG_DIR = savedAngsheng;
    if (savedClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedClaude;
    (getAppConfigHomeDir as any).cache?.clear?.();
    (getGlobalConfigFile as any).cache?.clear?.();
  });

  test("uses the current project's .angsheng config file", () => {
    expect(getGlobalConfigFile()).toBe(
      join(tempDir, ".angsheng", ".angsheng.json")
    );
  });

  test("ignores legacy config directory environment variables", () => {
    process.env.ANGSHENG_CONFIG_DIR = join(tempDir, "angsheng");
    process.env.CLAUDE_CONFIG_DIR = join(tempDir, "claude");
    expect(getGlobalConfigFile()).toBe(
      join(tempDir, ".angsheng", ".angsheng.json")
    );
  });

  test("does not fall back to .claude.json", () => {
    mkdirSync(join(tempDir, ".angsheng"));
    writeFileSync(join(tempDir, ".angsheng", ".claude.json"), "{}");
    expect(getGlobalConfigFile()).toBe(
      join(tempDir, ".angsheng", ".angsheng.json")
    );
  });
});
