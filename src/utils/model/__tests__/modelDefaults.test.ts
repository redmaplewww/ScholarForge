import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getDefaultHaikuModel,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  parseUserSpecifiedModel,
} from "../model";

describe("default model resolution", () => {
  const envKeys = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "OPENAI_MODEL",
    "GEMINI_MODEL",
    "GROK_MODEL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_OPENAI",
    "CLAUDE_CODE_USE_GEMINI",
    "CLAUDE_CODE_USE_GROK",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test("resolves opus[1m] alias from user configuration without recursion", () => {
    process.env.ANTHROPIC_MODEL = "opus[1m]";

    expect(parseUserSpecifiedModel("opus[1m]")).toBe(
      getDefaultOpusModel() + "[1m]"
    );
  });

  test("resolves sonnet alias from user configuration without recursion", () => {
    process.env.ANTHROPIC_MODEL = "sonnet";

    expect(parseUserSpecifiedModel("sonnet")).toBe(getDefaultSonnetModel());
  });

  test("resolves haiku alias from user configuration without recursion", () => {
    process.env.ANTHROPIC_MODEL = "haiku";

    expect(parseUserSpecifiedModel("haiku")).toBe(getDefaultHaikuModel());
  });

  test("prefers OPENAI_MODEL when the OpenAI provider is active", () => {
    process.env.CLAUDE_CODE_USE_OPENAI = "1";
    process.env.OPENAI_MODEL = "gpt-5.4";

    expect(getDefaultSonnetModel()).toBe("gpt-5.4");
    expect(parseUserSpecifiedModel("sonnet")).toBe("gpt-5.4");
  });
});
