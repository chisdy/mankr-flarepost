import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DraftQueue,
  fingerprintSendBody,
  forgetSendAttempt,
  readSendAttempt,
  rememberSendAttempt,
  retryBody,
} from "../src/features/compose/compose-persistence.ts"

test("a manual save or send waits for the in-flight autosave, even after a write fails", async () => {
  const queue = new DraftQueue()
  let rejectFirst
  const slowSave = new Promise((_, reject) => {
    rejectFirst = reject
  })
  const calls = []
  const first = queue.run(() => {
    calls.push("autosave")
    return slowSave
  })
  const latest = queue.run(async () => {
    calls.push("latest edit")
    return "draft-1"
  })
  await Promise.resolve()
  assert.deepEqual(calls, ["autosave"])
  rejectFirst(new Error("connection lost"))
  await assert.rejects(first, /connection lost/)
  await queue.settled()
  assert.equal(await latest, "draft-1")
  assert.deepEqual(calls, ["autosave", "latest edit"])
})

test("reopening a draft can retry only the identical attempt and stores no email content", async (t) => {
  const storage = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem: (key, value) => storage.set(key, value),
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
  const body = '{"text":"private message"}'
  const attempt = {
    draftId: "draft-1",
    key: crypto.randomUUID(),
    body,
    fingerprint: await fingerprintSendBody(body),
  }
  rememberSendAttempt(attempt)
  assert.doesNotMatch([...storage.values()][0], /private message/)

  const restored = readSendAttempt(attempt.draftId)
  assert.equal(restored.key, attempt.key)
  assert.equal(await retryBody(restored, body), body)
  assert.equal(
    await retryBody(restored, '{"text":"edited in another tab"}'),
    undefined
  )

  rememberSendAttempt({ ...attempt, accepted: true })
  assert.equal(
    await retryBody(readSendAttempt(attempt.draftId), body),
    undefined
  )
  forgetSendAttempt(attempt)
  assert.equal(readSendAttempt(attempt.draftId), null)
})
