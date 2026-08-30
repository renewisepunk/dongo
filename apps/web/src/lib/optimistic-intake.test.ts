import { describe, expect, it } from "vitest";

import {
  createOptimisticIntake,
  mergeOptimisticIntakes,
} from "./optimistic-intake";

describe("optimistic Intake reconciliation", () => {
  it("renders a text or attachment submission immediately", () => {
    expect(createOptimisticIntake({
      submissionKey: "submission-1",
      text: "Capture the upload flow",
      attachmentCount: 0,
      createdAt: 100,
    })).toMatchObject({
      id: "optimistic:submission-1",
      text: "Capture the upload flow",
      optimistic: true,
      age: "now",
    });

    expect(createOptimisticIntake({
      submissionKey: "submission-2",
      firstAttachmentName: "screen-recording.mp4",
      attachmentCount: 1,
      createdAt: 101,
    }).text).toBe("screen-recording.mp4");
  });

  it("deduplicates the optimistic row by its durable request correlation", () => {
    const pending = createOptimisticIntake({
      submissionKey: "submission-1",
      text: "Exactly once",
      attachmentCount: 0,
      createdAt: 100,
    });
    const durable = {
      ...pending,
      id: "intake-1",
      optimistic: false,
      createdAt: 102,
    };

    expect(mergeOptimisticIntakes([durable], [pending])).toEqual([durable]);
    expect(mergeOptimisticIntakes([], [pending])).toEqual([pending]);
  });
});
