import { describe, expect, it } from "vitest";
import { detectAssistantLanguage } from "../workers/api/src/index";

describe("assistant response language detection", () => {
  it("defaults clear English questions to English", () => {
    expect(detectAssistantLanguage("Can you show my lending overview?")).toBe("en");
    expect(detectAssistantLanguage("Please explain how monthly interest works.")).toBe("en");
  });

  it("detects Tagalog messages", () => {
    expect(detectAssistantLanguage("Magkano ang utang ni Juan?")).toBe("tl");
    expect(detectAssistantLanguage("Paki ayos po ito.")).toBe("tl");
  });

  it("detects mixed English and Tagalog messages as Taglish", () => {
    expect(detectAssistantLanguage("Please paki check my loan balance po.")).toBe("tl-en");
    expect(detectAssistantLanguage("Can you explain kung paano magbayad?")).toBe("tl-en");
  });

  it("does not classify ordinary English lending terms as Tagalog", () => {
    expect(detectAssistantLanguage("Show all active loans and payments.")).toBe("en");
  });
});
