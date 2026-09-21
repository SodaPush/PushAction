import test from "node:test";
import assert from "node:assert/strict";
import { buildPushRequest } from "../src/main.mjs";

test("builds an alert payload from title and body", () => {
  assert.deepEqual(buildPushRequest({
    environment: "production",
    pushType: "alert",
    target: '{"tags":["release"]}',
    title: "Released",
    body: "Version 2 is ready",
  }), {
    environment: "production",
    pushType: "alert",
    target: { tags: ["release"] },
    payload: { aps: { alert: { title: "Released", body: "Version 2 is ready" } } },
  });
});

test("keeps a custom payload and credential", () => {
  const request = buildPushRequest({
    environment: "development",
    pushType: "background",
    target: '{"userIDs":["user-1"]}',
    payload: '{"aps":{"content-available":1},"sync":true}',
    credentialID: "credential-1",
  });
  assert.equal(request.credentialID, "credential-1");
  assert.deepEqual(request.payload, { aps: { "content-available": 1 }, sync: true });
});

test("rejects invalid options before contacting the server", () => {
  assert.throws(() => buildPushRequest({
    environment: "invalid",
    pushType: "alert",
    target: '{"all":true}',
    body: "Hello",
  }), /environment/);
  assert.throws(() => buildPushRequest({
    environment: "production",
    pushType: "liveactivity",
    target: '{"all":true}',
  }), /payload is required/);
});
