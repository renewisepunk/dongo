import type { Intake } from "../features/overview/model";
import { intakeDisplayLabel } from "./intake-editing";

export type OptimisticIntakeInput = {
  submissionKey: string;
  text?: string;
  firstAttachmentName?: string;
  attachmentCount: number;
  createdAt: number;
};

export function createOptimisticIntake(input: OptimisticIntakeInput): Intake {
  return {
    id: `optimistic:${input.submissionKey}`,
    submissionKey: input.submissionKey,
    optimistic: true,
    text: intakeDisplayLabel(
      input.text,
      input.firstAttachmentName ? [{ filename: input.firstAttachmentName }] : [],
    ),
    submittedText: input.text,
    editable: true,
    ...(input.firstAttachmentName
      ? { attachment: input.firstAttachmentName }
      : {}),
    attachmentCount: input.attachmentCount,
    status: "waiting",
    age: "now",
    createdAt: input.createdAt,
  };
}

export function mergeOptimisticIntakes(
  durable: Intake[],
  optimistic: Intake[],
): Intake[] {
  const committedKeys = new Set(
    durable.flatMap((intake) =>
      intake.submissionKey ? [intake.submissionKey] : [],
    ),
  );
  return [
    ...optimistic.filter(
      (intake) =>
        intake.submissionKey !== undefined &&
        !committedKeys.has(intake.submissionKey),
    ),
    ...durable,
  ];
}
