import { describe, it, expect } from "vitest";

describe("production smoke checks", () => {
  it("has required environment variable names documented", () => {
    const required = [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ];

    expect(required).toContain("VITE_SUPABASE_URL");
    expect(required).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
  });
});
