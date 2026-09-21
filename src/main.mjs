import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const terminalStatuses = new Set(["completed", "partial", "failed"]);

function requiredInput(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name.replace("INPUT_", "").toLowerCase().replaceAll("_", "-")} is required`);
  return value;
}

function parseObject(value, name) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${name} must be a valid JSON object`);
  }
}

export function buildPushRequest({ environment, pushType, target, payload, title, body, credentialID }) {
  if (!new Set(["development", "production"]).has(environment)) {
    throw new Error("environment must be development or production");
  }
  if (!new Set(["alert", "background", "liveactivity"]).has(pushType)) {
    throw new Error("push-type must be alert, background, or liveactivity");
  }

  let parsedPayload;
  if (payload?.trim()) {
    parsedPayload = parseObject(payload, "payload");
  } else if (pushType === "alert") {
    if (!body?.trim()) throw new Error("body is required when an alert payload is omitted");
    parsedPayload = {
      aps: {
        alert: title?.trim() ? { title: title.trim(), body: body.trim() } : body.trim(),
      },
    };
  } else if (pushType === "background") {
    parsedPayload = { aps: { "content-available": 1 } };
  } else {
    throw new Error("payload is required for a liveactivity push");
  }

  if (new TextEncoder().encode(JSON.stringify(parsedPayload)).byteLength > 4096) {
    throw new Error("payload exceeds the APNs 4096-byte limit");
  }

  return {
    environment,
    ...(credentialID?.trim() ? { credentialID: credentialID.trim() } : {}),
    pushType,
    target: parseObject(target || '{"all":true}', "target"),
    payload: parsedPayload,
  };
}

function normalizedServerURL(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("server-url must be a valid URL including http:// or https://"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("server-url must use http:// or https://");
  }
  return url.href.replace(/\/$/, "");
}

async function apiRequest(serverURL, path, { method = "GET", token, body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(`${serverURL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Request to ${path} timed out`);
    throw new Error(`Could not connect to SodaPush Server: ${error?.message ?? error}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let result = null;
  if (text) {
    try { result = JSON.parse(text); }
    catch { throw new Error(`SodaPush Server returned a non-JSON response (${response.status})`); }
  }
  if (!response.ok) {
    const message = result?.message ?? `HTTP ${response.status}`;
    const requestID = result?.requestId ? ` (request ${result.requestId})` : "";
    throw new Error(`${message}${requestID}`);
  }
  return result;
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value ?? ""}\n`);
}

function writeSummary(jobID, push) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    "### SodaPush delivery",
    "",
    `- Job: \`${jobID}\``,
    `- Status: **${push?.status ?? "queued"}**`,
    `- Deliveries: ${push?.successCount ?? 0} sent, ${push?.failureCount ?? 0} failed`,
    "",
  ].join("\n"));
}

async function main() {
  const serverURL = normalizedServerURL(requiredInput("INPUT_SERVER_URL"));
  const username = requiredInput("INPUT_USERNAME");
  const password = requiredInput("INPUT_PASSWORD");
  const appID = requiredInput("INPUT_APP_ID");
  const wait = (process.env.INPUT_WAIT ?? "true").trim().toLowerCase() !== "false";
  const timeoutSeconds = Number(process.env.INPUT_TIMEOUT_SECONDS ?? "120");
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 3600) {
    throw new Error("timeout-seconds must be between 1 and 3600");
  }

  const request = buildPushRequest({
    environment: (process.env.INPUT_ENVIRONMENT ?? "production").trim(),
    pushType: (process.env.INPUT_PUSH_TYPE ?? "alert").trim(),
    target: process.env.INPUT_TARGET ?? '{"all":true}',
    payload: process.env.INPUT_PAYLOAD,
    title: process.env.INPUT_TITLE,
    body: process.env.INPUT_BODY,
    credentialID: process.env.INPUT_CREDENTIAL_ID,
  });

  let accessToken;
  let jobID;
  let latestPush;
  try {
    const login = await apiRequest(serverURL, "/v1/auth/login", {
      method: "POST",
      body: { username, password },
    });
    accessToken = login?.accessToken;
    if (!accessToken) throw new Error("SodaPush Server login did not return an access token");
    process.stdout.write(`::add-mask::${accessToken}\n`);

    const created = await apiRequest(serverURL, `/v1/apps/${encodeURIComponent(appID)}/pushes`, {
      method: "POST",
      token: accessToken,
      body: request,
    });
    jobID = created?.jobID;
    if (!jobID) throw new Error("SodaPush Server did not return a push job ID");
    latestPush = { status: created.status ?? "queued" };

    if (wait) {
      const deadline = Date.now() + timeoutSeconds * 1000;
      do {
        if (Date.now() >= deadline) throw new Error(`Push job ${jobID} did not finish within ${timeoutSeconds} seconds`);
        if (!terminalStatuses.has(latestPush.status)) await new Promise((resolve) => setTimeout(resolve, 2_000));
        const detail = await apiRequest(serverURL, `/v1/apps/${encodeURIComponent(appID)}/pushes/${encodeURIComponent(jobID)}`, { token: accessToken });
        latestPush = detail?.push ?? latestPush;
      } while (!terminalStatuses.has(latestPush.status));
    }

    setOutput("job-id", jobID);
    setOutput("status", latestPush.status);
    setOutput("total-count", latestPush.totalCount ?? 0);
    setOutput("success-count", latestPush.successCount ?? 0);
    setOutput("failure-count", latestPush.failureCount ?? 0);
    writeSummary(jobID, latestPush);
    console.log(`SodaPush job ${jobID}: ${latestPush.status}`);
  } finally {
    if (accessToken) {
      try { await apiRequest(serverURL, "/v1/auth/logout", { method: "POST", token: accessToken }); }
      catch (error) { console.warn(`Could not close the SodaPush session: ${error.message}`); }
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => { console.error(`SodaPush Action failed: ${error.message}`); process.exitCode = 1; });
