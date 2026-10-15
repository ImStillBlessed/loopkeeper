import { useEffect, useState } from "react";

/**
 * A tiny hash router: #/clients/royal_academy/tickets?ticket=iss_… → { path: ["clients", "royal_academy", "tickets"], query }.
 * Hash routes work behind any static host and keep the server simple.
 */
export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const [path = "", search = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  return { path: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(search) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const update = () => setRoute(parse());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

/** Builds a link: href("clients", id, "tickets") or href("tickets", { ticket: "royal_academy:iss_1" }). */
export function href(...parts: Array<string | Record<string, string | undefined>>): string {
  const query = parts.find((p): p is Record<string, string | undefined> => typeof p === "object");
  const path = parts.filter((p): p is string => typeof p === "string").map(encodeURIComponent).join("/");
  const search = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v) as Array<[string, string]>).toString() : "";
  return `#/${path}${search ? `?${search}` : ""}`;
}

export function navigate(to: string): void {
  window.location.hash = to.replace(/^#/, "");
}

/** Change one query value on the current page (e.g. open or close the ticket drawer). */
export function setQuery(key: string, value: string | undefined): void {
  const { path, query } = parse();
  if (value) query.set(key, value);
  else query.delete(key);
  const search = query.toString();
  navigate(`#/${path.map(encodeURIComponent).join("/")}${search ? `?${search}` : ""}`);
}

/** A ticket is addressed as "client:issueId" in links, since ticket ids are per client. */
export function ticketRef(clientId: string, issueId: string): string {
  return `${clientId}:${issueId}`;
}

export function openTicket(clientId: string, issueId: string): void {
  setQuery("ticket", ticketRef(clientId, issueId));
}
