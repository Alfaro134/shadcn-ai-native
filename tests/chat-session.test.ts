import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { ChatSession } from "../example/src/application/chat-session.ts";
import type { ChatModel, ChatRequest, ChatStreamHandlers } from "../example/src/domain/chat-model.ts";
import type { ReplyMetrics } from "../example/src/domain/telemetry.ts";

/** A ChatModel the test drives by hand: it records each stream and lets the test emit events. */
class FakeModel implements ChatModel {
  readonly streams: Array<{ request: ChatRequest; handlers: ChatStreamHandlers; cancelled: boolean }> = [];

  stream(request: ChatRequest, handlers: ChatStreamHandlers) {
    const entry = { request, handlers, cancelled: false };
    this.streams.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  get last() {
    return this.streams[this.streams.length - 1];
  }
}

let model: FakeModel;
let clock: number;
let session: ChatSession;

beforeEach(() => {
  model = new FakeModel();
  clock = 0;
  let id = 0;
  session = new ChatSession(model, { createId: () => `id${id++}`, now: () => clock });
});

const messages = () => session.state.get().messages.map((m) => `${m.role}:${m.content}${m.status === "complete" ? "" : `(${m.status})`}`);

describe("send", () => {
  test("adds the prompt and a streaming placeholder", () => {
    assert.equal(session.send("  hello  "), true);
    assert.deepEqual(messages(), ["user:hello", "assistant:"]);
    assert.equal(session.state.get().streamingId, "id1");
    assert.equal(model.last.request.prompt, "hello");
    assert.deepEqual(model.last.request.history.map((m) => `${m.role}:${m.content}`), ["user:hello"]);
  });

  test("ignores blank prompts", () => {
    assert.equal(session.send("   "), false);
    assert.deepEqual(messages(), []);
  });

  test("ignores a second prompt while streaming (double tap)", () => {
    session.send("a");
    assert.equal(session.send("b"), false);
    assert.equal(model.streams.length, 1);
  });
});

describe("streaming", () => {
  test("tokens update the live reply without touching the message list", () => {
    session.send("hi");
    let listNotifications = 0;
    session.state.subscribe(() => listNotifications++);
    model.last.handlers.onAnswer("Hel");
    model.last.handlers.onAnswer("lo");
    assert.equal(session.live.get().content, "Hello");
    assert.equal(listNotifications, 0);
  });

  test("done commits the reply once and goes idle", () => {
    session.send("hi");
    model.last.handlers.onAnswer("Hello");
    model.last.handlers.onDone();
    assert.deepEqual(messages(), ["user:hi", "assistant:Hello"]);
    assert.equal(session.state.get().streamingId, null);
    assert.equal(session.live.get().content, "");
  });

  test("reasoning is kept, and timed until the first answer token", () => {
    session.send("hi");
    model.last.handlers.onReasoning("");
    assert.equal(session.live.get().phase, "reasoning");
    clock = 2400;
    model.last.handlers.onReasoning("think");
    model.last.handlers.onAnswer("ok");
    clock = 9000;
    model.last.handlers.onDone();
    const reply = session.state.get().messages[1];
    assert.equal(reply.reasoning, "think");
    assert.equal(reply.thoughtSeconds, 2);
  });
});

describe("stop", () => {
  test("keeps what arrived and cancels the model", () => {
    session.send("hi");
    model.last.handlers.onAnswer("Hel");
    session.stop();
    assert.deepEqual(messages(), ["user:hi", "assistant:Hel(stopped)"]);
    assert.equal(model.last.cancelled, true);
  });

  test("before any token drops the empty reply", () => {
    session.send("hi");
    session.stop();
    assert.deepEqual(messages(), ["user:hi"]);
  });

  test("while idle does nothing", () => {
    session.stop();
    assert.deepEqual(messages(), []);
  });
});

describe("errors", () => {
  test("keep the partial reply and mark it", () => {
    session.send("hi");
    model.last.handlers.onAnswer("Hel");
    model.last.handlers.onError(new Error("network"));
    assert.deepEqual(messages(), ["user:hi", "assistant:Hel(error)"]);
    assert.equal(session.isStreaming, false);
  });

  test("an error before any token keeps an empty, marked reply", () => {
    session.send("hi");
    model.last.handlers.onError(new Error("401"));
    assert.deepEqual(messages(), ["user:hi", "assistant:(error)"]);
  });
});

describe("stale events", () => {
  test("events after stop are ignored", () => {
    session.send("hi");
    const old = model.last.handlers;
    session.stop();
    old.onAnswer("late");
    old.onDone();
    assert.deepEqual(messages(), ["user:hi"]);
  });

  test("a cancelled stream can't write into the next one", () => {
    session.send("one");
    const first = model.last.handlers;
    session.stop();
    session.send("two");
    first.onAnswer("from the first stream");
    model.last.handlers.onAnswer("second");
    model.last.handlers.onDone();
    assert.deepEqual(messages(), ["user:one", "user:two", "assistant:second"]);
  });

  test("events after reset are ignored", () => {
    session.send("hi");
    const old = model.last.handlers;
    session.reset();
    old.onAnswer("late");
    old.onDone();
    assert.deepEqual(messages(), []);
    assert.equal(model.last.cancelled, true);
  });
});

describe("regenerate", () => {
  test("replaces the last reply with a new one for the same prompt", () => {
    session.send("hi");
    model.last.handlers.onAnswer("first");
    model.last.handlers.onDone();
    assert.equal(session.regenerate(), true);
    assert.deepEqual(messages(), ["user:hi", "assistant:"]);
    assert.equal(model.last.request.prompt, "hi");
    model.last.handlers.onAnswer("second");
    model.last.handlers.onDone();
    assert.deepEqual(messages(), ["user:hi", "assistant:second"]);
  });

  test("does nothing without a prompt or while streaming", () => {
    assert.equal(session.regenerate(), false);
    session.send("hi");
    assert.equal(session.regenerate(), false);
  });
});

describe("dispose", () => {
  test("cancels the running stream", () => {
    session.send("hi");
    session.dispose();
    assert.equal(model.last.cancelled, true);
    model.last.handlers.onAnswer("late");
    assert.equal(session.live.get().content, "");
  });
});

describe("telemetry", () => {
  let reports: Array<{ metrics: ReplyMetrics; error?: unknown }>;

  beforeEach(() => {
    reports = [];
    let id = 0;
    session = new ChatSession(model, {
      createId: () => `id${id++}`,
      now: () => clock,
      telemetry: { replyEnded: (metrics, error) => reports.push({ metrics, error }) },
    });
  });

  test("reports time to first token, duration, chunks and size once per reply", () => {
    session.send("hi");
    model.last.handlers.onReasoning(""); // announces the phase: not a token
    clock = 400;
    model.last.handlers.onReasoning("Let me think");
    clock = 900;
    model.last.handlers.onAnswer("Hel");
    model.last.handlers.onAnswer("lo");
    clock = 1000;
    model.last.handlers.onDone();
    assert.deepEqual(reports, [
      {
        metrics: {
          trigger: "send",
          outcome: "complete",
          timeToFirstTokenMs: 400,
          durationMs: 1000,
          chunks: 3,
          reasoningChars: 12,
          answerChars: 5,
        },
        error: undefined,
      },
    ]);
  });

  test("passes the model's error along with the metrics", () => {
    session.send("hi");
    const failure = new Error("503");
    model.last.handlers.onError(failure);
    assert.equal(reports[0].metrics.outcome, "error");
    assert.equal(reports[0].metrics.timeToFirstTokenMs, undefined);
    assert.equal(reports[0].error, failure);
  });

  test("stop, regenerate, reset and unmount are told apart", () => {
    session.send("hi");
    model.last.handlers.onAnswer("a");
    session.stop();
    session.regenerate();
    session.reset();
    session.send("again");
    session.dispose();
    assert.deepEqual(
      reports.map((r) => `${r.metrics.trigger}:${r.metrics.outcome}`),
      ["send:stopped", "regenerate:discarded", "send:discarded"],
    );
  });

  test("a throwing telemetry adapter doesn't break the chat", () => {
    let id = 0;
    session = new ChatSession(model, {
      createId: () => `id${id++}`,
      telemetry: {
        replyEnded: () => {
          throw new Error("analytics down");
        },
      },
    });
    session.send("hi");
    model.last.handlers.onAnswer("ok");
    assert.doesNotThrow(() => model.last.handlers.onDone());
    assert.deepEqual(messages(), ["user:hi", "assistant:ok"]);
  });
});

describe("a model that throws synchronously", () => {
  test("ends the reply as an error instead of leaving the chat stuck", () => {
    const reports: ReplyMetrics[] = [];
    const broken: ChatModel = {
      stream() {
        throw new Error("misconfigured adapter");
      },
    };
    session = new ChatSession(broken, { telemetry: { replyEnded: (metrics) => reports.push(metrics) } });
    assert.equal(session.send("hi"), true);
    assert.equal(session.isStreaming, false);
    assert.deepEqual(messages(), ["user:hi", "assistant:(error)"]);
    assert.equal(reports[0].outcome, "error");
    assert.equal(session.send("retry"), true); // not stuck
  });
});
