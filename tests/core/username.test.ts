import { describe, expect, it } from "vitest";
import {
  normalizeUsername,
  usernameKey,
  usernameProblem,
} from "../../src/core/profile/username";

describe("usernames", () => {
  it("accepts letters of any language, any case", () => {
    for (const ok of [
      "ada_l.1",
      "Ada.Lovelace",
      "张三",
      "王小明",
      "山田たろう",
      "김민수",
      "Tom王",
      "Müller",
      "Δημήτρης",
      "Иван",
      "محمد",
      "नमस्ते",
      "สมชาย",
      "ab",
    ]) {
      expect(usernameProblem(normalizeUsername(ok)), ok).toBeNull();
    }
  });

  it("rejects look-alike mixes, invisible characters and symbols", () => {
    for (const bad of [
      "a",
      "a b",
      "x​y",
      "pаypal",
      "Ivаn",
      "abc‮",
      "́abc",
      "a-b",
      "a@b",
      "abcdefghijklmnopqrstu",
    ]) {
      expect(usernameProblem(normalizeUsername(bad)), bad).not.toBeNull();
    }
  });

  it("treats case and full-width forms as the same username", () => {
    expect(usernameKey("Ada")).toBe("ada");
    expect(usernameKey("ＡＤＡ")).toBe("ada");
    expect(normalizeUsername(" ＡＤＡ ")).toBe("ADA");
  });
});
