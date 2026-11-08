"use client";
import { useState, useEffect } from "react";
import { api } from "./client-api";
type Event = {
  id: string;
  event_type: string;
  created_at: string;
  details: Record<string, unknown>;
  correlation_id: string;
};
export function ActivityFeed() {
  const [events, setEvents] = useState<Event[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<Event[]>("activity")
      .then(setEvents)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">APPEND-ONLY AUDIT TRAIL</p>
          <h1>The record behind every action.</h1>
          <p>
            Approvals, reservations, provider outcomes, and evidence revisions
            in this workspace.
          </p>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      <section className="panel padded">
        {events.map((e) => (
          <article className="activity-item" key={e.id}>
            <time>{new Date(e.created_at).toLocaleString()}</time>
            <h3>{e.event_type.replaceAll("_", " ").toLowerCase()}</h3>
            <code>{JSON.stringify(e.details)}</code>
            <small className="hash">Correlation: {e.correlation_id}</small>
          </article>
        ))}
      </section>
    </>
  );
}
