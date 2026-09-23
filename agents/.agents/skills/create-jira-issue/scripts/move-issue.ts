#!/usr/bin/env bun

/**
 * Move an existing Jira issue to the EN project and, optionally, a sprint.
 *
 * Jira's move API is asynchronous and requires a target issue type ID. This
 * script resolves the target project's matching issue type, waits for the move
 * to finish, and only then assigns the moved issue to the requested sprint.
 */

import { getAuthHeader, loadJiraConfig } from "./jira-config";

type Board = "EN";
type JiraIssueType = { id: string; name: string; subtask: boolean };
type JiraProject = { key: string; id: string; issueTypes: JiraIssueType[] };
type JiraIssue = {
  id: string;
  key: string;
  fields: { issuetype: { name: string }; project: { key: string } };
};
type JiraTask = {
  status: "ENQUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "CANCELLED";
  result?: { failedIssues?: Record<string, unknown> };
  message?: string;
};

const BOARD_IDS: Record<Board, number> = { EN: 22 };
const VALID_BOARDS = new Set<Board>(["EN"]);
const POLL_INTERVAL_MS = 1_000;
const MOVE_TIMEOUT_MS = 60_000;

interface MoveInput {
  issueKey: string;
  board: Board;
  issueType?: string;
  sprint?: string | number;
}

function usage(): string {
  return `
Move Jira Issue (EN board)

Usage:
  bun move-issue.ts --issue SOURCE-123 --board EN --sprint current
  bun move-issue.ts --issue SOURCE-123 --board EN --issueType Task --sprint "EN Sprint 123"

Required fields:
  --issue             Existing issue key to move
  --board             Destination board: EN

Optional fields:
  --issueType         Destination issue type. Defaults to a matching type in the destination project.
  --sprint            Destination sprint name, numeric ID, or "current" for the board's active sprint.

Notes:
  Moving changes the issue key. Jira sends its required bulk-move notification.
`;
}

function parseArgs(args: string[]): MoveInput {
  const values: Partial<MoveInput> = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    switch (args[index]) {
      case "--issue":
        values.issueKey = value;
        index += 1;
        break;
      case "--board":
        values.board = value as Board;
        index += 1;
        break;
      case "--issueType":
        values.issueType = value;
        index += 1;
        break;
      case "--sprint":
        values.sprint = value && /^\d+$/.test(value) ? Number(value) : value;
        index += 1;
        break;
      default:
        if (args[index]?.startsWith("--")) {
          throw new Error(`Unknown argument: ${args[index]}`);
        }
    }
  }

  if (!values.issueKey || !/^[A-Z][A-Z0-9_]*-\d+$/i.test(values.issueKey)) {
    throw new Error("--issue must be a Jira issue key (for example, SOURCE-123)");
  }
  if (!values.board || !VALID_BOARDS.has(values.board)) {
    throw new Error("--board must be EN");
  }
  return values as MoveInput;
}

async function requestJson<T>(
  url: string,
  auth: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${url}: ${response.status} ${await response.text()}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function resolveSprintId(
  sprintQuery: string | number,
  board: Board,
  jiraUrl: string,
  auth: string,
): Promise<number> {
  if (typeof sprintQuery === "number") return sprintQuery;

  const state =
    sprintQuery.toLowerCase() === "current" ? "active" : "active,future";
  const sprints = await requestJson<{ values: { id: number; name: string }[] }>(
    `${jiraUrl}/rest/agile/1.0/board/${BOARD_IDS[board]}/sprint?state=${state}`,
    auth,
  );
  if (sprintQuery.toLowerCase() === "current") {
    if (sprints.values.length !== 1) {
      throw new Error(
        `Expected one active sprint on ${board}, found ${sprints.values.length}`,
      );
    }
    return sprints.values[0]!.id;
  }

  const matchedSprint = sprints.values.find((sprint) =>
    sprint.name.toLowerCase().includes(sprintQuery.toLowerCase()),
  );
  if (!matchedSprint) {
    throw new Error(`No ${board} sprint matches "${sprintQuery}"`);
  }
  return matchedSprint.id;
}

async function waitForMove(
  taskId: string,
  jiraUrl: string,
  auth: string,
): Promise<void> {
  const deadline = Date.now() + MOVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await Bun.sleep(POLL_INTERVAL_MS);
    const task = await requestJson<JiraTask>(
      `${jiraUrl}/rest/api/3/task/${taskId}`,
      auth,
    );
    if (task.status === "COMPLETE") return;
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      throw new Error(
        `Jira move task ${task.status.toLowerCase()}: ${JSON.stringify(task)}`,
      );
    }
  }
  throw new Error(`Timed out waiting for Jira move task ${taskId}`);
}

async function moveIssue(input: MoveInput): Promise<{
  success: true;
  oldKey: string;
  key: string;
  id: string;
  board: Board;
  sprintId?: number;
  url: string;
}> {
  const config = await loadJiraConfig();
  const auth = getAuthHeader(config.username, config.apiToken);
  const source = await requestJson<JiraIssue>(
    `${config.jiraUrl}/rest/api/3/issue/${encodeURIComponent(input.issueKey)}?fields=issuetype,project`,
    auth,
  );
  const project = await requestJson<JiraProject>(
    `${config.jiraUrl}/rest/api/3/project/${input.board}`,
    auth,
  );
  const targetType = project.issueTypes.find(
    (type) =>
      type.name.toLowerCase() ===
      (input.issueType ?? source.fields.issuetype.name).toLowerCase(),
  );
  if (!targetType) {
    const available = project.issueTypes
      .filter((type) => !type.subtask)
      .map((type) => type.name)
      .join(", ");
    throw new Error(
      `No ${input.board} issue type matches "${input.issueType ?? source.fields.issuetype.name}". Available: ${available}`,
    );
  }

  const move = await requestJson<{ taskId: string }>(
    `${config.jiraUrl}/rest/api/3/bulk/issues/move`,
    auth,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sendBulkNotification: true,
        targetToSourcesMapping: {
          [`${project.key},${targetType.id}`]: {
            issueIdsOrKeys: [source.id],
            inferClassificationDefaults: true,
            inferFieldDefaults: true,
            inferStatusDefaults: true,
            inferSubtaskTypeDefault: true,
          },
        },
      }),
    },
  );
  await waitForMove(move.taskId, config.jiraUrl, auth);

  const moved = await requestJson<JiraIssue>(
    `${config.jiraUrl}/rest/api/3/issue/${source.id}?fields=project,issuetype`,
    auth,
  );
  if (moved.fields.project.key !== input.board) {
    throw new Error(
      `Move completed but issue is in ${moved.fields.project.key}, not ${input.board}`,
    );
  }

  let sprintId: number | undefined;
  if (input.sprint !== undefined) {
    sprintId = await resolveSprintId(
      input.sprint,
      input.board,
      config.jiraUrl,
      auth,
    );
    await requestJson<unknown>(
      `${config.jiraUrl}/rest/agile/1.0/sprint/${sprintId}/issue`,
      auth,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issues: [moved.key] }),
      },
    );
  }

  return {
    success: true,
    oldKey: source.key,
    key: moved.key,
    id: moved.id,
    board: input.board,
    ...(sprintId === undefined ? {} : { sprintId }),
    url: `${config.jiraUrl}/browse/${moved.key}`,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }
  try {
    console.log(JSON.stringify(await moveIssue(parseArgs(args)), null, 2));
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

void main();
