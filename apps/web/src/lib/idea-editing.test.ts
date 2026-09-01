import { describe, expect, it } from "vitest";

import type { IdeaSummary } from "./project-data";
import {
  ideaAttributionLabel,
  ideaDraftKey,
  ideaErrorCode,
  ideasForFilter,
  reorderedIdeas,
} from "./idea-editing";

function idea(id: string, state: IdeaSummary["state"], position: number): IdeaSummary {
  return {
    _id: id,
    projectId: "project-1",
    title: id,
    state,
    position,
    revision: 1,
    createdBy: { displayName: "Rene" },
    attachmentCount: 0,
    createdAt: position,
    updatedAt: position,
  };
}

describe("Idea presentation helpers", () => {
  it("keeps open ordering separate from archived and promoted history", () => {
    const ideas = [idea("b", "open", 200), idea("a", "open", 100), idea("x", "archived", 50)];
    expect(ideasForFilter(ideas, "open").map((entry) => entry._id)).toEqual(["a", "b"]);
    expect(ideasForFilter(ideas, "archived").map((entry) => entry._id)).toEqual(["x"]);
  });

  it("reorders only within the supplied open set", () => {
    const ideas = [idea("a", "open", 100), idea("b", "open", 200)];
    expect(reorderedIdeas(ideas, "b", -1).map((entry) => entry._id)).toEqual(["b", "a"]);
    expect(reorderedIdeas(ideas, "a", -1).map((entry) => entry._id)).toEqual(["a", "b"]);
  });

  it("provides stable draft, attribution, and conflict fallbacks", () => {
    expect(ideaDraftKey("project-1", "idea-2")).toBe("idea:project-1:idea-2");
    expect(ideaAttributionLabel({ displayName: "  Rene  " })).toBe("Rene");
    expect(ideaErrorCode(Object.assign(new Error("conflict"), {
      data: { code: "revision_conflict" },
    }))).toBe("revision_conflict");
  });
});
