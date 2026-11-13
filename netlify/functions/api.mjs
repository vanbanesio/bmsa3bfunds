import { randomUUID, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const RECEIPT_PREFIX = "receipts/";

export const config = { path: "/api/*" };

export function passcodeMatches(candidate, configured = process.env.ADMIN_PASSCODE) {
  if (typeof candidate !== "string" || typeof configured !== "string" || !configured || candidate.length > 256) {
    return false;
  }
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(configured);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function detectContentType(bytes) {
  const data = Buffer.from(bytes);
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  if (data.length >= 5 && data.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function error(message, status) {
  return json({ error: message }, status);
}

function requireAdmin(request) {
  if (!process.env.ADMIN_PASSCODE) return error("Admin access is not configured.", 503);
  if (!passcodeMatches(request.headers.get("x-admin-passcode"))) return error("Unauthorized.", 401);
  return null;
}

function receiptIdFromPath(pathname, suffix = "") {
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = pathname.match(new RegExp(`^/api/receipts/([\\da-f-]{36})${escapedSuffix}$`, "i"));
  return match?.[1] ?? null;
}

async function listReceipts(store) {
  const { blobs } = await store.list({ prefix: RECEIPT_PREFIX });
  const receipts = await Promise.all(blobs.map(async ({ key }) => {
    const result = await store.getMetadata(key);
    return result?.metadata ?? null;
  }));
  return receipts.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveReceipt(request, store) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return error("A multipart receipt upload is required.", 400);
  }

  const studentId = Number(form.get("studentId"));
  const amount = Number(form.get("amount"));
  const note = String(form.get("note") ?? "").trim();
  const file = form.get("file");
  if (!Number.isSafeInteger(studentId) || studentId < 0 || studentId > 9999) {
    return error("Invalid student.", 400);
  }
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000) {
    return error("Enter a valid whole-peso amount.", 400);
  }
  if (note.length > 120) return error("The note must be 120 characters or fewer.", 400);
  if (!file || typeof file.arrayBuffer !== "function" || file.size <= 0 || file.size > MAX_FILE_BYTES) {
    return error("Choose a receipt no larger than 4 MB.", 400);
  }

  const contents = await file.arrayBuffer();
  const contentType = detectContentType(contents);
  if (!contentType) return error("Use a JPEG, PNG, WebP or PDF receipt.", 400);

  const id = randomUUID();
  const metadata = {
    id,
    studentId,
    amount,
    note,
    contentType,
    createdAt: new Date().toISOString(),
  };
  await store.set(`${RECEIPT_PREFIX}${id}`, contents, { metadata });
  return json({ id }, 201);
}

export default async function handler(request) {
  const pathname = new URL(request.url).pathname;

  try {
    if (pathname === "/api/admin/check" && request.method === "POST") {
      if (!process.env.ADMIN_PASSCODE) return error("Admin access is not configured.", 503);
      return passcodeMatches(request.headers.get("x-admin-passcode"))
        ? json({ ok: true })
        : error("Unauthorized.", 401);
    }

    const store = getStore("bsma3b-receipts");

    if (pathname === "/api/receipts" && request.method === "POST") {
      return await saveReceipt(request, store);
    }

    if (pathname === "/api/receipts" && request.method === "GET") {
      const denied = requireAdmin(request);
      if (denied) return denied;
      return json(await listReceipts(store));
    }

    const fileId = receiptIdFromPath(pathname, "/file");
    if (fileId && request.method === "GET") {
      const denied = requireAdmin(request);
      if (denied) return denied;
      const key = `${RECEIPT_PREFIX}${fileId}`;
      const entry = await store.getWithMetadata(key, { type: "arrayBuffer" });
      if (!entry?.data || !entry.metadata) return error("Receipt not found.", 404);
      return new Response(entry.data, {
        headers: {
          "content-type": entry.metadata.contentType,
          "content-disposition": "inline",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
        },
      });
    }

    const receiptId = receiptIdFromPath(pathname);
    if (receiptId && request.method === "DELETE") {
      const denied = requireAdmin(request);
      if (denied) return denied;
      await store.delete(`${RECEIPT_PREFIX}${receiptId}`);
      return json({ ok: true });
    }

    return error("Not found.", 404);
  } catch (cause) {
    console.error("Funds API request failed.", cause);
    return error("The request could not be completed.", 500);
  }
}
