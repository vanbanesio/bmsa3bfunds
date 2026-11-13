import test from "node:test";
import assert from "node:assert/strict";
import { detectContentType, passcodeMatches } from "../netlify/functions/api.mjs";

test("admin passcodes are compared exactly and reject missing values", () => {
  assert.equal(passcodeMatches("correct horse", "correct horse"), true);
  assert.equal(passcodeMatches("correct Horse", "correct horse"), false);
  assert.equal(passcodeMatches("", "correct horse"), false);
  assert.equal(passcodeMatches("correct horse", ""), false);
});

test("receipt content is classified by signature, not filename", () => {
  assert.equal(detectContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectContentType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "image/png");
  assert.equal(detectContentType(Buffer.from("RIFFxxxxWEBP")), "image/webp");
  assert.equal(detectContentType(Buffer.from("%PDF-1.7")), "application/pdf");
  assert.equal(detectContentType(Buffer.from("<svg></svg>")), null);
});
