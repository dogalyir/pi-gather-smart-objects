import { describe, expect, it } from "bun:test";
import {
  GATHER_PROMPT_SECTION_KEY,
  buildGatherPromptText,
  getPromptSectionContent,
  shouldInjectPrompt,
} from "../src/prompt.ts";

describe("Prompt injection", () => {
  it("section key is gather_smart_objects", () => {
    expect(GATHER_PROMPT_SECTION_KEY).toBe("gather_smart_objects");
  });

  it("produces prompt text under 500 characters", () => {
    const withHooks = buildGatherPromptText(true);
    const withoutHooks = buildGatherPromptText(false);

    expect(withHooks.length).toBeLessThan(500);
    expect(withoutHooks.length).toBeLessThan(500);
    expect(withHooks.length).toBeGreaterThan(100);
    expect(withoutHooks.length).toBeGreaterThan(100);

    expect(withHooks).toContain("gather_send");
    expect(withHooks).toContain("nunca secretos ni contenido privado");
  });

  it("injects only when tool is active and config/prompt are enabled", () => {
    // Tool active and enabled -> inject
    expect(
      shouldInjectPrompt({
        isToolActive: true,
        configEnabled: true,
        promptEnabled: true,
      }),
    ).toBe(true);

    const section = getPromptSectionContent({
      isToolActive: true,
      configEnabled: true,
      promptEnabled: true,
      hooksEnabled: true,
    });
    expect(section).toBeDefined();
    expect(section).toContain("gather_send");

    // Tool excluded -> do not inject
    expect(
      shouldInjectPrompt({
        isToolActive: false,
        configEnabled: true,
        promptEnabled: true,
      }),
    ).toBe(false);

    expect(
      getPromptSectionContent({
        isToolActive: false,
        configEnabled: true,
        promptEnabled: true,
      }),
    ).toBeUndefined();

    // Config disabled -> do not inject
    expect(
      shouldInjectPrompt({
        isToolActive: true,
        configEnabled: false,
        promptEnabled: true,
      }),
    ).toBe(false);

    // Prompt config disabled -> do not inject
    expect(
      shouldInjectPrompt({
        isToolActive: true,
        configEnabled: true,
        promptEnabled: false,
      }),
    ).toBe(false);
  });
});
