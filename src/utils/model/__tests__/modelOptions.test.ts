import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("../../auth.js", () => ({
  isWebAppSubscriber: () => false,
  isMaxSubscriber: () => false,
  isTeamPremiumSubscriber: () => false,
}));

mock.module("../../bootstrap/state.js", () => ({
  getInitialMainLoopModel: () => null,
}));

mock.module("../providers.js", () => ({
  getAPIProvider: () => "openai",
}));

mock.module("../config.js", () => ({
  getGlobalConfig: () => ({ additionalModelOptionsCache: [] }),
}));

const { getModelOptions } = await import("../modelOptions");

describe("OpenAI model options", () => {
  const envKeys = ["OPENAI_MODEL", "OPENAI_DEFAULT_SONNET_MODEL"] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  beforeEach(() => {
    for (const key of envKeys) {
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

  test("shows GPT-family choices for the OpenAI provider", () => {
    const options = getModelOptions();
    const labels = options.map(option => option.label);
    const values = options.map(option => option.value);

    expect(values).toContain("gpt-5.4");
    expect(values).toContain("gpt-5.4-mini");
    expect(values).toContain("gpt-5.2");
    expect(labels).not.toContain("Sonnet");
    expect(labels).not.toContain("Opus");
  });

  test("includes a configured custom OpenAI model when present", () => {
    process.env.OPENAI_MODEL = "gpt-custom";

    const options = getModelOptions();
    const customOption = options.find(option => option.value === "gpt-custom");

    expect(customOption).toBeDefined();
    expect(customOption?.description).toBe("Configured OpenAI model");
  });
});
