import { QUARRY_BRANCH_PREFIX, assertWritableFixBranch, makeFixBranchName } from "./branch.ts";

export type FixWriteTarget = {
  mode: "update" | "create";
  branch: string;
  prBase: string;
  parentRef: string;
};

/** Decide whether to commit on an existing quarry/* head or nest a new fix branch. */
export function resolveFixWriteTarget(input: {
  defaultBranch: string;
  jobHead: string;
  jobBase: string;
  now?: Date;
}): FixWriteTarget {
  const defaultBranch = input.defaultBranch.trim();
  const jobHead = input.jobHead.trim();
  const jobBase = input.jobBase.trim() || defaultBranch;
  const prBase = jobBase || defaultBranch;
  if (jobHead.startsWith(QUARRY_BRANCH_PREFIX)) {
    const branch = assertWritableFixBranch(jobHead, defaultBranch);
    return {
      mode: "update",
      branch,
      prBase,
      parentRef: branch,
    };
  }
  const branch = assertWritableFixBranch(makeFixBranchName(input.now), defaultBranch);
  return {
    mode: "create",
    branch,
    prBase,
    parentRef: jobHead || defaultBranch,
  };
}
