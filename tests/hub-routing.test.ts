import { describe, expect, it } from "vitest";
import { clientsNamedIn, continuesThread, isChatter, parseHubMessage } from "../src/hub/routing.js";

const directory = [
  { id: "royal_academy", name: "Royal Academy", aliases: ["Royal", "RA"] },
  { id: "unity_model", name: "Unity Model School", aliases: ["Unity", "UMS"] },
  { id: "apex_centre", name: "Apex Tutorial Centre", aliases: ["Apex"] },
];

describe("parsing hub messages", () => {
  it("reads 'Speaker (Client): words'", () => {
    expect(parseHubMessage("Mrs Okafor (Royal Academy): the broadsheet averages are wrong")).toEqual({
      body: "the broadsheet averages are wrong",
      speaker: "Mrs Okafor",
      clientHint: "Royal Academy",
      forwarded: true,
    });
  });

  it("reads '[Client] Speaker: words' and '[Client] words'", () => {
    expect(parseHubMessage("[Unity] Mallam Ibrahim: students can't log in")).toMatchObject({ speaker: "Mallam Ibrahim", clientHint: "Unity", body: "students can't log in" });
    expect(parseHubMessage("[Apex] QR scanner down again")).toMatchObject({ clientHint: "Apex", body: "QR scanner down again", speaker: undefined });
  });

  it("strips a forwarding prefix and reads a titled speaker", () => {
    expect(parseHubMessage("Forwarded: Mr Chidi: when will the Excel export be ready?")).toEqual({
      body: "when will the Excel export be ready?",
      speaker: "Mr Chidi",
      forwarded: true,
    });
  });

  it("leaves staff's own words alone", () => {
    expect(parseHubMessage("Note: Tunde please check the Apex receipts again")).toEqual({ body: "Note: Tunde please check the Apex receipts again", forwarded: false });
  });
});

describe("finding clients named in a message", () => {
  it("matches names and aliases as whole words", () => {
    expect(clientsNamedIn("Tunde please check the Apex receipts again", directory)).toEqual(["apex_centre"]);
    expect(clientsNamedIn("Unity students still can't log in", directory)).toEqual(["unity_model"]);
    expect(clientsNamedIn("community event today", directory)).toEqual([]);
  });

  it("can find more than one", () => {
    expect(clientsNamedIn("Royal and Unity both reported it", directory).sort()).toEqual(["royal_academy", "unity_model"]);
  });
});

describe("telling chatter and follow-ups apart", () => {
  it("treats greetings and prayers as chatter", () => {
    expect(isChatter("Good morning team 🙏🏾")).toBe(true);
    expect(isChatter("🙏🏾🙏🏾")).toBe(true);
    expect(isChatter("Good morning, Unity's report cards are failing again")).toBe(false);
  });

  it("continues a thread only for real follow-ups", () => {
    expect(continuesThread("He says the board meeting is on Friday")).toBe(true);
    expect(continuesThread("A school called about fee reminders not sending to parents")).toBe(false);
    expect(continuesThread("Fee reminders not sending")).toBe(false);
  });
});
