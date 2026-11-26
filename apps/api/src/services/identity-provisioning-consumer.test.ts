import { beforeEach, afterEach, describe, expect, it } from "vitest";
import knex, { Knex } from "knex";
import { installAddons } from "@moonwitness/orm";
import { manifest, User, Partner } from "@moonwitness/orm-base";
import {
  consumeProvisioningEvent,
  runProvisioningConsumer,
} from "./identity-provisioning-consumer.js";
import {
  ProvisioningEvent,
  PROVISIONING_SCHEMA_VERSION,
  type AccountCreatedPayload,
  type AccountDisabledPayload,
  type AccountReactivatedPayload,
} from "@moonwitness/types";

describe("identity-provisioning-consumer (I45)", () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await installAddons(db, [manifest]);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const clock = { now: () => new Date("2026-11-26T18:00:00.000Z") };
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  function makeCreatedEvent(overrides: Partial<AccountCreatedPayload> = {}): ProvisioningEvent {
    const payload: AccountCreatedPayload = {
      subject: "sub-created-01",
      account_state: "enabled",
      display_identifier: "alice@example.com",
      correlation_id: "corr-01",
      occurred_at: "2026-11-26T17:30:00.000Z",
      ...overrides,
    };
    const eventId = overrides.correlation_id ? `evt-${overrides.correlation_id}` : "evt-created-01";
    return {
      id: "env-uuid-123",
      event_id: eventId,
      event_type: "account.created",
      schema_version: PROVISIONING_SCHEMA_VERSION,
      payload,
      created_at: "2026-11-26T17:30:00.000Z",
      attempt_count: 0,
      next_attempt_at: "2026-11-26T17:30:00.000Z",
      claimed_at: null,
      delivered_at: null,
    };
  }

  function makeDisabledEvent(overrides: Partial<AccountDisabledPayload> = {}): ProvisioningEvent {
    const payload: AccountDisabledPayload = {
      subject: "sub-disabled-02",
      account_state: "disabled",
      correlation_id: "corr-02",
      occurred_at: "2026-11-26T17:35:00.000Z",
      ...overrides,
    };
    const eventId = overrides.correlation_id ? `evt-${overrides.correlation_id}` : "evt-disabled-02";
    return {
      id: "env-uuid-456",
      event_id: eventId,
      event_type: "account.disabled",
      schema_version: PROVISIONING_SCHEMA_VERSION,
      payload,
      created_at: "2026-11-26T17:35:00.000Z",
      attempt_count: 0,
      next_attempt_at: "2026-11-26T17:35:00.000Z",
      claimed_at: null,
      delivered_at: null,
    };
  }

  function makeReactivatedEvent(overrides: Partial<AccountReactivatedPayload> = {}): ProvisioningEvent {
    const payload: AccountReactivatedPayload = {
      subject: "sub-reactivated-03",
      account_state: "enabled",
      correlation_id: "corr-03",
      occurred_at: "2026-11-26T17:40:00.000Z",
      ...overrides,
    };
    const eventId = overrides.correlation_id ? `evt-${overrides.correlation_id}` : "evt-reactivated-03";
    return {
      id: "env-uuid-789",
      event_id: eventId,
      event_type: "account.reactivated",
      schema_version: PROVISIONING_SCHEMA_VERSION,
      payload,
      created_at: "2026-11-26T17:40:00.000Z",
      attempt_count: 0,
      next_attempt_at: "2026-11-26T17:40:00.000Z",
      claimed_at: null,
      delivered_at: null,
    };
  }

  it("creates business user on account.created and records processed event", async () => {
    const event = makeCreatedEvent({ subject: "sub-new-01", correlation_id: "corr-new-01" });

    const result = await consumeProvisioningEvent(event, { db, clock, logger });

    expect(result).toEqual({
      ok: true,
      status: "processed",
      eventId: "evt-corr-new-01",
    });

    const user = await User.query().where({ identity_subject: "sub-new-01" }).first();
    expect(user).toBeDefined();
    expect(user?.identity_subject).toBe("sub-new-01");
    expect(user?.active).toBe(true);
    expect(user?.role).toBe("user");
    expect(user?.partner_id).toBeDefined();

    const partner = await Partner.query().findById(user?.partner_id!);
    expect(partner?.email).toBe("alice@example.com");

    // Verify processed event recorded
    const processed = await db("identity_provisioning_processed_events")
      .where({ event_id: "evt-corr-new-01" })
      .first();
    expect(processed).toBeDefined();
  });

  it("sets business user inactive on account.disabled", async () => {
    const partner = await Partner.query().insert({ name: "Test", email: "test@test.com", is_company: false });
    await User.query().insert({
      identity_subject: "sub-disabled-02",
      login: "test@test.com",
      partner_id: partner.id,
      role: "user",
      active: true,
    });

    const event = makeDisabledEvent({ subject: "sub-disabled-02", correlation_id: "corr-dis-02" });
    const result = await consumeProvisioningEvent(event, { db, clock, logger });

    expect(result).toEqual({ ok: true, status: "processed", eventId: "evt-corr-dis-02" });

    const user = await User.query().where({ identity_subject: "sub-disabled-02" }).first();
    expect(user?.active).toBe(false);
  });

  it("sets business user active on account.reactivated", async () => {
    const partner = await Partner.query().insert({ name: "Test", email: "test@test.com", is_company: false });
    await User.query().insert({
      identity_subject: "sub-reactivated-03",
      login: "test@test.com",
      partner_id: partner.id,
      role: "user",
      active: false,
    });

    const event = makeReactivatedEvent({ subject: "sub-reactivated-03", correlation_id: "corr-rea-03" });
    const result = await consumeProvisioningEvent(event, { db, clock, logger });

    expect(result).toEqual({ ok: true, status: "processed", eventId: "evt-corr-rea-03" });

    const user = await User.query().where({ identity_subject: "sub-reactivated-03" }).first();
    expect(user?.active).toBe(true);
  });

  it("ignores duplicate events idempotently", async () => {
    const event = makeCreatedEvent({ subject: "sub-dup-01", correlation_id: "corr-dup-01" });

    await consumeProvisioningEvent(event, { db, clock, logger });
    const result2 = await consumeProvisioningEvent(event, { db, clock, logger });

    expect(result2).toEqual({ ok: true, status: "duplicate", eventId: "evt-corr-dup-01" });

    const users = await User.query().where({ identity_subject: "sub-dup-01" });
    expect(users.length).toBe(1);
  });

  it("rejects unknown schema version", async () => {
    const event = makeCreatedEvent({ correlation_id: "corr-unknown-01" });
    (event as any).schema_version = 99;

    const result = await consumeProvisioningEvent(event, { db, clock, logger });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unknown_version");
    expect(result.eventId).toBe("evt-corr-unknown-01");
  });

  it("rejects invalid payloads", async () => {
    const event = makeCreatedEvent({ subject: "", correlation_id: "corr-invalid-01" }); // invalid empty subject

    const result = await consumeProvisioningEvent(event, { db, clock, logger });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("validation_failed");
  });

  it("rejects malformed events", async () => {
    const result = await consumeProvisioningEvent({ not: "an event" }, { db, clock, logger });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("invalid_event");
  });

  it("runs multiple events sequentially and stops on first hard failure", async () => {
    const event1 = makeCreatedEvent({ subject: "sub-seq-01", correlation_id: "corr-seq-01", display_identifier: "seq1@example.com" });
    const event2 = makeCreatedEvent({ subject: "sub-seq-02", correlation_id: "corr-seq-02", display_identifier: "seq2@example.com" });
    const event3 = { ...makeCreatedEvent({ subject: "sub-seq-03", correlation_id: "corr-seq-03" }), schema_version: 99 }; // invalid
    const event4 = makeCreatedEvent({ subject: "sub-seq-04", correlation_id: "corr-seq-04", display_identifier: "seq4@example.com" });

    const results = await runProvisioningConsumer([event1, event2, event3, event4], { db, clock, logger });

    // Debug output
    console.log("Results:", JSON.stringify(results, null, 2));

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
    expect(results[2].ok).toBe(false);
    expect(results[2].status).toBe("unknown_version");
    // Should stop after first hard failure (not duplicate/unknown_version)
    expect(results.length).toBe(3);
  });

  it("stops on unknown_version (hard failure)", async () => {
    const event1 = makeCreatedEvent({ subject: "sub-cont-01", correlation_id: "corr-cont-01", display_identifier: "cont1@example.com" });
    const event2 = { ...makeCreatedEvent({ subject: "sub-cont-02", correlation_id: "corr-cont-02" }), schema_version: 99 }; // unknown_version
    const event3 = makeCreatedEvent({ subject: "sub-cont-03", correlation_id: "corr-cont-03", display_identifier: "cont3@example.com" });

    const results = await runProvisioningConsumer([event1, event2, event3], { db, clock, logger });

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].status).toBe("unknown_version");
    expect(results.length).toBe(2); // Stops on unknown_version (hard failure)
  });
});
